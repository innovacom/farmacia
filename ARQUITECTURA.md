# DISMED — Arquitectura del Sistema y Guía de Reimplementación

> Documento autocontenido para que una persona técnica externa entienda el sistema y lo pueda
> levantar/reimplementar en otro entorno **sin asistencia adicional**. Última actualización: 2026-06-18.

---

## 1. Qué es y qué problema resuelve

**DISMED** (marca comercial **INNOVACOM**) es un ERP web para una distribuidora de insumos médicos en México.

**Problema de negocio:** los hospitales/clínicas envían requisiciones en formatos heterogéneos (Excel, PDF, correo). El sistema extrae las partidas, consulta precios a varios proveedores, compara, aplica márgenes, genera la cotización al cliente en PDF y, tras la venta, administra órdenes de compra, recepción a inventario, entrega (remisión/factura) y la generación del archivo para timbrado CFDI 4.0.

**Cadena de trazabilidad por folios:** `SOL → COT → PED → OC → REC → REM/FAC`.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Frontend | React 18, Vite 5, TailwindCSS 3, React Router 6, @tanstack/react-query 5, Zustand (auth), react-hook-form, axios, react-hot-toast, lucide-react |
| Backend | Node.js 20, Express 4, MySQL/MariaDB (`mysql2/promise`), JWT (`jsonwebtoken`+`bcryptjs`) |
| IA | `@anthropic-ai/sdk` (parser de PDF, desempate de matching, búsqueda web de precios) |
| Archivos | Multer (uploads), SheetJS `xlsx` (Excel), `pdf-parse` (texto de PDF), Puppeteer (generación de PDF) |
| Correo | Nodemailer (SMTP) |
| Infra | PM2 (proceso), Apache (reverse proxy), Debian/Linux, MariaDB |

> **Nota MariaDB:** la producción usa MariaDB. `rows` es palabra reservada; los decimales fiscales tienen límites (p.ej. `decimal(5,4)` ≤ 9.9999).

---

## 3. Estructura del repositorio

```
sistema cotizaciones/
├─ dismed/
│  ├─ backend/
│  │  ├─ src/
│  │  │  ├─ app.js                  # entry Express, registra rutas /api/*
│  │  │  ├─ config/
│  │  │  │  ├─ db.js                # pool MySQL (límite 10, tz -06:00)
│  │  │  │  ├─ old-db.js            # pool read-only a la BD del sistema anterior (ETL)
│  │  │  │  └─ anthropic.js         # cliente Anthropic + modelo centralizado
│  │  │  ├─ middleware/             # auth (JWT), upload (Multer)
│  │  │  └─ modules/                # un folder por feature
│  │  │     ├─ auth/                # login, /me, seed admin
│  │  │     ├─ clientes/            # CRUD clientes + contactos + skus
│  │  │     ├─ proveedores/         # CRUD proveedores
│  │  │     ├─ productos/           # catálogo, SKU interno DM-#####
│  │  │     ├─ solicitudes/         # parser.excel.js, parser.pdf.js, matcher(.ia).js, buscador.web.js
│  │  │     ├─ cotizaciones/
│  │  │     │  ├─ proveedor/        # cotprov: consulta y precios de proveedores
│  │  │     │  └─ cliente/          # cotcli + pdf.generator.js (Puppeteer)
│  │  │     ├─ inventario/          # almacenes, existencias, movimientos (FEFO), catálogos
│  │  │     ├─ ventas/              # pedidos, OC, recepción, entregas + cfdi.txt.generator.js + ventas.pdf.js
│  │  │     ├─ consultas/           # consultas históricas (4 entidades, filtros)
│  │  │     └─ usuarios/            # gestión de usuarios (admin)
│  │  ├─ scripts/                   # ETL legacy (legacy_extract.js, legacy_load.js), wipe, migraciones de datos
│  │  ├─ migrate_v2.js … migrate_v11.js   # migraciones de esquema incrementales e idempotentes
│  │  ├─ ecosystem.config.js        # configuración PM2
│  │  └─ package.json
│  └─ frontend/
│     ├─ src/
│     │  ├─ main.jsx, App.jsx       # rutas
│     │  ├─ components/layout/      # Layout, Sidebar
│     │  ├─ pages/                  # Dashboard, Solicitudes, Cotizaciones, Clientes, Proveedores, Productos, Inventario, Ventas, Consultas, Usuarios
│     │  ├─ services/api.js         # axios + interceptor JWT
│     │  └─ store/authStore.js      # Zustand persistente
│     ├─ vite.config.js             # proxy /api y /outputs → http://localhost:3001
│     └─ package.json
├─ dismed_schema_v2.sql             # esquema base (MySQL)
├─ dismed_schema_vmariadb.sql       # esquema base (MariaDB)
├─ deploy.sh                        # provisión Debian 12 + Apache (automatizado)
├─ deploy_ssh.py                    # despliegue por SSH
└─ ARQUITECTURA.md                  # este documento
```

---

## 4. Modelo de datos

### Tablas núcleo
- **clientes** — razón social, RFC (NO único: las sucursales comparten RFC), `regimen_fiscal` (clave SAT), `uso_cfdi`, `codigo_postal` (domicilio fiscal CFDI 4.0), `email`, `tipo_cliente`, crédito, `activo`.
- **clientes_contactos**, **clientes_skus** (aprendizaje de códigos del cliente).
- **proveedores**, **proveedores_skus** (aprendizaje de SKU del proveedor), **proveedores_catalogo** (catálogo por proveedor con equivalencia al SKU interno).
- **productos** — `sku_interno` (DM-##### autogenerado), descripción, categoría, unidad, `clave_sat` (ClaveProdServ), `clave_unidad_sat` (ClaveUnidad).
- **solicitudes** (folio `SOL-AAAA-####`) + **solicitudes_partidas**.
- **cotizaciones_proveedor** + **cotizaciones_proveedor_precios** (con `es_mejor_precio`, `disponible`).
- **cotizaciones_cliente** (folio `COT-AAAA-####`) + **cotizaciones_cliente_partidas** (margen global y por línea).
- **pedidos_cliente** (folio `PED`) + **pedidos_cliente_partidas**.
- **ordenes_compra** (folio `OC`) + **ordenes_compra_partidas** (con `cantidad_recibida`).
- **recepciones** (folio `REC`) + **recepciones_partidas** → afectan inventario.
- **entregas** (folio `REM`/`FAC`) + **entregas_partidas**. Campos CFDI: `forma_pago`, `metodo_pago`, `moneda`, `uso_cfdi`, `cfdi_txt_path`, `estatus_cfdi`.
- **inventario_lotes**, **inventario_movimientos**, **almacenes**, **ubicaciones** (control por lote/caducidad, salida FEFO).
- **usuarios** (auth, rol).

### Vistas y procedimientos
- **v_comparador_precios** — solicitud + partidas + todos los precios de proveedores.
- **sp_generar_folio(serie)** — folios consecutivos por serie (SOL/COT/PED/OC/REC/REM/FAC).
- **sp_generar_sku()** — SKU interno DM-#####.

### Decisiones de diseño
1. **SKU learning:** se mapea código cliente ↔ interno ↔ proveedor; la primera vez el usuario confirma, luego es automático.
2. **Preservar original:** `codigo_cliente` y `descripcion_original` nunca se modifican.
3. **Márgenes en dos niveles:** global % + override por línea, ambos persistidos.
4. **Sucursales separadas:** cada sucursal es un cliente independiente aunque comparta RFC (el índice de `rfc` NO es único).

---

## 5. Flujo de negocio (workflow operativo)

1. **Solicitud** — sube Excel/PDF o captura manual. Excel→SheetJS, PDF→Anthropic. El usuario valida en tabla editable. Crea `solicitudes` + partidas.
2. **Consulta a proveedores** — genera `cotizaciones_proveedor`, registra precios, el comparador marca el mejor precio. Aprende SKU del proveedor.
3. **Cotización al cliente** — aplica margen, genera PDF (Puppeteer) en `/outputs/`. Estatus `borrador→enviada→aceptada/rechazada`.
4. **Pedido** — el cliente indica partidas ganadas; se crea el pedido y la cotización pasa a `aceptada`.
5. **Órdenes de compra** — agrupa pendientes por proveedor; una OC por proveedor con PDF.
6. **Recepción** — recepción (parcial posible) contra la OC; entra a inventario por lote/caducidad (FEFO).
7. **Entrega** — el usuario elige **remisión** o **factura**; salida FEFO de inventario.
   - **Factura (CFDI 4.0):** valida datos fiscales antes de confirmar (si faltan → HTTP 422 con lista; no se crea ni se descuenta inventario). Al pasar, genera el TXT en `/outputs/cfdi/<folio>.txt` y marca `estatus_cfdi='generado'`. El **timbrado al PAC queda pendiente**: solo se reescribirá `construirTxt()` en `cfdi.txt.generator.js`.

**Consultas históricas** (`/consultas`): 4 pestañas (solicitudes, cotizaciones, OC, pedidos) con filtros por nombre/descripción, código, SKU y rango de fechas. Incluye datos migrados del sistema anterior.

---

## 6. API REST (montada en `/api`)

Patrón de cada módulo: `modulo.routes.js` (define rutas, `router.use(auth)`) → `modulo.controller.js` (handlers `async (req,res,next){ try{}catch(err){ next(err) } }`). DB siempre con consultas parametrizadas; operaciones multi-tabla en transacción.

| Prefijo | Módulo | Endpoints clave |
|---------|--------|-----------------|
| `/api/auth` | auth | `POST /login`, `GET /me` |
| `/api/clientes` | clientes | CRUD; `GET /clientes?activos=1` (solo activos); contactos y skus |
| `/api/proveedores` | proveedores | CRUD |
| `/api/productos` | productos | CRUD, alta con SKU interno |
| `/api/solicitudes` | solicitudes | CRUD; `parseExcel`, `parsePdf`; `updatePartida` |
| `/api/cotizaciones-proveedor` | cotprov | iniciar consulta, registrar precios, calcular mejor precio |
| `/api/cotizaciones-cliente` | cotcli | crear cotización, generar PDF, cambiar estatus |
| `/api/inventario`, `/api/almacenes` | inventario | existencias, movimientos, almacenes, catálogos |
| `/api/ventas` | ventas | `POST /pedidos`, `POST /pedidos/:id/ordenes-compra`, `POST /ordenes-compra/:id/recepciones`, `POST /pedidos/:id/entregas`, `GET /entregas/:id/pdf`, `POST /entregas/:id/cfdi-txt` |
| `/api/consultas` | consultas | `GET /{solicitudes\|cotizaciones\|ordenes-compra\|pedidos}` + `/:id` |
| `/api/usuarios` | usuarios | gestión (admin) |
| `/api/catalogo-proveedores` | proveedores | catálogo por proveedor |

Archivos generados (PDF y TXT CFDI) se sirven como estáticos en `/outputs/*`.

---

## 7. Frontend

- **Rutas** (`App.jsx`): `/login` público; el resto bajo `RequireAuth` + `Layout`: `/dashboard`, `/solicitudes(/nueva, /:id, /:id/comparador, /:id/proveedores/:cpId)`, `/cotizaciones(/nueva/:solicitudId, /:id)`, `/clientes`, `/proveedores`, `/catalogo-proveedores`, `/productos`, `/inventario/*`, `/ventas/pedidos(/nuevo/:cotizacionId, /:id)`, `/consultas`, `/usuarios`.
- **Auth:** token JWT en Zustand (persistido en localStorage); interceptor axios añade `Authorization: Bearer`; en 401 se hace logout + redirect a `/login`.
- **Datos:** React Query (`useQuery`/`useMutation`, `queryKey` consistente, `invalidateQueries`). Formularios con react-hook-form. Estilos con clases Tailwind del proyecto (`card`, `input`, `label`, `btn-primary`, `badge-*`, `table-auto`, `text-brand-500`).
- **Proxy dev:** `vite.config.js` redirige `/api` y `/outputs` a `http://localhost:3001`.

---

## 8. Integración con la API de Anthropic

Centralizada en `src/config/anthropic.js` (`{ client, MODEL }`); `MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'`. Tres usos:
- **`parser.pdf.js`** — extrae partidas de PDFs. Usa **prompt caching**: las instrucciones estáticas van en el bloque `system` con `cache_control: { type: 'ephemeral' }`; solo el texto del documento es variable.
- **`matcher.ia.js`** — desempata el shortlist del matcher con **lista cerrada anti-alucinación** (la IA solo elige un `id` de los candidatos o `null`; el usuario confirma).
- **`buscador.web.js`** — usa la herramienta server-side `web_search` para encontrar precios en tiendas mexicanas; maneja `pause_turn`.

La IA siempre es asistente: sugiere, el humano decide.

---

## 9. Facturación CFDI 4.0 (estado actual: hasta el TXT)

- **Receptor** (`clientes`): RFC, razón social, `codigo_postal` (DomicilioFiscalReceptor), `regimen_fiscal` (clave SAT), `uso_cfdi`.
- **Emisor** (variables de entorno): `EMPRESA_RFC`, `EMPRESA_NOMBRE`, `EMPRESA_REGIMEN_FISCAL` (626), `EMPRESA_CP`.
- **Conceptos** (`productos`): `clave_sat` (ClaveProdServ), `clave_unidad_sat` (ClaveUnidad); ObjetoImp = `iva_exento ? '01' : '02'`, IVA 16%.
- **Validación** (`cfdi.txt.generator.js → validarFactura`): si falta algún dato → HTTP 422 con la lista exacta; bloquea la emisión.
- **TXT** (`construirTxt`): CSV con líneas `COMPROBANTE/EMISOR/RECEPTOR/CONCEPTO` en `/outputs/cfdi/<folio>.txt`.
- **Pendiente:** timbrado contra el PAC. Cuando exista la spec, **solo se reescribe `construirTxt()`**; validación y carga de datos se reaprovechan.

---

## 10. Variables de entorno (backend `.env`)

```ini
# Base de datos (MySQL/MariaDB)
DB_HOST=localhost
DB_PORT=3306
DB_USER=dismed_user
DB_PASSWORD=********
DB_NAME=dismed_db

# Auth
JWT_SECRET=********           # mínimo 32 caracteres
JWT_EXPIRES_IN=8h

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6

# Correo (SMTP)
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...

# Archivos y servidor
UPLOAD_DIR=./uploads
OUTPUT_DIR=./outputs
BASE_URL=http://localhost:3001
PORT=3001

# Membrete y datos fiscales del emisor (CFDI)
EMPRESA_NOMBRE=INNOVACOM
EMPRESA_RFC=RIC1903041Q2
EMPRESA_TELEFONO=...
EMPRESA_EMAIL=...
EMPRESA_DIRECCION=...
EMPRESA_WEB=...
EMPRESA_REP_LEGAL=...
EMPRESA_REGIMEN_FISCAL=626
EMPRESA_CP=04410

# Conexión a la BD del sistema anterior (solo para ETL histórico; read-only)
OLD_DB_HOST=...
OLD_DB_PORT=3306
OLD_DB_USER=...
OLD_DB_PASSWORD=...
OLD_DB_NAME=...
```

---

## 11. Puesta en marcha local

```bash
# Base de datos
mysql -u dismed_user -p dismed_db < dismed_schema_vmariadb.sql   # o dismed_schema_v2.sql en MySQL

# Backend
cd dismed/backend
npm install
node src/modules/auth/seed.js     # crea admin: admin@dismed.mx / Admin1234!  (cambiar al primer login)
# Aplicar migraciones incrementales en orden:
for f in migrate_v*.js; do node "$f"; done
npm run dev                        # nodemon, puerto 3001

# Frontend (otra terminal)
cd dismed/frontend
npm install
npm run dev                        # Vite, puerto 5173 → visita http://localhost:5173
```

> Puppeteer descarga ~170 MB de Chromium en `npm install`. Requiere espacio en disco e internet.

---

## 12. Despliegue a producción

Topología: Apache (puerto 80) → reverse proxy a Node (puerto 3001) bajo PM2. Frontend compilado a estáticos servidos por Apache.

- **`deploy.sh`** automatiza un Debian 12 limpio: instala Node 20 + PM2 + Apache, crea el usuario MySQL, compila el frontend (`npm run build` → `dist/`), arranca el backend bajo PM2 y configura el VirtualHost con proxys `/api` y `/outputs`. Requiere root/sudo. No incluye SSL (agregar certbot manualmente).
- **Rutas en el servidor de producción:**
  - Backend (PM2, proceso `dismed-api`): `/var/www/dismed/backend`
  - Frontend publicado: `/var/www/dismed/frontend/dist`
- **Procedimiento de actualización (resumen):**
  1. `scp` de los archivos cambiados a `/tmp`, luego `sudo mv` al destino (`/var/www` es de root, no admite scp directo).
  2. Si hay `migrate_vN.js` nuevo: `cd /var/www/dismed/backend && sudo node migrate_vN.js` (idempotente).
  3. `npm install` en el servidor solo si cambiaron dependencias.
  4. NO sobrescribir el `.env` del servidor (tiene credenciales propias); solo agregar claves nuevas.
  5. `pm2 restart dismed-api` (dotenv re-lee `.env` al arrancar).
  6. Frontend: `npm run build` y publicar `dist/` (con respaldo previo).
  7. Smoke test: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/clientes` debe dar `401` (autenticación), no `000`/`502`.

---

## 13. Migraciones de esquema

Archivos `migrate_vN.js` incrementales e **idempotentes** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) con un helper `run(label, sql)` que captura errores para poder reejecutar. Se corren en orden con `node migrate_vN.js`. Hitos relevantes:
- **v7** — cadena pedido → OC → recepción → entrega (folios PED/OC/REC/REM/FAC).
- **v10** — catálogo por proveedor (`proveedores_catalogo`).
- **v11** — campos CFDI 4.0: `clientes.codigo_postal`/`email`; `entregas.forma_pago/metodo_pago/moneda/uso_cfdi/cfdi_txt_path/estatus_cfdi`.
- Migración puntual: el índice `UNIQUE` de `clientes.rfc` se convirtió en índice normal (las sucursales comparten RFC).

---

## 14. Importación del sistema anterior (ETL histórico)

ETL en **dos fases** porque la BD antigua solo es accesible desde la IP de desarrollo y `dismed_db` solo desde el servidor:
1. `scripts/legacy_extract.js` (corre en dev) → extrae `cotizacion_encabezado`, `cotizacion_Detalle`, `cotizacion_detalle_proveedor`, clientes, usuarios y proveedores a JSON en `backend/data/legacy/`.
2. `scripts/legacy_load.js` (corre en el VPS) → mapea la entidad combinada antigua a `solicitudes` + `cotizaciones_cliente` + partidas + `cotizaciones_proveedor` + precios, preservando cadenas FK.

Resultado: 3,078 cotizaciones históricas (con sus partidas y precios) consultables en `/consultas`. Los 59 clientes/sucursales legacy quedaron `activo=0` (visibles en el histórico, ocultos al cotizar). `scripts/wipe_transaccional.js` limpia tablas transaccionales en pruebas (`--yes`, `--clientes`).

---

## 15. Restricciones y advertencias (gotchas)

- **Una sola BD = producción.** Cuidado extremo con DROP/TRUNCATE/DELETE; toda operación destructiva debe tener respaldo y confirmación.
- **MariaDB:** `rows` reservado; límites de decimales fiscales.
- **CFDI:** confirmar `EMPRESA_REGIMEN_FISCAL` y `EMPRESA_CP` contra la Constancia de Situación Fiscal. Los clientes importados no traen CP/régimen completos: deben capturarse antes de poder facturarles.
- **Sin suite de pruebas automatizada.** Validación manual (curl/Postman, DevTools, MySQL Workbench).
- **El backend de producción puede quedar más viejo que el repo local**: al copiar archivos completos (especialmente `app.js`) verificar que no se pise código más nuevo del servidor.

---

## Apéndice — Automatización de Claude Code en el repo (opcional)

Estas herramientas viven en `.claude/` y `.mcp.json`; son ayudas para el desarrollo y **no** afectan el runtime de la aplicación:
- **Skills** (`.claude/skills/`): `/deploy` (despliegue al VPS), `/migracion` (scaffold de `migrate_vN.js`), `/flujo-dismed` (este workflow de negocio).
- **Subagents** (`.claude/agents/`): `security-reviewer`, `code-reviewer`.
- **Hooks** (`.claude/settings.json` + `.claude/hooks/`): confirmación ante SQL destructivo; `node --check` automático sobre `.js` del backend tras editar; orientación obligatoria vía grafo (graphify).
- **MCP** (`.mcp.json`): `context7` (documentación viva de librerías) y `dismed-mysql` (consulta read-only a `dismed_db` vía túnel SSH `ssh -L 3307:localhost:3306 claude@<VPS>`; credenciales por las variables `DISMED_DB_USER`/`DISMED_DB_PASSWORD`, no se commitean).
- **graphify**: grafo de conocimiento del código en `graphify-out/` (`graphify query/path/explain`, `graphify update .` tras cambios).
