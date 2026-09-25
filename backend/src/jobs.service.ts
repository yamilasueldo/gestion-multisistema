import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdjustmentService, IndexSourceService } from './adjustments';
import { MailQueueService } from './support-services';
import { PrismaService } from './prisma.service';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService, private readonly adjustments: AdjustmentService, private readonly indices: IndexSourceService, private readonly mail: MailQueueService) {}
  @Cron('0 0 2 * * *') importIndices() { return this.indices.importConfigured(); }
  @Cron('0 15 2 * * *') async generateMonthlyCharges() {
    const now = new Date(); const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const plans = await this.prisma.plan.findMany({ where: { activo: true, diaEmision: { lte: now.getUTCDate() } }, include: { cliente: true, versiones: { where: { vigenteDesde: { lte: now } }, orderBy: { vigenteDesde: 'desc' }, take: 1 } } });
    for (const plan of plans) { const price = plan.versiones[0]; if (!price) continue; const issue = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), plan.diaEmision)); const due = new Date(issue); due.setUTCDate(due.getUTCDate() + plan.diasVencimiento); await this.prisma.cargo.upsert({ where: { claveIdempotencia: `monthly:${plan.id}:${period}` }, update: {}, create: { clienteId: plan.clienteId, planId: plan.id, versionPrecioId: price.id, tipo: 'SUSCRIPCION', concepto: plan.nombre, periodo: period, importe: price.importe, fechaEmision: issue, fechaVencimiento: due, banco: plan.cliente.banco, titular: plan.cliente.titular, cuit: plan.cliente.cuit, cbu: plan.cliente.cbu, alias: plan.cliente.alias, claveIdempotencia: `monthly:${plan.id}:${period}` } }); }
  }
  @Cron('0 30 2 * * *') async prepareAdjustments() { const rules = await this.prisma.reglaAjuste.findMany({ where: { activa: true, proximaRevision: { lte: new Date() } } }); for (const rule of rules) await this.adjustments.preview(rule.id); }
  @Cron('0 */5 * * * *') processMail() { return this.mail.process(); }
}
