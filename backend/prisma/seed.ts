import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
async function main() {
  const email = process.env.SUPPORT_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPPORT_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error('Definí SUPPORT_ADMIN_EMAIL y SUPPORT_ADMIN_PASSWORD (mínimo 12 caracteres)');
  const claveHash = await bcrypt.hash(password, 12);
  await prisma.usuarioSoporte.upsert({
    where: { email },
    update: { claveHash, activo: true },
    create: { nombre: 'Soporte', email, claveHash },
  });
  await prisma.indice.upsert({ where: { codigo: 'IPC' }, update: {}, create: { codigo: 'IPC', nombre: 'Índice de precios al consumidor' } });
}
main().finally(() => prisma.$disconnect());
