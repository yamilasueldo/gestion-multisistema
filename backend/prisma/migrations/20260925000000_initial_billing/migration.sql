-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ModalidadPrecio" AS ENUM ('FIJO', 'INCREMENTO_MANUAL', 'INDEXADO');

-- CreateEnum
CREATE TYPE "TipoCargo" AS ENUM ('DESARROLLO', 'SUSCRIPCION', 'EXTRAORDINARIO');

-- CreateEnum
CREATE TYPE "EstadoCargo" AS ENUM ('PENDIENTE', 'COMPROBANTE_ENVIADO', 'PAGADO', 'RECHAZADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "EstadoAjuste" AS ENUM ('PROGRAMADO', 'DATOS_INCOMPLETOS', 'PENDIENTE_APROBACION', 'APROBADO', 'RECHAZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "EstadoAviso" AS ENUM ('PENDIENTE', 'ENVIADO', 'FALLIDO');

-- CreateTable
CREATE TABLE "clientes_centrales" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(160) NOT NULL,
    "identificador" VARCHAR(80) NOT NULL,
    "secreto_hash" VARCHAR(255) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "banco" VARCHAR(120),
    "titular" VARCHAR(160),
    "cuit" VARCHAR(20),
    "cbu" VARCHAR(30),
    "alias" VARCHAR(80),
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_centrales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios_soporte" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "clave_hash" VARCHAR(255) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "usuarios_soporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planes" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "nombre" VARCHAR(160) NOT NULL,
    "modalidad" "ModalidadPrecio" NOT NULL,
    "dia_emision" INTEGER NOT NULL DEFAULT 1,
    "dias_vencimiento" INTEGER NOT NULL DEFAULT 10,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "planes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versiones_precio" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "importe" DECIMAL(12,2) NOT NULL,
    "vigente_desde" DATE NOT NULL,
    "motivo" VARCHAR(500),
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versiones_precio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indices" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(40) NOT NULL,
    "nombre" VARCHAR(160) NOT NULL,
    "fuente_url" VARCHAR(500),
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "indices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publicaciones_indices" (
    "id" UUID NOT NULL,
    "indice_id" UUID NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "variacion" DECIMAL(9,6) NOT NULL,
    "variacion_original" DECIMAL(9,6),
    "fuente" VARCHAR(500) NOT NULL,
    "correccion_motivo" VARCHAR(500),
    "consultado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publicaciones_indices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reglas_ajuste" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "indice_id" UUID NOT NULL,
    "frecuencia_meses" INTEGER NOT NULL,
    "fecha_base" DATE NOT NULL,
    "proxima_revision" DATE NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "reglas_ajuste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ejecuciones_ajuste" (
    "id" UUID NOT NULL,
    "regla_id" UUID NOT NULL,
    "periodo_desde" VARCHAR(7) NOT NULL,
    "periodo_hasta" VARCHAR(7) NOT NULL,
    "precio_anterior" DECIMAL(12,2) NOT NULL,
    "variacion_acumulada" DECIMAL(12,8),
    "precio_propuesto" DECIMAL(12,2),
    "fecha_efectiva" DATE NOT NULL,
    "estado" "EstadoAjuste" NOT NULL,
    "clave_idempotencia" VARCHAR(160) NOT NULL,
    "motivo_revision" VARCHAR(500),
    "revisado_por_id" UUID,
    "revisado_en" TIMESTAMPTZ(6),
    "version_precio_id" UUID,

    CONSTRAINT "ejecuciones_ajuste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detalles_ajuste" (
    "id" UUID NOT NULL,
    "ejecucion_id" UUID NOT NULL,
    "publicacion_id" UUID NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "variacion" DECIMAL(9,6) NOT NULL,

    CONSTRAINT "detalles_ajuste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargos" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "plan_id" UUID,
    "version_precio_id" UUID,
    "tipo" "TipoCargo" NOT NULL,
    "concepto" VARCHAR(255) NOT NULL,
    "periodo" VARCHAR(7),
    "importe" DECIMAL(12,2) NOT NULL,
    "moneda" VARCHAR(3) NOT NULL DEFAULT 'ARS',
    "fecha_emision" DATE NOT NULL,
    "fecha_vencimiento" DATE NOT NULL,
    "estado" "EstadoCargo" NOT NULL DEFAULT 'PENDIENTE',
    "banco" VARCHAR(120),
    "titular" VARCHAR(160),
    "cuit" VARCHAR(20),
    "cbu" VARCHAR(30),
    "alias" VARCHAR(80),
    "clave_idempotencia" VARCHAR(160),
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cargos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobantes" (
    "id" UUID NOT NULL,
    "cargo_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(80) NOT NULL,
    "tamano" INTEGER NOT NULL,
    "hash_sha256" VARCHAR(64) NOT NULL,
    "fecha_carga" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revisado_por_id" UUID,
    "revisado_en" TIMESTAMPTZ(6),
    "motivo_rechazo" VARCHAR(500),

    CONSTRAINT "comprobantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avisos_correo" (
    "id" UUID NOT NULL,
    "comprobante_id" UUID NOT NULL,
    "destinatarios" TEXT NOT NULL,
    "estado" "EstadoAviso" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "proximo_intento" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_error" VARCHAR(500),
    "enviado_en" TIMESTAMPTZ(6),

    CONSTRAINT "avisos_correo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_auditoria" (
    "id" UUID NOT NULL,
    "cliente_id" UUID,
    "usuario_soporte_id" UUID,
    "accion" VARCHAR(100) NOT NULL,
    "entidad" VARCHAR(80) NOT NULL,
    "entidad_id" VARCHAR(80) NOT NULL,
    "detalle" JSONB,
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clientes_centrales_identificador_key" ON "clientes_centrales"("identificador");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_soporte_email_key" ON "usuarios_soporte"("email");

-- CreateIndex
CREATE INDEX "planes_cliente_id_activo_idx" ON "planes"("cliente_id", "activo");

-- CreateIndex
CREATE INDEX "versiones_precio_plan_id_vigente_desde_idx" ON "versiones_precio"("plan_id", "vigente_desde" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "versiones_precio_plan_id_vigente_desde_key" ON "versiones_precio"("plan_id", "vigente_desde");

-- CreateIndex
CREATE UNIQUE INDEX "indices_codigo_key" ON "indices"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "publicaciones_indices_indice_id_periodo_key" ON "publicaciones_indices"("indice_id", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "reglas_ajuste_plan_id_key" ON "reglas_ajuste"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "ejecuciones_ajuste_clave_idempotencia_key" ON "ejecuciones_ajuste"("clave_idempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "ejecuciones_ajuste_version_precio_id_key" ON "ejecuciones_ajuste"("version_precio_id");

-- CreateIndex
CREATE UNIQUE INDEX "detalles_ajuste_ejecucion_id_periodo_key" ON "detalles_ajuste"("ejecucion_id", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "cargos_clave_idempotencia_key" ON "cargos"("clave_idempotencia");

-- CreateIndex
CREATE INDEX "cargos_cliente_id_estado_idx" ON "cargos"("cliente_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_storage_key_key" ON "comprobantes"("storage_key");

-- CreateIndex
CREATE INDEX "avisos_correo_estado_proximo_intento_idx" ON "avisos_correo"("estado", "proximo_intento");

-- CreateIndex
CREATE INDEX "eventos_auditoria_entidad_entidad_id_idx" ON "eventos_auditoria"("entidad", "entidad_id");

-- AddForeignKey
ALTER TABLE "planes" ADD CONSTRAINT "planes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes_centrales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versiones_precio" ADD CONSTRAINT "versiones_precio_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "planes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publicaciones_indices" ADD CONSTRAINT "publicaciones_indices_indice_id_fkey" FOREIGN KEY ("indice_id") REFERENCES "indices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reglas_ajuste" ADD CONSTRAINT "reglas_ajuste_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "planes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reglas_ajuste" ADD CONSTRAINT "reglas_ajuste_indice_id_fkey" FOREIGN KEY ("indice_id") REFERENCES "indices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ejecuciones_ajuste" ADD CONSTRAINT "ejecuciones_ajuste_regla_id_fkey" FOREIGN KEY ("regla_id") REFERENCES "reglas_ajuste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ejecuciones_ajuste" ADD CONSTRAINT "ejecuciones_ajuste_revisado_por_id_fkey" FOREIGN KEY ("revisado_por_id") REFERENCES "usuarios_soporte"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ejecuciones_ajuste" ADD CONSTRAINT "ejecuciones_ajuste_version_precio_id_fkey" FOREIGN KEY ("version_precio_id") REFERENCES "versiones_precio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_ajuste" ADD CONSTRAINT "detalles_ajuste_ejecucion_id_fkey" FOREIGN KEY ("ejecucion_id") REFERENCES "ejecuciones_ajuste"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_ajuste" ADD CONSTRAINT "detalles_ajuste_publicacion_id_fkey" FOREIGN KEY ("publicacion_id") REFERENCES "publicaciones_indices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes_centrales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "planes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_version_precio_id_fkey" FOREIGN KEY ("version_precio_id") REFERENCES "versiones_precio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_cargo_id_fkey" FOREIGN KEY ("cargo_id") REFERENCES "cargos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_revisado_por_id_fkey" FOREIGN KEY ("revisado_por_id") REFERENCES "usuarios_soporte"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos_correo" ADD CONSTRAINT "avisos_correo_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "comprobantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_auditoria" ADD CONSTRAINT "eventos_auditoria_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes_centrales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_auditoria" ADD CONSTRAINT "eventos_auditoria_usuario_soporte_id_fkey" FOREIGN KEY ("usuario_soporte_id") REFERENCES "usuarios_soporte"("id") ON DELETE SET NULL ON UPDATE CASCADE;
