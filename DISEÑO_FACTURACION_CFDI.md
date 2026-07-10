# DISEÑO — Módulo de Facturación CFDI 4.0 con timbrado (PAC: SW sapien)

> Documento de **diseño** (no implementación). Fase: definición de todos los componentes
> del sistema y la integración con DISMED y con el PAC. Consolidado por Claude Code a partir
> de: investigación de la API del PAC + subagente ingeniero senior (arquitectura/almacenamiento)
> + subagente diseñador web (UI de consulta). Fecha: 2026-06-18.
>
> **Premisa heredada:** ya existe la capa CFDI 4.0 "hasta el TXT, sin timbrar"
> (`cfdi.txt.generator.js`, `migrate_v11`). Este diseño cubre "del TXT hacia adelante":
> el timbrado, el almacenamiento del XML/PDF, la cancelación y la consulta.

---

## 0. Resumen ejecutivo — decisiones tomadas

| # | Decisión | Resultado |
|---|---|---|
| D1 | **Formato de integración con el PAC** | **JSON `issue`** (`/v4/cfdi33/issue/json/v4`). El PAC sella con el CSD precargado en su portal (ADT). NO manejamos OpenSSL ni .cer/.key localmente. |
| D2 | **Qué hacer con la respuesta del PAC** | Extraer y persistir UUID + sellos + cadena original + **guardar el XML timbrado completo** (obligación fiscal). El **PDF lo generamos nosotros** (Puppeteer, ya hay infra) con los datos del timbre + QR. |
| D3 | **Almacenamiento del XML** | **Híbrido**: archivo en `outputs/cfdi/<año>/` (reusa patrón `/outputs/`) + metadatos fiscales irreemplazables y respaldo del XML en BD. |
| D4 | **Modelo de datos** | Tabla nueva `cfdi_comprobantes` (1:N con `entregas`) + `cfdi_cancelaciones`. `entregas.estatus_cfdi` queda como espejo. |
| D5 | **Disparo del timbrado** | Acción **explícita** del usuario (no automática al crear la entrega), por ser fiscalmente irreversible. |
| D6 | **Bloqueante previo** | Versionar y **poblar** `productos.clave_sat` y `productos.clave_unidad_sat` (ClaveProdServ / ClaveUnidad SAT). Sin esto no se puede timbrar nada. |

---

## 1. Decisión de integración: XML vs JSON

El PAC SW sapien ofrece **tres** modos. URLs base: pruebas `https://services.test.sw.com.mx`,
producción `https://services.sw.com.mx`.

| Modo | Endpoint | ¿Quién sella? | Manejo del CSD | Complejidad |
|---|---|---|---|---|
| **JSON `issue`** ✅ | `POST /v4/cfdi33/issue/json/v4` (`Content-Type: application/jsontoxml`) | **El PAC** | Precargado en portal SW (ADT), se localiza por RFC emisor. **No se envía.** | **Baja** |
| XML `issue` | `POST /cfdi33/issue/v4` (form-data file o JSON base64) | El PAC | Precargado en portal | Media (armar XML) |
| XML `stamp` | `POST /cfdi33/stamp/v4` | **Nosotros** | Manejamos .cer/.key + OpenSSL localmente | Alta |

**Decisión: JSON `issue`.** Justificación:
- **No construimos XML ni cadena original ni sellos** — mandamos un objeto JSON (que ya casi
  tenemos armado en el TXT actual) y el PAC devuelve el XML timbrado listo.
- **No custodiamos llaves privadas (.key) ni manejamos OpenSSL** en el servidor → menor
  superficie de seguridad y menos mantenimiento. El PAC custodia el CSD.
- **Trade-off vs `stamp`:** con `stamp` tendríamos control total del sellado sin depender del
  ADT, pero a costa de manejar criptografía y custodia de llaves. Para este equipo, JSON-issue
  es la opción correcta. Prerrequisito: el CSD del RFC `RIC1903041Q2` debe estar **dado de alta
  y vigente en el portal de SW**.

**Autenticación:** `POST /security/authenticate` (usuario/contraseña) → **token Bearer válido
2 horas**. También existe token permanente desde el portal. Diseño: soportar ambos (si
`SW_TOKEN` está en env, usarlo; si no, auth dinámica con caché de 2h).

---

## 2. Requisitos técnicos y del SAT para timbrar

Para que el SAT acepte el timbrado (CFDI 4.0), por comprobante se requiere:

**Emisor** (ya en `.env`): RFC `RIC1903041Q2`, `Nombre` **exacto a la Constancia de Situación
Fiscal**, `RegimenFiscal=626` (RESICO Persona Moral), `LugarExpedicion=04410` (CP).

**Receptor** (en `clientes`): `Rfc`, `Nombre` exacto a su CSF (en 4.0 sin régimen societario si
la CSF así lo indica), `DomicilioFiscalReceptor` = `codigo_postal`, `RegimenFiscalReceptor` =
clave SAT, `UsoCFDI`.

**Comprobante:** `Version=4.0`, `Fecha` (≤72h respecto al timbrado, zona CDMX -06:00),
`FormaPago`, `MetodoPago` (PUE/PPD), `Moneda`, `TipoDeComprobante=I`, `Exportacion=01`
(no aplica), `SubTotal`, `Total`.

**Por concepto:** `ClaveProdServ` (catálogo SAT), `ClaveUnidad` (catálogo SAT), `Cantidad`,
`Descripcion`, `ValorUnitario`, `Importe`, `ObjetoImp` (`01` no objeto / `02` sí objeto de
impuesto), y nodo `Impuestos.Traslados` (IVA 16%) cuando no es exento.

**Validaciones que rechazan (no reintentables):** RFC receptor no en la lista LCO del SAT,
nombre/CP que no concuerdan con la CSF, ClaveProdServ/ClaveUnidad inexistentes, totales mal
calculados. → corregir datos, no reintentar igual.

> El módulo actual ya valida casi todo esto en `validarFactura()` (`cfdi.txt.generator.js`).
> Se reutiliza intacto.

---

## 3. Qué hacer con la respuesta del PAC

Respuesta JSON exitosa:
```json
{ "status": "success", "data": {
  "cadenaOriginalSAT": "...", "noCertificadoSAT": "...", "noCertificadoCFDI": "...",
  "uuid": "....", "selloSAT": "...", "selloCFDI": "...",
  "fechaTimbrado": "2026-...", "qrCode": "...", "cfdi": "<?xml ... XML timbrado ...>" }}
```
Error: `{ "status": "error", "message": "...", "messageDetail": "..." }`.

**Decisión (D2):**
1. **Persistir el XML timbrado completo** (`data.cfdi`) → es el documento fiscal con valor legal
   (obligación de conservarlo 5 años). Va a disco + respaldo en BD.
2. **Extraer y guardar en columnas** `uuid`, `selloSAT`, `selloCFDI`, `cadenaOriginalSAT`,
   `noCertificadoSAT`, `fechaTimbrado` → permiten reconstruir/re-descargar el CFDI y armar la
   representación impresa sin re-parsear el XML.
3. **El PDF lo generamos nosotros** (Puppeteer; ya existe `ventas.pdf.js`) con la marca de
   INNOVACOM + QR del timbre. El PAC ofrece PDF, pero generarlo propio da control de plantilla y
   evita una llamada extra. (El `qrCode` que devuelve el PAC se guarda; si falta, es derivable
   del estándar SAT: `?id=UUID&re=RFCemisor&rr=RFCreceptor&tt=total&fe=últimos8delselloSAT`.)

---

## 4. Modelo de datos (DISEÑO — iría en `migrate_v12.js`)

**Decisión (D4): tabla nueva, NO extender `entregas`.** Razón: la relación real es 1:N
(una entrega puede tener un CFDI cancelado y otro vigente tras una sustitución), y el rastro
fiscal del CFDI cancelado **debe conservarse**.

```sql
-- ⚠️ DISEÑO — no ejecutar; revisar antes de crear migrate_v12.js

CREATE TABLE IF NOT EXISTS cfdi_comprobantes (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  entrega_id          INT UNSIGNED NOT NULL,
  uuid                CHAR(36)      NULL,        -- folio fiscal; NULL hasta timbrar
  serie               VARCHAR(25)   NULL,
  folio               VARCHAR(40)   NULL,        -- = entregas.folio
  fecha_emision       DATETIME      NULL,        -- Comprobante@Fecha (la que mandamos)
  fecha_timbrado      DATETIME      NULL,        -- TFD@FechaTimbrado
  sello_cfdi          TEXT          NULL,
  sello_sat           TEXT          NULL,
  no_certificado_cfdi VARCHAR(20)   NULL,
  no_certificado_sat  VARCHAR(20)   NULL,
  cadena_original_sat TEXT          NULL,
  qr_code             MEDIUMTEXT    NULL,
  subtotal            DECIMAL(12,2) NULL,
  total_impuestos     DECIMAL(12,2) NULL,
  total               DECIMAL(12,2) NULL,
  moneda              VARCHAR(3)    NOT NULL DEFAULT 'MXN',
  tipo_comprobante    CHAR(1)       NOT NULL DEFAULT 'I',
  xml_path            VARCHAR(255)  NULL,        -- /outputs/cfdi/2026/FAC-2026-0001.xml
  pdf_path            VARCHAR(255)  NULL,
  xml_raw             LONGTEXT      NULL,        -- respaldo del XML timbrado (red de seguridad)
  sha256_xml          CHAR(64)      NULL,        -- integridad del archivo en disco
  estatus             ENUM('pendiente','en_proceso','timbrado','error','cancelado')
                        NOT NULL DEFAULT 'pendiente',
  pac_error_code      VARCHAR(20)   NULL,
  pac_error_msg       TEXT          NULL,
  ambiente            ENUM('test','prod') NOT NULL DEFAULT 'test',
  usuario_id          INT UNSIGNED  NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cfdi_uuid (uuid),
  KEY idx_cfdi_entrega (entrega_id),
  CONSTRAINT fk_cfdi_entrega FOREIGN KEY (entrega_id) REFERENCES entregas(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Anti-doble-timbre: columna generada = entrega_id solo si el CFDI está "vivo".
ALTER TABLE cfdi_comprobantes
  ADD COLUMN entrega_vigente INT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN estatus IN ('pendiente','en_proceso','timbrado')
                              THEN entrega_id ELSE NULL END) STORED,
  ADD UNIQUE KEY uq_cfdi_entrega_vigente (entrega_vigente);

CREATE TABLE IF NOT EXISTS cfdi_cancelaciones (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cfdi_id           INT UNSIGNED NOT NULL,
  motivo            ENUM('01','02','03','04') NOT NULL,
  folio_sustitucion CHAR(36)     NULL,          -- obligatorio si motivo='01'
  estatus           ENUM('solicitada','en_proceso','cancelada','rechazada')
                       NOT NULL DEFAULT 'solicitada',
  acuse_xml_path    VARCHAR(255) NULL,
  acuse_raw         MEDIUMTEXT   NULL,
  fecha_solicitud   DATETIME     NULL,
  fecha_cancelacion DATETIME     NULL,
  usuario_id        INT UNSIGNED NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_canc_cfdi (cfdi_id),
  CONSTRAINT fk_canc_cfdi FOREIGN KEY (cfdi_id) REFERENCES cfdi_comprobantes(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`entregas.estatus_cfdi` (de `migrate_v11`) se mantiene como espejo para listados rápidos;
considerar agregarle el valor `'error'`.

---

## 5. Almacenamiento de XML / PDF / acuses (D3 — híbrido)

| Artefacto | Filesystem | BD |
|---|---|---|
| XML timbrado | `xml_path` (operativo, servido por `/outputs/`) | `xml_raw` (respaldo) + `sha256_xml` (integridad) |
| PDF | `pdf_path` | solo ruta |
| Acuse de cancelación | `acuse_xml_path` | `acuse_raw` (respaldo) |
| UUID, sellos, cadena original | — | columnas dedicadas |

Estructura de carpetas (particionado por año para retención de 5 años):
```
outputs/cfdi/
  <AAAA>/
    <folio>.xml            # FAC-2026-0001.xml
    <folio>.pdf
    cancelaciones/
      <folio>__acuse.xml
```
- Nombre base = `entregas.folio` (único, generado por `sp_generar_folio('FAC')`).
- **Justificación del híbrido:** perder el XML timbrado es un problema fiscal grave; guardar los
  metadatos clave en BD permite reconstruir/re-descargar del SAT, y `xml_raw`+`sha256` dan red de
  seguridad contra borrado/corrupción en disco (relevante porque `/outputs` vive bajo OneDrive,
  que sincroniza, **no respalda**).
- **Acción para el dueño:** incluir `outputs/cfdi/` en un respaldo real fuera de OneDrive con
  retención ≥5 años (Art. 30 CFF). Nunca borrar comprobantes timbrados/cancelados.

---

## 6. Servicio de timbrado (`cfdi.timbrado.service.js` — DISEÑO)

Archivo nuevo en `src/modules/ventas/`, mismo patrón que `cfdi.txt.generator.js`. Usa `axios`.
Reutiliza `cargarFactura()` y `validarFactura()` existentes.

Firmas:
```js
async function getToken()                          // auth + caché 2h (o SW_TOKEN fijo)
function construirCfdiJson({ entrega, cliente, partidas })  // §7
async function timbrar(entregaId, { usuarioId })
async function cancelar(cfdiId, { motivo, folioSustitucion, usuarioId })
async function consultarEstatusSat(cfdiId)
```

**Flujo de `timbrar(entregaId)`:**
1. `data = cargarFactura(entregaId)` (404 si no existe; 400 si `tipo !== 'factura'`).
2. `v = validarFactura(data)`; si `!v.ok` → **422 + faltantes**.
3. **Idempotencia:** si ya hay CFDI `timbrado` para la entrega → devolverlo (no re-timbrar).
   Insertar fila `en_proceso` protegida por `uq_cfdi_entrega_vigente`; si choca el UNIQUE → 409.
4. `json = construirCfdiJson(data)` con `Sello/NoCertificado/Certificado` vacíos.
5. `token = await getToken()`.
6. `POST {SW_URL}/v4/cfdi33/issue/json/v4` (Bearer + `application/jsontoxml`, timeout 30s).
7. Parsear: `success` → seguir; `error` → guardar `pac_error_*`, clasificar reintentable.
8. **Persistir (orden por riesgo fiscal):** escribir XML a disco → sha256 → UPDATE fila con
   uuid/sellos/cadena/fecha/xml_path/`timbrado` → UPDATE `entregas.estatus_cfdi='timbrado'`.
9. PDF best-effort (fuera de la ruta crítica; regenerable si falla).

**Caso peligroso (timbró OK pero falló el guardado):** el UUID ya existe ante el SAT. Mitigación:
fila `en_proceso` creada **antes** del POST (bloquea re-timbrado ciego); persistir primero los
metadatos del UUID; **no** envolver el POST HTTP en transacción SQL; job/endpoint de
**reconciliación** que ante una fila `en_proceso` vieja consulta el estatus al SAT y completa o
libera.

**Errores del PAC:** datos (no reintentable) → `error` + mostrar `messageDetail`; transitorio
(timeout, 5xx, 401 token) → backoff máx 2-3 + re-auth; ambiguo (timeout tras enviar) →
reconciliación, nunca reintento ciego; sin timbres → alertar al dueño.

---

## 7. Mapeo entrega → CFDI 4.0 JSON + GAPS

`construirCfdiJson()` sustituye funcionalmente a `construirTxt()`. Origen de cada campo:

| Atributo CFDI 4.0 | Origen |
|---|---|
| Version / TipoDeComprobante / Exportacion | constantes `4.0` / `I` / `01` |
| Serie / Folio | de `entregas.folio` |
| Fecha | ahora, TZ -06:00 (CDMX) |
| FormaPago / MetodoPago / Moneda | `entregas.forma_pago` / `metodo_pago` / `moneda` |
| SubTotal / Total | `entregas.subtotal` / `total` |
| LugarExpedicion | `EMPRESA_CP` |
| Emisor.{Rfc,Nombre,RegimenFiscal} | env `EMPRESA_*` |
| Receptor.Rfc / Nombre | `clientes.rfc` / `razon_social` |
| Receptor.DomicilioFiscalReceptor | `clientes.codigo_postal` |
| Receptor.RegimenFiscalReceptor | `clientes.regimen_fiscal` |
| Receptor.UsoCFDI | `entregas.uso_cfdi ?? clientes.uso_cfdi` |
| Conceptos[].ClaveProdServ | **`productos.clave_sat`** ⚠️ GAP |
| Conceptos[].ClaveUnidad | **`productos.clave_unidad_sat`** ⚠️ GAP |
| Conceptos[].NoIdentificacion | `entregas_partidas.sku_interno` |
| Conceptos[].Cantidad / Unidad / Descripcion | `entregas_partidas.*` |
| Conceptos[].ValorUnitario / Importe | `precio_unitario` / `cantidad*precio` |
| Conceptos[].ObjetoImp | `iva_exento ? '01' : '02'` |
| Conceptos[].Impuestos.Traslados | si no exento: IVA 16% (Base, "002", "Tasa", "0.160000") |
| Impuestos.TotalImpuestosTrasladados | `entregas.iva` |

### GAPS críticos del modelo actual

1. **`productos.clave_sat` / `clave_unidad_sat` NO existen en ninguna migración ni en el schema.**
   *(Verificado: el código las lee — `cfdi.txt.generator.js:71-72,88,118` — y las escribe
   `import.catalogo.js:96-97` y el CLI, pero no hay `ADD COLUMN` versionado en `migrate_*.js`
   ni en `*.sql`.)* `validarFactura()` **bloquea** toda factura sin ellas.
   **Acción:** en `migrate_v12` `ALTER TABLE productos ADD COLUMN IF NOT EXISTS clave_sat
   VARCHAR(8) NULL, ADD COLUMN IF NOT EXISTS clave_unidad_sat VARCHAR(3) NULL;` y **poblar el
   catálogo** (insumos médicos suelen ser ClaveProdServ `42xxxxxx`, ClaveUnidad `H87`/`EA`).
   *Pendiente de verificación:* confirmar contra la BD de producción si la columna ya fue creada
   a mano (los INSERT de `import.catalogo` la usan); de cualquier forma debe versionarse.
2. **`Receptor.Nombre` exacto** según CSF del cliente (riesgo de rechazo CFDI40147).
3. **IEPS / descuentos:** `productos.ieps` existe pero no se arrastra a la entrega; v1 solo IVA
   16%. Confirmar que ningún producto requiere IEPS.
4. **Zona horaria de `Fecha`:** evitar `toISOString()` (UTC); emitir en -06:00.

---

## 8. Cancelación

Motivos SAT: `01` con errores **con** relación (requiere `folioSustitucion`), `02` con errores
**sin** relación, `03` no se llevó a cabo la operación, `04` operación nominativa en factura
global.

Flujo `cancelar(cfdiId, {motivo, folioSustitucion})`: validar `estatus='timbrado'`; si `01` exige
`folioSustitucion`; insertar `cfdi_cancelaciones('solicitada')`; `getToken()` → POST cancelación
del PAC (uuid, RFC emisor, motivo, [folioSustitucion]); según respuesta: **cancelada** (guardar
acuse XML a disco + `acuse_raw` en BD, marcar `cfdi_comprobantes.estatus='cancelado'` y
`entregas.estatus_cfdi='cancelado'`; la columna generada libera la entrega para re-emitir),
**en proceso** (requiere aceptación del receptor — regla 72h SAT → job posterior), o **rechazada**.
**Persistir SIEMPRE el acuse** (prueba legal). Sustitución: timbrar primero el CFDI nuevo, luego
cancelar el viejo con motivo 01 + ese UUID.

---

## 9. Endpoints REST y variables de entorno

**Endpoints** (bajo `/api/ventas`, tras `auth`):

| Método | Ruta | Acción |
|---|---|---|
| POST | `/entregas/:id/cfdi/timbrar` | Timbra (idempotente). 201 uuid/xml/pdf; 409 ya timbrada; 422 faltantes |
| GET | `/entregas/:id/cfdi` | Comprobante(s) de la entrega |
| GET | `/cfdi/:cfdiId/xml` | Descarga XML timbrado |
| GET | `/cfdi/:cfdiId/pdf` | Descarga PDF (genera on-demand si falta) |
| POST | `/cfdi/:cfdiId/cancelar` | Cancela (motivo, folioSustitucion) |
| GET | `/cfdi/:cfdiId/estatus-sat` | Consulta estatus ante el SAT |
| POST | `/cfdi/:cfdiId/email` | Envía XML+PDF a `clientes.email` (Nodemailer) |
| POST | `/entregas/:id/cfdi-txt` | **Se conserva** como contingencia (ya existe) |

**Variables de entorno nuevas:**
```bash
SW_AMBIENTE=test                       # test | prod
SW_URL_TEST=https://services.test.sw.com.mx
SW_URL_PROD=https://services.sw.com.mx
SW_USER=                               # auth dinámica
SW_PASSWORD=
SW_TOKEN=                              # (opcional) token permanente del portal
SW_TIMEOUT_MS=30000
CFDI_DIR=./outputs/cfdi
```

**Relación con el TXT actual:** `validarFactura()` y `cargarFactura()` se conservan intactos.
`construirTxt()` se reemplaza por `construirCfdiJson()` pero la ruta `/cfdi-txt` se mantiene como
**contingencia** (timbrado manual desde el portal del PAC si el servicio está caído). Cambiar
`crearEntrega()` para que **no** genere/timbre automáticamente: el timbrado debe ser explícito (D5).

---

## 10. Interfaz de usuario (consulta y operación de CFDI)

### 10.1 Navegación
Nuevo grupo **"Facturación"** en el Sidebar (icono `Receipt`), separado de "Consultas históricas"
(read-only) porque las facturas tienen acciones propias (timbrar/cancelar/reenviar). Rutas:
- `/facturacion/cfdi` → **ListaCFDI** (listado + filtros, patrón `ConsultasHistoricas.jsx`).
- `/facturacion/cfdi/:id` → **DetalleCFDI** (representación impresa + acciones; ruta propia para
  que `window.print()` use toda la página).

El timbrado/cancelación se disparan también desde `DetallePedido.jsx` (sección Entregas, donde
ya viven el badge `estatus_cfdi` y el botón TXT).

### 10.2 Lista de CFDI emitidos
Reusa el esqueleto de `ConsultasHistoricas`: card de resumen (vigentes / total facturado /
canceladas), filtros (`q` por UUID·RFC·cliente·serie-folio, rango de fechas, cliente, estatus,
forma/método de pago), tabla con columnas **Serie-Folio · Fecha · Cliente/RFC · UUID · Método ·
Total · Estatus(badge) · Ver**, paginación `keepPreviousData`, doble clic / botón `Eye` → detalle.

### 10.3 Detalle (representación impresa)
Header con acciones `no-print`: **Descargar PDF · Descargar XML · Reenviar email · Imprimir ·
Cancelar** (rojo, solo si `timbrado`). Cuerpo tipo factura: Emisor / Receptor / Conceptos
(ClaveProdServ, descripción, cantidad, unidad, V.U., importe) / Totales / **Timbre Fiscal Digital**
(UUID + botón copiar, sellos en `font-mono text-[10px] break-all`, cadena original colapsable) +
**QR**. Bloque de **acuse** condicional si `cancelado` (`bg-red-50`).

### 10.4 Máquina de estados en la UI (badges = `CFDI_BADGE` ya en `DetallePedido`)
```
pendiente(gray) ─Generar→ generado(blue) ─Timbrar(PAC)→ timbrado(green) ─Cancelar→ cancelado(red)
   │                          │
   └─422 faltantes─┘          └─error PAC→ se queda en generado + banner "Reintentar"
```
- **Timbrar:** botón en la fila de entrega-factura (`generado`/`pendiente`). Estado de carga con
  `Loader2 animate-spin`, `toast.success`, `invalidateQueries`.
- **422 (faltan datos fiscales):** reusa el bloque `bg-red-50` con lista de faltantes ya existente
  en `EntregaModal`.
- **Error del PAC:** banner rojo persistente con `messageDetail` + botón "Reintentar timbrado"
  (no avanza de estado).

### 10.5 Modal de cancelación
Selector de motivo SAT 01–04; campo **UUID de sustitución** condicional (solo motivo 01);
**checkbox de confirmación** obligatorio (evita cancelaciones accidentales); al éxito muestra el
acuse con botón de descarga. Estado intermedio "en proceso de cancelación" en `badge-yellow`.

### 10.6 Impresión y móvil/PWA
- Reusa reglas `@media print` de `index.css` (oculta sidebar/acciones; `.card` sin sombra).
  Encabezado solo-impresión "Representación impresa del CFDI" (`hidden print:block`); el QR debe
  imprimirse (`<img>` real, `print-color-adjust: exact`).
- Móvil: en `< md` la tabla se vuelve **tarjetas apiladas** (toda la tarjeta navega al detalle);
  filtros avanzados en acordeón; acciones táctiles ≥44px; confirmación explícita en Cancelar.
- **Compartir constantes:** extraer `FORMAS_PAGO`, `METODOS_PAGO`, `USOS_CFDI`, `CFDI_BADGE`,
  `MOTIVOS_CANCELACION` (hoy inline en `DetallePedido.jsx`) a `src/constants/sat.js`.

---

## 11. Riesgos y decisiones abiertas (requieren al dueño)

1. **CSD en el portal del PAC** — confirmar que el .cer/.key del RFC `RIC1903041Q2` ya está
   cargado y vigente en SW (sin esto JSON-issue no puede sellar). **[bloqueante]**
2. **Claves SAT en productos** (§7 GAP 1) — versionar columnas + estrategia de captura/poblado
   masivo (¿default por familia? ¿IA para sugerir ClaveProdServ?). **[bloqueante]**
3. **`EMPRESA_NOMBRE` exacto a la CSF** — riesgo de rechazo masivo si no coincide.
4. **Régimen 626 RESICO PM** — validar reglas/usos CFDI permitidos con el contador.
5. **Token permanente vs credenciales** — preferencia del dueño.
6. **Respaldo de `outputs/cfdi/` fuera de OneDrive** con retención 5 años.
7. **IEPS / descuentos** — confirmar fuera de alcance v1.
8. **PDF propio (Puppeteer) vs PDF del PAC** — recomendado propio.
9. **Credenciales del PAC** (usuario/contraseña o token) — obtenerlas para `.env`.

---

## 12. Roadmap de implementación sugerido (cuando se apruebe codificar)

- **Fase 0 (prerrequisitos):** `migrate_v12` (columnas claves SAT + tablas `cfdi_comprobantes`/
  `cfdi_cancelaciones`); poblar claves SAT del catálogo; cargar CSD en portal SW; obtener
  credenciales `.env`.
- **Fase 1 (timbrado feliz):** `cfdi.timbrado.service.js` (auth+caché, `construirCfdiJson`,
  `timbrar`), endpoint `/entregas/:id/cfdi/timbrar`, persistencia XML+metadatos, botón Timbrar en
  `DetallePedido`. Probar contra **sandbox** (`services.test`).
- **Fase 2 (consulta + PDF):** módulo `/facturacion/cfdi` (Lista + Detalle), PDF Puppeteer con QR,
  descargas XML/PDF, reenvío por email.
- **Fase 3 (cancelación + robustez):** `cancelar`, modal de cancelación, acuses, reconciliación de
  `en_proceso`, consulta de estatus SAT, manejo fino de errores del PAC.
- **Fase 4 (producción):** cambiar `SW_AMBIENTE=prod`, pruebas con CFDI reales, respaldo de
  `outputs/cfdi/`.

---

*Fuentes de la integración PAC:* developers.sw.com.mx (Emisión Timbrado JSON / XML, Ejemplos 4.0,
Timbrado V4) y la colección Postman de SW. Verificación de gaps: lectura directa del código de
`dismed/backend` (cfdi.txt.generator.js, ventas.controller.js, import.catalogo.js, migraciones).
