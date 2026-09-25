import { Controller, Get, Injectable, Logger, NotFoundException, Param, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { createTransport, Transporter } from 'nodemailer';
import { PrismaService } from './prisma.service';
import { Response } from 'express';

@Injectable()
export class StorageService {
  private readonly root: string;
  private readonly secret: string;
  private readonly supabase: SupabaseClient | null;
  private readonly bucket: string;
  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('STORAGE_PATH') ?? './private-storage');
    this.secret = config.get<string>('JWT_SECRET') ?? 'development-only-change-me';
    const supabaseUrl = config.get<string>('SUPABASE_URL');
    const serviceRoleKey = config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.bucket = config.get<string>('SUPABASE_STORAGE_BUCKET') ?? 'comprobantes';
    this.supabase = supabaseUrl && serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  }
  async save(clientId: string, chargeId: string, buffer: Buffer, extension: string, mimeType: string) {
    const hash = createHash('sha256').update(buffer).digest('hex');
    const key = `${clientId}/${chargeId}/${randomUUID()}.${extension}`;
    if (this.supabase) {
      const { error } = await this.supabase.storage.from(this.bucket).upload(key, buffer, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false,
      });
      if (error) throw new ServiceUnavailableException(`No se pudo guardar el comprobante: ${error.message}`);
      return { key, hash };
    }
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root)) throw new Error('Ruta de storage inválida');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: 'wx' });
    return { key, hash };
  }
  async signedPath(receiptId: string, storageKey: string, expiresInSeconds = 300) {
    if (this.supabase) {
      const { data, error } = await this.supabase.storage.from(this.bucket).createSignedUrl(storageKey, expiresInSeconds);
      if (error || !data?.signedUrl) throw new ServiceUnavailableException('No se pudo generar el acceso al comprobante');
      return data.signedUrl;
    }
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = createHmac('sha256', this.secret).update(`${receiptId}:${expires}`).digest('hex');
    return `/api/files/${receiptId}?expires=${expires}&signature=${signature}`;
  }
  verify(receiptId: string, expires: number, signature: string) {
    if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
    const expected = createHmac('sha256', this.secret).update(`${receiptId}:${expires}`).digest('hex');
    return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
  async read(key: string) {
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root)) throw new NotFoundException();
    return readFile(target);
  }
}

@Injectable()
export class MailQueueService {
  private readonly logger = new Logger(MailQueueService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  private readonly recipients: string[];
  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    const host = config.get<string>('MAIL_HOST'); const user = config.get<string>('MAIL_USER'); const pass = config.get<string>('MAIL_PASSWORD');
    this.from = config.get<string>('MAIL_FROM') ?? '';
    this.recipients = (config.get<string>('SUPPORT_EMAILS') ?? '').split(',').map(v => v.trim()).filter(Boolean);
    this.transporter = host && user && pass && this.from ? createTransport({ host, port: Number(config.get('MAIL_PORT') ?? 587), secure: config.get('MAIL_SECURE') === 'true', auth: { user, pass } }) : null;
  }
  async enqueue(receiptId: string) {
    return this.prisma.avisoCorreo.create({ data: { comprobanteId: receiptId, destinatarios: this.recipients.join(',') } });
  }
  async process() {
    const notices = await this.prisma.avisoCorreo.findMany({ where: { estado: { in: ['PENDIENTE', 'FALLIDO'] }, proximoIntento: { lte: new Date() }, intentos: { lt: 8 } }, include: { comprobante: { include: { cargo: { include: { cliente: true } } } } }, take: 20 });
    for (const notice of notices) {
      try {
        if (!this.transporter || !this.recipients.length) throw new ServiceUnavailableException('SMTP o destinatarios no configurados');
        await this.transporter.sendMail({ from: this.from, to: this.recipients, subject: `Nuevo comprobante: ${notice.comprobante.cargo.cliente.nombre}`, text: `Se recibió un comprobante para ${notice.comprobante.cargo.concepto}, por ARS ${notice.comprobante.cargo.importe.toFixed(2)}. Revisalo en el panel de soporte.` });
        await this.prisma.avisoCorreo.update({ where: { id: notice.id }, data: { estado: 'ENVIADO', enviadoEn: new Date(), intentos: { increment: 1 }, ultimoError: null } });
      } catch (error) {
        this.logger.warn(`No se pudo enviar aviso ${notice.id}`);
        const attempts = notice.intentos + 1;
        await this.prisma.avisoCorreo.update({ where: { id: notice.id }, data: { estado: 'FALLIDO', intentos: attempts, ultimoError: error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido', proximoIntento: new Date(Date.now() + Math.min(3600, 2 ** attempts * 60) * 1000) } });
      }
    }
  }
}

@Controller('files')
export class FilesController {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}
  @Get(':id') async download(@Param('id') id: string, @Query('expires') expiresRaw: string, @Query('signature') signature: string, @Res() response: Response) {
    if (!this.storage.verify(id, Number(expiresRaw), signature ?? '')) throw new NotFoundException();
    const receipt = await this.prisma.comprobante.findUnique({ where: { id } });
    if (!receipt) throw new NotFoundException();
    response.setHeader('Content-Type', receipt.mimeType);
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(await this.storage.read(receipt.storageKey));
  }
}
