# Plataforma central de facturación

Contiene una API NestJS (`backend`) y el panel Angular de soporte (`frontend`). La API es la fuente de verdad de clientes, planes, precios versionados, índices, cargos y comprobantes.

## Puesta en marcha

1. Crear una base PostgreSQL y copiar `backend/.env.example` como `backend/.env`.
2. Ejecutar `npm install`, `npm run prisma:deploy` y `npm run prisma:seed` en `backend`.
3. Configurar en el backend de la peluquería `BILLING_API_URL`, `BILLING_CLIENT_ID` y `BILLING_CLIENT_SECRET`.
4. Ejecutar la API en el puerto 3100 y el panel en el puerto 4300.

El secreto de instalación sólo se muestra al crearlo y se conserva como hash. Los comprobantes se guardan fuera del árbol público y se entregan mediante enlaces HMAC con cinco minutos de vigencia.

## Índices

Las publicaciones se normalizan como variación decimal mensual. El endpoint administrativo recibe porcentajes (por ejemplo `3.2`) y los almacena como `0.032`. Corregir una publicación existente exige `correctionReason`. Una regla admite frecuencias de 1, 2, 3, 6 o 12 meses; las variaciones se componen y siempre requieren aprobación antes de crear una nueva versión de precio.

`IPC_SOURCE_URL` configura el adaptador automático. La fuente debe responder `{ "publications": [{ "period": "2026-08", "variationPercent": 3.2 }] }`; este contrato permite colocar un adaptador propio delante de la fuente oficial elegida. La tarea consulta diariamente y nunca pisa publicaciones existentes. Si falta un mes requerido, el ajuste queda en `DATOS_INCOMPLETOS` y no cambia precios.
