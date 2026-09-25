import { BadRequestException, CanActivate, Controller, ExecutionContext, Get, Injectable, NotFoundException, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EstadoCargo, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Request } from 'express';
import { PrismaService } from './prisma.service';
import { MailQueueService, StorageService } from './support-services';

export interface ClientRequest extends Request { clientId: string; }

@Injectable()
export class ClientAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ClientRequest>();
    const identifier = request.header('x-client-id'); const secret = request.header('x-client-secret');
    if (!identifier || !secret) return false;
    const client = await this.prisma.clienteCentral.findUnique({ where: { identificador: identifier } });
    if (!client?.activo || !(await bcrypt.compare(secret, client.secretoHash))) return false;
    request.clientId = client.id; return true;
  }
}

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly mail: MailQueueService) {}
  async list(clientId: string, page = 1, pageSize = 10, search = '') {
    const where: Prisma.CargoWhereInput = { clienteId: clientId, ...(search ? { concepto: { contains: search, mode: 'insensitive' } } : {}) };
    const now = new Date();
    const [data, total, open, paid, overdue, plan] = await Promise.all([
      this.prisma.cargo.findMany({ where, orderBy: { fechaEmision: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { comprobantes: { orderBy: { fechaCarga: 'desc' }, take: 1 } } }),
      this.prisma.cargo.count({ where }),
      this.prisma.cargo.aggregate({ where: { clienteId: clientId, estado: { in: ['PENDIENTE', 'COMPROBANTE_ENVIADO', 'RECHAZADO'] } }, _sum: { importe: true }, _count: true }),
      this.prisma.cargo.count({ where: { clienteId: clientId, estado: 'PAGADO' } }),
      this.prisma.cargo.count({ where: { clienteId: clientId, estado: { in: ['PENDIENTE', 'COMPROBANTE_ENVIADO', 'RECHAZADO'] }, fechaVencimiento: { lt: now } } }),
      this.prisma.plan.findFirst({ where: { clienteId: clientId, activo: true }, include: { versiones: { where: { vigenteDesde: { lte: new Date() } }, orderBy: { vigenteDesde: 'desc' }, take: 1 }, regla: true } }),
    ]);
    return { data: data.map(c => this.present(c, now)), meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), summary: { total, pagadas: paid, pendientes: open._count, vencidas: overdue, deudaTotal: open._sum.importe?.toFixed(2) ?? '0.00', precioMensual: plan?.versiones[0]?.importe.toFixed(2) ?? null, proximaActualizacion: plan?.regla?.proximaRevision.toISOString().slice(0, 10) ?? null } } };
  }
  async get(clientId: string, id: string) {
    const charge = await this.prisma.cargo.findFirst({ where: { id, clienteId: clientId }, include: { comprobantes: { orderBy: { fechaCarga: 'desc' } } } });
    if (!charge) throw new NotFoundException('Cargo no encontrado');
    return this.present(charge, new Date(), true);
  }
  async upload(clientId: string, chargeId: string, file?: Express.Multer.File) {
    const charge = await this.prisma.cargo.findFirst({ where: { id: chargeId, clienteId: clientId } });
    if (!charge) throw new NotFoundException('Cargo no encontrado');
    if (charge.estado === 'PAGADO' || charge.estado === 'ANULADO') throw new BadRequestException('Este cargo no admite comprobantes');
    if (!file?.buffer?.length || file.size > 10 * 1024 * 1024) throw new BadRequestException('El archivo debe pesar hasta 10 MB');
    const detected = this.detect(file.buffer);
    if (!detected) throw new BadRequestException('Sólo se aceptan archivos PDF, JPG o PNG válidos');
    const stored = await this.storage.save(clientId, chargeId, file.buffer, detected.extension, detected.mime);
    const receipt = await this.prisma.$transaction(async tx => {
      const created = await tx.comprobante.create({ data: { cargoId: chargeId, storageKey: stored.key, mimeType: detected.mime, tamano: file.size, hashSha256: stored.hash } });
      await tx.cargo.update({ where: { id: chargeId }, data: { estado: 'COMPROBANTE_ENVIADO' } });
      await tx.eventoAuditoria.create({ data: { clienteId: clientId, accion: 'COMPROBANTE_CARGADO', entidad: 'Cargo', entidadId: chargeId, detalle: { receiptId: created.id, sha256: stored.hash } } });
      return created;
    });
    await this.mail.enqueue(receipt.id);
    return { id: receipt.id, status: 'COMPROBANTE_ENVIADO', uploadedAt: receipt.fechaCarga };
  }
  async receiptUrl(clientId: string, chargeId: string) {
    const receipt = await this.prisma.comprobante.findFirst({ where: { cargoId: chargeId, cargo: { clienteId: clientId } }, orderBy: { fechaCarga: 'desc' } });
    if (!receipt) throw new NotFoundException('Comprobante no encontrado');
    return { url: await this.storage.signedPath(receipt.id, receipt.storageKey), expiresIn: 300 };
  }
  private present(c: any, now: Date, detail = false) {
    const latest = c.comprobantes?.[0];
    return { id: c.id, numero: c.id.slice(0, 8).toUpperCase(), concepto: c.concepto, tipo: c.tipo, periodo: c.periodo, fechaEmision: c.fechaEmision.toISOString().slice(0, 10), fechaVencimiento: c.fechaVencimiento.toISOString().slice(0, 10), subtotal: c.importe.toFixed(2), impuestos: '0.00', total: c.importe.toFixed(2), estado: c.estado, vencida: !['PAGADO', 'ANULADO'].includes(c.estado) && c.fechaVencimiento < now, banco: detail ? c.banco : undefined, titular: detail ? c.titular : undefined, cuit: detail ? c.cuit : undefined, cbu: detail ? c.cbu : undefined, alias: detail ? c.alias : undefined, motivoRechazo: latest?.motivoRechazo ?? null, comprobanteId: latest?.id ?? null };
  }
  private detect(buffer: Buffer) {
    if (buffer.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', extension: 'pdf' };
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
    if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: 'image/png', extension: 'png' };
    return null;
  }
}

@Controller('client/billing') @UseGuards(ClientAuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}
  @Get('charges') list(@Req() req: ClientRequest, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('search') search?: string) { return this.billing.list(req.clientId, Math.max(1, Number(page) || 1), Math.min(100, Math.max(1, Number(pageSize) || 10)), search ?? ''); }
  @Get('charges/:id') get(@Req() req: ClientRequest, @Param('id') id: string) { return this.billing.get(req.clientId, id); }
  @Post('charges/:id/receipt') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } })) upload(@Req() req: ClientRequest, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) { return this.billing.upload(req.clientId, id, file); }
  @Get('charges/:id/receipt') receipt(@Req() req: ClientRequest, @Param('id') id: string) { return this.billing.receiptUrl(req.clientId, id); }
}
