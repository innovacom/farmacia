# Diseño — Integración de Facturas/Comprobantes PDF → DISMED (n8n)

> Documento para revisión del propietario **antes** de codificar.
> Fecha: 2026-07-01 · Continúa `memoria_integracion_dismed.md`.

---

## 0. Alcance confirmado

- **Facturas (CFDI) en PDF:** el dato que aporta valor es **lote y fecha de caducidad** por partida — el XML del CFDI no los trae. Se extraen con IA y se integran a `cfdi_repositorio` **y** al módulo de inventarios, para que se acepten automáticamente sin captura manual.
- **Comprobantes de pago:** sin integración adicional de datos. Solo se guardan y se relacionan con la factura pagada.
- **Dos vías de entrada (ambas alimentan el mismo pipeline), decidido 2026-07-01:**
  1. **Buzón de correo dedicado** — facturas/comprobantes que llegan por email de los proveedores.
  2. **Carpeta vigilada** — para los dos casos que no llegan por correo: facturas entregadas **físicamente** (se escanean y el escaneo se deposita en la carpeta) y comprobantes de pago que se **generan/descargan** directo a una carpeta (portal bancario, etc.), sin pasar por email.

  El backend (sección 3) es agnóstico del origen: solo recibe un PDF + tipo, sin importar si vino de correo o de carpeta.

## 1. Decisión de arquitectura

**n8n = capa de disparo/transporte. DISMED backend = capa de extracción e integración.**

En vez de que n8n llame directo a Gemini y luego intente escribir en la BD de DISMED (esquema en constante cambio, reglas de negocio de inventario ya viven en `movimientos.service.js`), n8n solo:
1. Detecta el correo/archivo nuevo.
2. Lo manda por HTTP a un webhook nuevo de DISMED.
3. Reacciona al resultado (éxito / revisión manual) para notificar y archivar.

Toda la extracción IA, el emparejamiento SKU y la escritura a BD ocurren **dentro de DISMED**, reutilizando:
- `config/ai.provider.js` (ya migrado a Gemini, ver `project_proveedor_ia_gemini`) — mismo patrón que `parser.pdf.js` de solicitudes.
- El principio ya establecido: **la IA asiste, pero si algo no cuadra se manda a revisión manual**, nunca se fuerza.

Ventaja: si mañana cambia el proveedor de IA u OCR, solo se toca el backend, no el flujo de n8n.

### 1.1 Corrección clave (2026-07-01): la factura se integra vía RECEPCIÓN, no como movimiento aislado

DISMED ya tiene un flujo completo **Pedido → Orden de Compra → Recepción → Entrega** (`ventas.controller.js`).
Hoy, `recepcion()` (línea 212) es donde el almacenista **teclea a mano** `numero_lote`/`fecha_caducidad`
por partida al recibir contra una OC — **exactamente la captura manual que se quiere eliminar**.

Por eso la factura en PDF **no crea un movimiento de inventario suelto**: se usa para **automatizar esa
misma recepción**, con el lote/caducidad tomados del PDF en vez de tecleados:

1. Extraer del PDF: `rfc_emisor`, folio/serie, fecha, total, UUID (si aparece) y por partida:
   descripción, código del proveedor (`no_identificacion`), cantidad, lote, fecha de caducidad.
2. `rfc_emisor` → `proveedores.rfc` → proveedor.
3. Buscar `ordenes_compra` de ese proveedor con `estatus IN ('abierta','parcial')` (candidatas).
4. Emparejar cada partida del PDF contra `ordenes_compra_partidas` **pendientes** (`cantidad > cantidad_recibida`)
   de esa OC, **solo por código exacto** — mismo principio que `DISEÑO_VINCULACION_PRODUCTO.md`
   ("solo los códigos exactos auto-vinculan", nunca por similitud de descripción):
   `proveedores_skus.sku_proveedor` exacto (preferente) o `productos.sku_interno`/EAN exacto.
5. Si **todas** las partidas del PDF emparejan 1:1 con partidas pendientes de una única OC candidata
   y las cantidades no exceden lo pendiente: se ejecuta la misma lógica transaccional de `recepcion()`
   (se extrae a una función compartida `recepcion.service.js` para no duplicarla) con el lote/caducidad
   del PDF — **recepción automática**.
6. Si algo no cuadra (proveedor no identificado, ninguna/varias OC candidatas, partida sin código exacto,
   cantidad no coincide, más de un almacén activo sin forma de elegir uno): **no se fuerza nada** — se
   deja en `revision_manual` con lo extraído guardado, para que el usuario complete la recepción desde
   la pantalla ya existente pero con lote/caducidad **pre-llenados** (ya no tiene que teclearlos, aunque
   sí confirme la operación).
7. Independiente de si hubo recepción automática, si se identifica el UUID/CFDI en `cfdi_repositorio`,
   se anota lote/caducidad extraídos en `cfdi_repositorio_conceptos` (trazabilidad fiscal — sección 2).

## 2. Cambios de esquema (nueva migración `migrate_v18.js`)

**`cfdi_repositorio_conceptos` (ALTER):**
```sql
ALTER TABLE cfdi_repositorio_conceptos
  ADD COLUMN lote_extraido VARCHAR(50) NULL,
  ADD COLUMN fecha_caducidad_extraida DATE NULL,
  ADD COLUMN producto_id INT UNSIGNED NULL COMMENT 'match por codigo_interno/SKU',
  ADD COLUMN estado_lote ENUM('pendiente','integrado','revision_manual','sin_control') NOT NULL DEFAULT 'pendiente',
  ADD CONSTRAINT fk_concepto_producto FOREIGN KEY (producto_id) REFERENCES productos(id);
```
> Un concepto = una partida de la factura = normalmente un lote. Si en el futuro una partida llega dividida en varios lotes, se resuelve con una tabla puente adicional; no se modela ahora (YAGNI).

**`pagos_comprobantes` (NUEVA):**
```sql
CREATE TABLE pagos_comprobantes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cfdi_repositorio_id BIGINT UNSIGNED NULL COMMENT 'factura relacionada, si se identificó',
  monto DECIMAL(18,2) NULL,
  fecha_pago DATE NULL,
  forma_pago VARCHAR(50) NULL,
  archivo_path VARCHAR(255) NOT NULL,
  estado ENUM('vinculado','sin_vincular') NOT NULL DEFAULT 'sin_vincular',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cfdi_repositorio_id) REFERENCES cfdi_repositorio(id)
);
```

**`ingestion_log` (NUEVA — bitácora, mismo patrón que `cfdi_descargas`):**
```sql
CREATE TABLE ingestion_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('factura','pago') NOT NULL,
  archivo_nombre VARCHAR(255) NOT NULL,
  estado ENUM('procesado','revision_manual','error') NOT NULL,
  cfdi_uuid_detectado CHAR(36) NULL,
  mensaje TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 3. Backend — nuevo módulo `ingestion` (+ refactor mínimo en `ventas`)

```
modules/ventas/recepcion.service.js  (NUEVO — extraído de recepcion() en ventas.controller.js,
                                       sin cambiar su comportamiento HTTP actual)
  ejecutarRecepcion(conn, { oc_id, almacen_id, partidas, usuario_id }) → { folio, estatus_oc }
  ventas.controller.js recepcion() ahora solo arma la transacción y llama a esta función.

modules/ingestion/
  ingestion.routes.js       (auth por API key, NO por JWT — lo llama n8n, no un usuario)
  ingestion.controller.js   recibirFactura, recibirPago, pendientes (para el resumen diario)
  extractor.factura.js      prompt a Gemini vía ai.provider.js → encabezado + partidas
                            { rfc_emisor, folio, uuid, fecha, total,
                              partidas: [{ descripcion, codigo_proveedor, cantidad, numero_lote, fecha_caducidad }] }
  matching.js               buscarProveedorPorRfc, buscarOcAbiertasDeProveedor,
                            emparejarPartidasConOc (SOLO código exacto: proveedores_skus.sku_proveedor
                            o productos.sku_interno/ean — nunca por descripción),
                            buscarCfdiPorUuidOFolio (para anotar cfdi_repositorio_conceptos)
middleware/apiKeyAuth.js    compara header X-API-Key contra INGESTION_API_KEY (.env)
```

**Endpoints:**
```
POST /api/ingestion/factura-pdf   (multipart: archivo.pdf)
  → extrae encabezado + partidas (incl. lote/caducidad) vía IA
  → proveedor = buscarProveedorPorRfc(rfc_emisor); si no existe: revision_manual
  → OCs candidatas = abiertas/parciales de ese proveedor
  → emparejarPartidasConOc: solo si TODAS las partidas casan 1:1 por código exacto contra una
    única OC con cantidades disponibles → ejecutarRecepcion(conn, {...}) con lote/caducidad del PDF
  → si no calza 100%: revision_manual (guarda lo extraído para pre-llenar la Recepción manual)
  → si además se identifica el UUID/folio en cfdi_repositorio: anota lote_extraido/fecha_caducidad_extraida
    por concepto (trazabilidad fiscal, no bloquea lo anterior)
  → responde { estado, detalle } a n8n

POST /api/ingestion/comprobante-pago   (multipart: archivo.pdf)
  → intenta identificar la factura relacionada (monto + fecha aproximada, o referencia en el PDF)
  → guarda el PDF y el registro en pagos_comprobantes (vinculado o 'sin_vincular')

GET  /api/ingestion/pendientes   (JWT normal, para pantalla de revisión manual + resumen n8n)
```

**Regla:** igual que en solicitudes y en el matcher de productos, todo lo que no cuadre 100% (proveedor no identificado, cero o varias OC candidatas, partida sin código exacto, cantidad excede lo pendiente) cae a `revision_manual`, nunca se fuerza la escritura. Un usuario lo resuelve desde la pantalla de Recepción ya existente, con lote/caducidad pre-llenados.

## 4. n8n — flujo (cuenta cloud ya existente: rodrigo.cabrera@innovacom.mx)

Dos ramas de **trigger** independientes convergen en el mismo tramo común (switch → HTTP → IF), porque el webhook de DISMED no distingue de dónde vino el PDF:

**Rama A — Correo:**
1a. **Gmail Trigger** filtrando adjunto PDF, sobre el **buzón dedicado nuevo** (ej. `facturas@innovacom.mx`) — separa el flujo automatizado del correo personal. El propietario debe crear esa cuenta de correo (Claude no puede crear cuentas de correo corporativo); una vez creada, se agrega como credencial Gmail/IMAP en n8n.

**Rama B — Carpeta vigilada (DECIDIDO 2026-07-01: OneDrive** — coherente con que este mismo proyecto ya vive en una carpeta de OneDrive):
1b. n8n cloud **no tiene un nodo Trigger nativo de OneDrive** (a diferencia de Google Drive); se arma con **Schedule Trigger** (ej. cada 5-10 min) → nodo **Microsoft OneDrive** (o **HTTP Request** a Microsoft Graph API si el nodo nativo no cubre el caso) listando archivos nuevos en la carpeta dedicada desde el último chequeo → por cada archivo nuevo, sigue al tramo común. Es polling, no instantáneo, pero para facturas físicas/comprobantes descargados (no son urgentes al segundo) es aceptable.
    - Carpeta dedicada dentro de OneDrive, con **dos subcarpetas**: `facturas-escaneadas/` (facturas entregadas físicamente, ya escaneadas) y `pagos-descargados/` (comprobantes generados/descargados directo, ej. portal bancario). El nombre de la subcarpeta le dice al Switch (paso 2) si es factura o pago, sin necesidad de adivinar por contenido.
    - Requiere una **credencial Microsoft/Azure AD (OAuth2)** en n8n con permiso de lectura sobre esa carpeta de OneDrive — se da de alta con la cuenta de Microsoft/Office 365 de la empresa (no es una cuenta nueva, es autorizar a n8n a leer esa carpeta).
    - Para no reprocesar el mismo archivo en cada polling: se marca/mueve cada archivo ya enviado a una subcarpeta `procesados/` (ver paso 4 del tramo común) — eso es lo que evita que el Schedule lo vuelva a levantar.

**Tramo común (ambas ramas):**
2. **Switch:** ¿factura o comprobante de pago? (por asunto/remitente en la Rama A; por subcarpeta en la Rama B; si no se puede distinguir, se manda primero a `/factura-pdf` y si el backend no reconoce un CFDI en el PDF, cae a revisión manual — no hace falta que n8n adivine con certeza).
3. **HTTP Request:** POST al webhook DISMED correspondiente, adjuntando el PDF binario + header `X-API-Key`.
4. **IF sobre la respuesta:** `procesado` → mover/etiquetar el correo o mover el archivo a una subcarpeta `procesados/`; `revision_manual`/`error` → etiquetar/mover a `revision/` (no reintentar solo; ver paso 5).
5. **Schedule diario (1x):** GET `/api/ingestion/pendientes` → arma resumen → notifica por correo (o Slack/Telegram si se agrega esa cuenta después).

## 5. Riesgos / QA

| # | Riesgo | Mitigación |
|---|---|---|
| I-1 | El PDF de la factura llega **antes** que la descarga masiva del SAT (UUID aún no existe en `cfdi_repositorio`). | Estado `revision_manual` con reintento: el `Schedule diario` puede reprocesar pendientes tras la descarga automática del día 3 (ver `project_cfdi_descarga_sat`). |
| I-2 | Producto de la partida no tiene equivalencia SKU cargada. | Igual que en `proveedores_catalogo`: primera vez requiere confirmación manual, luego se aprende. |
| I-3 | Producto sin `control_lote_caducidad` (genérico). | Se ignora lote/caducidad para ese producto, se marca `estado_lote='sin_control'`. |
| I-4 | Reproceso del mismo PDF (duplicados). | Idempotencia por UUID + no_identificacion antes de insertar movimiento. |
| I-5 | Concurrencia en la escritura de inventario. | Ya resuelto por `movimientos.service.js` (transacción + `SELECT ... FOR UPDATE`), se reutiliza tal cual. |
| I-6 | Costo de IA por doble llamada (n8n + backend) si en el futuro se cambia de proveedor. | Evitado por diseño: la extracción vive solo en el backend (sección 1). |
| I-7 | Mismo documento llega dos veces por rutas distintas (ej. el proveedor lo manda por correo **y** además alguien lo escanea y sube a la carpeta). | Misma idempotencia de I-4 (UUID/no_identificacion) aplica sin importar el origen — el backend no distingue de dónde vino el PDF. |
| I-8 | Calidad de escaneo variable (facturas físicas) puede degradar la extracción IA. | Si el prompt no logra extraer lote/caducidad con confianza, cae a `revision_manual` igual que cualquier otro caso ambiguo — nunca se inventa un valor. |

## 6. Cuentas / credenciales necesarias

- **n8n:** ya existe (cloud, `rodrigo.cabrera@innovacom.mx` / usuario `innovacon`). No se necesita otra.
- **IA (Gemini):** se reutiliza el `GEMINI_API_KEY` ya configurado en el backend de DISMED — la extracción ocurre en DISMED, no en n8n, así que **no hace falta darle esa llave a n8n**.
- **Webhook DISMED (`X-API-Key`):** es un secreto compartido, no una cuenta — se genera al implementar y se guarda en `.env` del backend + como credencial en el nodo HTTP Request de n8n.
- **Buzón de correo a monitorear — DECIDIDO (2026-07-01): buzón dedicado nuevo** (ej. `facturas@innovacom.mx`), separado del correo personal de trabajo. Esta cuenta de correo la debe crear el propietario (o su proveedor de dominio/correo) — Claude no tiene forma de crear cuentas de correo corporativo. Una vez creada, se agrega como credencial en el nodo Gmail/IMAP Trigger de n8n.
- **Carpeta vigilada — DECIDIDO (2026-07-01): OneDrive**, con subcarpetas `facturas-escaneadas/`, `pagos-descargados/` y `procesados/`. El propietario debe: (1) crear esa carpeta dentro de su OneDrive; (2) autorizar a n8n a leerla dando de alta una credencial Microsoft/Azure AD (OAuth2) en n8n — no es una cuenta nueva, es una autorización sobre la cuenta de Microsoft/Office 365 que ya tienen. Nota técnica: como n8n cloud no trae Trigger nativo de OneDrive, la Rama B se arma por **polling** (Schedule + listar archivos), no por detección instantánea (ver sección 4).
- **Nota importante:** no tengo un conector/MCP de n8n conectado en esta sesión, así que no puedo entrar a tu cuenta y armar el workflow yo mismo ahora mismo. Te entrego el diseño de nodos de la sección 4 (y puedo generar el JSON exportable del workflow para que lo importes con un clic). Si prefieres que yo lo construya directamente vía API, se necesitaría agregar una API key de n8n como conector — dime si quieres ese camino.

## 7. Plan de implementación por entregas

**Entrega 1 — Backend (sin depender de n8n): ✅ IMPLEMENTADA Y VERIFICADA EN LOCAL (2026-07-01)**
1. ✅ `migrate_v25.js` (la numeración real llegó hasta v24 con otros cambios entre el 2026-06-22 y hoy; NO es v18 como se planeó originalmente): ALTER `cfdi_repositorio_conceptos`, nuevas tablas `pagos_comprobantes` e `ingestion_log`. Corrida en la BD local sin errores.
2. ✅ Refactor `ventas.controller.js`: extraído `recepcion.service.js` (`ejecutarRecepcion`) — el endpoint HTTP `recepcion()` ahora solo abre/cierra la transacción y llama al servicio; mismo comportamiento de antes.
3. ✅ Middleware `apiKeyAuth.js`. **Pendiente del usuario:** agregar a mano `INGESTION_API_KEY=eca3923de645d319cd05030803c9c501b15b0250c4f3994d` en `dismed/backend/.env` (un hook del proyecto bloquea que Claude edite `.env` directamente).
4. ✅ Módulo `ingestion`: endpoints `factura-pdf`, `comprobante-pago`, `pendientes`.
5. ✅ `extractor.factura.js` — mismo patrón que `solicitudes/parser.pdf.js` (pdf-parse extrae texto → se lo pasa a `ai.provider.js`, NO se manda el binario). Limitación conocida: un PDF escaneado sin capa de texto no producirá extracción (cae a revisión manual, ver riesgo I-8).
6. ✅ `matching.js`: proveedor por RFC, OC abiertas, emparejamiento por código exacto (nunca por descripción), UUID/folio→`cfdi_repositorio`.
7. ✅ Verificado localmente: `node -c` en los 9 archivos nuevos/modificados, migración corrida en BD local, servidor arranca limpio (`GET /api/health` responde, `POST /api/ingestion/factura-pdf` responde el 500 esperado por falta de `INGESTION_API_KEY` — confirma que el middleware nuevo está conectado).

**Pendiente antes de Entrega 2:** probar con un PDF real de factura contra una OC real en la BD (no solo el arranque en frío) — requiere `INGESTION_API_KEY` en `.env` + una `GEMINI_API_KEY`/`ANTHROPIC_API_KEY` válida (el `.env` local trae una clave Anthropic placeholder, no funcional).

**Entrega 2 — n8n:**
7. Crear el buzón dedicado (`facturas@innovacom.mx` o similar) y la carpeta vigilada (Google Drive u otra, con subcarpetas `facturas-escaneadas/` y `pagos-descargados/`); dar de alta ambas como credenciales en n8n.
8. Armar el workflow en n8n con las dos ramas de trigger convergiendo al mismo tramo común (Switch → HTTP Request → IF → notificación) siguiendo la sección 4.
9. Prueba end-to-end: 5-10 facturas por correo + 5-10 documentos (facturas escaneadas y comprobantes) por carpeta, de distintos proveedores.

**Entrega 3 — Producción:**
10. Pantalla de "revisión manual" (o reutilizar el módulo Inventario/Existencias con un filtro `estado_lote != integrado`).
11. Activar el workflow en n8n, monitorear una semana, ajustar el prompt de extracción según errores reales.
