# Módulo Descarga y Consulta de CFDI (SAT) — Diseño y Despliegue

Descarga masiva de CFDI **emitidos y recibidos** desde el SAT (Descarga Masiva de
Terceros), repositorio fiscal **encabezado–detalle**, importación histórica del
sistema anterior y consulta web del mismo estilo que las consultas históricas.

## Componentes

### Base de datos (`dismed/backend/migrate_v13.js`)
- `cfdi_repositorio` — encabezado (1 fila por UUID; `tipo` emitido/recibido; emisor,
  receptor, totales, impuestos, estatus, `origen` sat/legacy/sistema, `xml_path`).
- `cfdi_repositorio_conceptos` — detalle (renglones + impuestos por concepto).
- `cfdi_descargas` — bitácora de cada solicitud de descarga masiva.
- Namespace propio: **no** colisiona con `cfdi_comprobantes` (migrate_v12, bitácora de
  timbrado vía Facturama).

### Backend (`dismed/backend/src/modules/cfdi/`)
- `sat.fiel.js` — carga la e.firma (FIEL) desde `SAT_FIEL_DIR` (o `cfdi/efirma` en dev).
- `sat.client.js` — cliente del WS de Descarga Masiva (`@nodecfdi/sat-ws-descarga-masiva`,
  ESM vía `import()` dinámico): `validarFiel`, `solicitar`, `verificar`,
  `descargarPaquete`, `leerCfdisDeZip`. Para **recibidos** filtra a vigentes
  (`DocumentStatus active`), porque el SAT no permite descargar el XML de cancelados ajenos.
- `cfdi.parser.js` — CFDI 4.0/3.3 → encabezado + conceptos (`fast-xml-parser`).
- `cfdi.repo.js` — upsert idempotente por UUID (transacción).
- `sat.descarga.service.js` — orquestación resumible: `solicitarDescarga`,
  `procesarDescarga`, `ejecutarCompleto`, `procesarPendientes`, `descargaMensualAutomatica`.
- `cfdi.controller.js` / `cfdi.routes.js` — montado en `/api/cfdi`.
- `sat.cron.js` — **día 3 de cada mes 04:00 CDMX** descarga el mes anterior (emitidos y
  recibidos) + reanudación horaria de pendientes. Se activa con `SAT_CRON_ENABLED=true`.

### Frontend (`dismed/frontend/src/pages/Cfdi/ConsultaCfdi.jsx`)
- Tabs Emitidos/Recibidos, modo Encabezados/Conceptos, filtros (texto + rango de fechas),
  modal de comprobante (header + conceptos), bitácora de descargas y modal de **descarga
  manual** (tipo + mes/año). Ruta `/cfdi`, link "Facturas CFDI" en el sidebar.

### Importación histórica (sistema anterior `innova99_innovacom`)
Patrón de 2 fases (como cotizaciones):
- `scripts/legacy_cfdi_extract.js` — **DEV** → vuelca `Cfdi_Emitido`, `Cfdi_Encabezado`
  (recibidos), `Cfdi_Pagos` y sus detalles a `backend/data/legacy_cfdi/*.json`. **Ya
  ejecutado**: 614 emitidos + 4330 recibidos + 715 pagos; 1299 + 3779 conceptos.
- `scripts/legacy_cfdi_load.js` — **VPS** → carga esos JSON en `cfdi_repositorio`
  (origen `legacy`), idempotente por UUID.

## Estado de la verificación (hecho desde DEV)
- ✅ e.firma RIC1903041Q2 válida.
- ✅ Solicitud **emitidos** aceptada (5000).
- ✅ Solicitud **recibidos** aceptada (con filtro vigentes).
- ✅ Ciclo completo recibido 2024-03: SAT generó 117 CFDIs → ZIP 367 KB → 117 XML →
  parseados al esquema correctamente.
- ⏳ Migración + carga legacy en `dismed_db` y despliegue: **pendiente** (requiere VPS).

## Variables de entorno nuevas (backend `.env` del VPS)
```
SAT_FIEL_DIR=/var/www/dismed/efirma     # carpeta con .cer, .key y "clave sat.txt"
SAT_CRON_ENABLED=true                    # solo en el VPS (evita solicitudes duplicadas)
# EMPRESA_RFC ya existe (RIC1903041Q2); EMPRESA_RAZON_SOCIAL ya existe.
# SAT_FIEL_PASSWORD opcional si no se sube "clave sat.txt".
```

## Pasos de despliegue (VPS)
1. **Instalar dependencias nuevas** en el backend del VPS:
   ```
   cd /var/www/dismed/dismed/backend   # ajustar a la ruta real del backend
   npm install @nodecfdi/sat-ws-descarga-masiva @nodecfdi/credentials fast-xml-parser node-cron
   ```
2. **Subir el código** del módulo (`src/modules/cfdi/`, `migrate_v13.js`, scripts) y el
   **build** del frontend (`npm run build`).
3. **Subir la e.firma** a `SAT_FIEL_DIR` (los 3 archivos de `cfdi/efirma/`) y ajustar el
   `.env` con las variables de arriba.
4. **Migración**:
   ```
   node migrate_v13.js
   ```
5. **Importación histórica** (subir `backend/data/legacy_cfdi/*.json` desde dev y):
   ```
   node scripts/legacy_cfdi_load.js
   ```
6. **Reiniciar** el backend (PM2) para que tome el cron y las rutas:
   ```
   pm2 restart dismed-api
   ```
7. **Prueba manual** desde la web: /cfdi → "Descargar del SAT" (mes anterior). El SAT
   procesa en asíncrono; usa "Actualizar" en la bitácora hasta estado `descargada`.

## Scripts de diagnóstico (DEV)
- `node scripts/test_sat_descarga.js [emitido|recibido] [YYYY-MM]` — solicita + verifica.
- `node scripts/test_sat_full.js [emitido|recibido] [YYYY-MM]` — ciclo completo sin BD.
- `node scripts/discover_legacy_cfdi.js` — estructura de las tablas CFDI del sistema viejo.
