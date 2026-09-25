import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ModalidadPrecio, Prisma, TipoCargo } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Request } from 'express';
import { AdjustmentService, IndexSourceService } from './adjustments';
import { AuthService } from './auth';
import { PrismaService } from './prisma.service';
import { StorageService } from './support-services';

interface AdminRequest extends Request { supportUserId: string; }
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AdminRequest>(); const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return false;
    try { const payload = await this.auth.verify(token); const user = await this.prisma.usuarioSoporte.findUnique({ where: { id: payload.sub } }); if (!user?.activo) return false; req.supportUserId = user.id; return true; } catch { return false; }
  }
}

class ClientDto { @IsString() @MaxLength(160) name: string; @IsString() @MaxLength(80) identifier: string; @IsString() @MinLength(24) secret: string; @IsOptional() @IsString() bank?: string; @IsOptional() @IsString() holder?: string; @IsOptional() @IsString() taxId?: string; @IsOptional() @IsString() cbu?: string; @IsOptional() @IsString() alias?: string; }
class PlanDto { @IsUUID() clientId: string; @IsString() @MaxLength(160) name: string; @IsEnum(ModalidadPrecio) mode: ModalidadPrecio; @IsNumber() @IsPositive() amount: number; @IsDateString() effectiveFrom: string; @IsInt() @Min(1) @Max(28) issueDay = 1; @IsInt() @Min(1) @Max(90) dueDays = 10; }
class ChargeDto { @IsUUID() clientId: string; @IsOptional() @IsUUID() planId?: string; @IsEnum(TipoCargo) type: TipoCargo; @IsString() @MaxLength(255) concept: string; @IsOptional() @IsString() period?: string; @IsNumber() @IsPositive() amount: number; @IsDateString() issueDate: string; @IsDateString() dueDate: string; @IsOptional() @IsString() bank?: string; @IsOptional() @IsString() holder?: string; @IsOptional() @IsString() taxId?: string; @IsOptional() @IsString() cbu?: string; @IsOptional() @IsString() alias?: string; }
class IndexDto { @IsString() @MaxLength(40) code: string; @IsString() @MaxLength(160) name: string; @IsOptional() @IsString() sourceUrl?: string; }
class PublicationDto { @IsString() period: string; @IsNumber() variationPercent: number; @IsString() source: string; @IsOptional() @IsString() correctionReason?: string; }
class RuleDto { @IsUUID() planId: string; @IsUUID() indexId: string; @IsInt() @Min(1) @Max(12) frequencyMonths: number; @IsDateString() baseDate: string; @IsDateString() nextReview: string; }
class ReasonDto { @IsString() @MinLength(3) @MaxLength(500) reason: string; }

@Controller('admin') @UseGuards(AdminJwtGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService, private readonly adjustments: AdjustmentService, private readonly indices: IndexSourceService, private readonly storage: StorageService) {}
  @Get('dashboard') async dashboard() {
    const [clients, pendingReceipts, pendingAdjustments, incomplete] = await Promise.all([this.prisma.clienteCentral.count({ where: { activo: true } }), this.prisma.cargo.count({ where: { estado: 'COMPROBANTE_ENVIADO' } }), this.prisma.ejecucionAjuste.count({ where: { estado: 'PENDIENTE_APROBACION' } }), this.prisma.ejecucionAjuste.count({ where: { estado: 'DATOS_INCOMPLETOS' } })]);
    return { clients, pendingReceipts, pendingAdjustments, incomplete };
  }
  @Get('clients') clients() { return this.prisma.clienteCentral.findMany({ select: { id: true, nombre: true, identificador: true, activo: true, fechaCreacion: true }, orderBy: { nombre: 'asc' } }); }
  @Post('clients') async createClient(@Body() dto: ClientDto, @Req() req: AdminRequest) { const client = await this.prisma.clienteCentral.create({ data: { nombre: dto.name.trim(), identificador: dto.identifier.trim(), secretoHash: await bcrypt.hash(dto.secret, 12), banco: dto.bank, titular: dto.holder, cuit: dto.taxId, cbu: dto.cbu, alias: dto.alias } }); await this.audit(req, 'CLIENTE_CREADO', 'ClienteCentral', client.id); return { id: client.id, name: client.nombre, identifier: client.identificador }; }
  @Get('plans') plans() { return this.prisma.plan.findMany({ include: { cliente: { select: { nombre: true } }, versiones: { orderBy: { vigenteDesde: 'desc' }, take: 1 }, regla: { include: { indice: true } } }, orderBy: { nombre: 'asc' } }); }
  @Post('plans') async createPlan(@Body() dto: PlanDto, @Req() req: AdminRequest) { const plan = await this.prisma.plan.create({ data: { clienteId: dto.clientId, nombre: dto.name.trim(), modalidad: dto.mode, diaEmision: dto.issueDay, diasVencimiento: dto.dueDays, versiones: { create: { importe: new Prisma.Decimal(dto.amount), vigenteDesde: new Date(dto.effectiveFrom) } } }, include: { versiones: true } }); await this.audit(req, 'PLAN_CREADO', 'Plan', plan.id); return plan; }
  @Get('charges') charges(@Query('status') status?: any) { return this.prisma.cargo.findMany({ where: status ? { estado: status } : {}, include: { cliente: { select: { nombre: true } }, comprobantes: { orderBy: { fechaCarga: 'desc' }, take: 1 } }, orderBy: { fechaCreacion: 'desc' }, take: 200 }); }
  @Get('receipts/:id/url') async receiptUrl(@Param('id') id: string) { const receipt = await this.prisma.comprobante.findUnique({ where: { id } }); if (!receipt) throw new BadRequestException('Comprobante inexistente'); return { url: this.storage.signedPath(id), expiresIn: 300 }; }
  @Post('charges') async createCharge(@Body() dto: ChargeDto, @Req() req: AdminRequest) { const charge = await this.prisma.cargo.create({ data: { clienteId: dto.clientId, planId: dto.planId, tipo: dto.type, concepto: dto.concept.trim(), periodo: dto.period, importe: new Prisma.Decimal(dto.amount), fechaEmision: new Date(dto.issueDate), fechaVencimiento: new Date(dto.dueDate), banco: dto.bank, titular: dto.holder, cuit: dto.taxId, cbu: dto.cbu, alias: dto.alias } }); await this.audit(req, 'CARGO_CREADO', 'Cargo', charge.id); return charge; }
  @Patch('charges/:id/confirm') async confirm(@Param('id') id: string, @Req() req: AdminRequest) { return this.reviewCharge(id, req.supportUserId, true); }
  @Patch('charges/:id/reject') async reject(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: AdminRequest) { return this.reviewCharge(id, req.supportUserId, false, dto.reason); }
  @Get('indices') indicesList() { return this.prisma.indice.findMany({ include: { publicaciones: { orderBy: { periodo: 'desc' }, take: 24 } } }); }
  @Post('indices') createIndex(@Body() dto: IndexDto) { return this.prisma.indice.create({ data: { codigo: dto.code.toUpperCase(), nombre: dto.name, fuenteUrl: dto.sourceUrl } }); }
  @Post('indices/:id/publications') publish(@Param('id') id: string, @Body() dto: PublicationDto) { return this.indices.upsert(id, dto.period, dto.variationPercent, dto.source, dto.correctionReason); }
  @Post('indices/import') importIndices() { return this.indices.importConfigured(); }
  @Post('adjustment-rules') createRule(@Body() dto: RuleDto) { if (![1,2,3,6,12].includes(dto.frequencyMonths)) throw new BadRequestException('Frecuencia no soportada'); return this.prisma.reglaAjuste.create({ data: { planId: dto.planId, indiceId: dto.indexId, frecuenciaMeses: dto.frequencyMonths, fechaBase: new Date(dto.baseDate), proximaRevision: new Date(dto.nextReview) } }); }
  @Get('adjustments') adjustmentsList() { return this.prisma.ejecucionAjuste.findMany({ include: { regla: { include: { plan: { include: { cliente: true } }, indice: true } }, detalles: true }, orderBy: { fechaEfectiva: 'desc' }, take: 200 }); }
  @Post('adjustment-rules/:id/preview') preview(@Param('id') id: string) { return this.adjustments.preview(id); }
  @Patch('adjustments/:id/approve') approve(@Param('id') id: string, @Req() req: AdminRequest) { return this.adjustments.approve(id, req.supportUserId); }
  @Patch('adjustments/:id/reject') rejectAdjustment(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: AdminRequest) { return this.adjustments.reject(id, req.supportUserId, dto.reason); }
  private async reviewCharge(id: string, userId: string, approve: boolean, reason?: string) { return this.prisma.$transaction(async tx => { const receipt = await tx.comprobante.findFirst({ where: { cargoId: id }, orderBy: { fechaCarga: 'desc' } }); if (!receipt) throw new BadRequestException('No hay comprobante para revisar'); await tx.comprobante.update({ where: { id: receipt.id }, data: { revisadoPorId: userId, revisadoEn: new Date(), motivoRechazo: approve ? null : reason } }); const charge = await tx.cargo.update({ where: { id }, data: { estado: approve ? 'PAGADO' : 'RECHAZADO' } }); await tx.eventoAuditoria.create({ data: { usuarioSoporteId: userId, clienteId: charge.clienteId, accion: approve ? 'PAGO_CONFIRMADO' : 'COMPROBANTE_RECHAZADO', entidad: 'Cargo', entidadId: id, detalle: reason ? { reason } : undefined } }); return charge; }); }
  private audit(req: AdminRequest, action: string, entity: string, id: string) { return this.prisma.eventoAuditoria.create({ data: { usuarioSoporteId: req.supportUserId, accion: action, entidad: entity, entidadId: id } }); }
}
