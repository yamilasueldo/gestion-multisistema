import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoAjuste, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { ConfigService } from '@nestjs/config';

function monthKey(date: Date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; }
function addMonths(date: Date, months: number) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)); }

@Injectable()
export class IndexSourceService {
  // El adaptador queda desacoplado de la forma concreta de la fuente oficial.
  // La importación acepta datos normalizados y guarda la URL/origen utilizado.
  private readonly ipcSourceUrl: string;
  constructor(private readonly prisma: PrismaService, config: ConfigService) { this.ipcSourceUrl = config.get<string>('IPC_SOURCE_URL') ?? ''; }
  async importConfigured() {
    if (!this.ipcSourceUrl) return { imported: 0, skipped: true };
    const index = await this.prisma.indice.findUnique({ where: { codigo: 'IPC' } });
    if (!index) throw new NotFoundException('El índice IPC no está configurado');
    const response = await fetch(this.ipcSourceUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new BadRequestException('La fuente oficial de IPC no respondió correctamente');
    const payload = await response.json() as { publications?: Array<{ period: string; variationPercent: number }> };
    if (!Array.isArray(payload.publications)) throw new BadRequestException('La fuente de IPC no cumple el contrato configurado');
    let imported = 0;
    for (const item of payload.publications) {
      const existing = await this.prisma.publicacionIndice.findUnique({ where: { indiceId_periodo: { indiceId: index.id, periodo: item.period } } });
      if (!existing) { await this.upsert(index.id, item.period, item.variationPercent, this.ipcSourceUrl); imported++; }
    }
    return { imported, skipped: false };
  }
  async upsert(indexId: string, period: string, variationPercent: number, source: string, correctionReason?: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException('Período inválido');
    const variation = new Prisma.Decimal(variationPercent).div(100);
    const current = await this.prisma.publicacionIndice.findUnique({ where: { indiceId_periodo: { indiceId: indexId, periodo: period } } });
    if (current && !correctionReason) throw new BadRequestException('La corrección requiere un motivo');
    return this.prisma.publicacionIndice.upsert({ where: { indiceId_periodo: { indiceId: indexId, periodo: period } }, create: { indiceId: indexId, periodo: period, variacion: variation, fuente: source }, update: { variacionOriginal: current?.variacionOriginal ?? current?.variacion, variacion: variation, fuente: source, correccionMotivo: correctionReason, consultadoEn: new Date() } });
  }
}

@Injectable()
export class AdjustmentService {
  constructor(private readonly prisma: PrismaService) {}
  async preview(ruleId: string) {
    const rule = await this.prisma.reglaAjuste.findUnique({ where: { id: ruleId }, include: { plan: { include: { versiones: { orderBy: { vigenteDesde: 'desc' }, take: 1 } } }, indice: true } });
    if (!rule?.activa || !rule.plan.versiones[0]) throw new NotFoundException('Regla o precio vigente no encontrado');
    const end = new Date(rule.proximaRevision); const start = addMonths(end, -rule.frecuenciaMeses);
    const periods = Array.from({ length: rule.frecuenciaMeses }, (_, i) => monthKey(addMonths(start, i)));
    const publications = await this.prisma.publicacionIndice.findMany({ where: { indiceId: rule.indiceId, periodo: { in: periods } }, orderBy: { periodo: 'asc' } });
    const missing = periods.filter(p => !publications.some(v => v.periodo === p));
    let factor = new Prisma.Decimal(1); for (const item of publications) factor = factor.mul(item.variacion.add(1));
    const previous = rule.plan.versiones[0].importe; const proposed = previous.mul(factor).toDecimalPlaces(2);
    const status: EstadoAjuste = missing.length ? 'DATOS_INCOMPLETOS' : 'PENDIENTE_APROBACION';
    const key = `${rule.id}:${periods[0]}:${periods.at(-1)}`;
    return this.prisma.ejecucionAjuste.upsert({ where: { claveIdempotencia: key }, create: { reglaId: rule.id, periodoDesde: periods[0], periodoHasta: periods.at(-1)!, precioAnterior: previous, variacionAcumulada: factor.sub(1), precioPropuesto: missing.length ? null : proposed, fechaEfectiva: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1)), estado: status, claveIdempotencia: key, detalles: { create: publications.map(p => ({ publicacionId: p.id, periodo: p.periodo, variacion: p.variacion })) } }, update: { estado: status, variacionAcumulada: factor.sub(1), precioPropuesto: missing.length ? null : proposed }, include: { detalles: true } });
  }
  async approve(id: string, userId: string) {
    return this.prisma.$transaction(async tx => {
      const run = await tx.ejecucionAjuste.findUnique({ where: { id }, include: { regla: true } });
      if (!run || run.estado !== 'PENDIENTE_APROBACION' || !run.precioPropuesto) throw new BadRequestException('El ajuste no está listo para aprobar');
      const version = await tx.versionPrecio.create({ data: { planId: run.regla.planId, importe: run.precioPropuesto, vigenteDesde: run.fechaEfectiva, motivo: `Ajuste indexado ${run.periodoDesde} a ${run.periodoHasta}` } });
      await tx.reglaAjuste.update({ where: { id: run.reglaId }, data: { proximaRevision: addMonths(run.regla.proximaRevision, run.regla.frecuenciaMeses) } });
      await tx.ejecucionAjuste.update({ where: { id }, data: { estado: 'APROBADO', revisadoPorId: userId, revisadoEn: new Date(), versionPrecioId: version.id } });
      await tx.eventoAuditoria.create({ data: { usuarioSoporteId: userId, accion: 'AJUSTE_APROBADO', entidad: 'EjecucionAjuste', entidadId: id, detalle: { versionPriceId: version.id, amount: version.importe.toString() } } });
      return version;
    });
  }
  async reject(id: string, userId: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('El motivo es obligatorio');
    return this.prisma.ejecucionAjuste.update({ where: { id }, data: { estado: 'RECHAZADO', revisadoPorId: userId, revisadoEn: new Date(), motivoRevision: reason.trim() } });
  }
}

export const adjustmentMath = { addMonths, monthKey };
