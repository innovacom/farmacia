# DISEÑO — Vinculación de producto del catálogo a lo largo del ciclo

> Documento autocontenido. Léelo **antes de tocar código** en la próxima iteración:
> evita reexplorar todos los módulos. Última actualización: **2026-06-16**.
> Relacionado: [[proyecto-dismed]] feature #18, `DISEÑO_INVENTARIO.md`, `DISEÑO_VENTA_COMPRA.md`.

---

## 1. Objetivo y regla de negocio

Una solicitud del cliente puede traer productos que **no están** en nuestro catálogo,
por eso `producto_id` **es y debe seguir siendo OPCIONAL** (nullable). Pero cuando el
producto SÍ existe en el catálogo, el sistema debe detectarlo y colocar el `producto_id`
(y su `sku_interno`) para que ese dato viaje por todo el flujo y elimine recapturas/errores.

**Decisión de negocio (firme):**
- **Solo los códigos EXACTOS auto-vinculan** sin intervención: `codigo_cliente` confirmado
  en `clientes_skus`, y EAN.
- **La similitud de descripción NUNCA auto-vincula**: siempre es *sugerencia* que el
  usuario confirma. Al confirmar, se aprende el mapeo para la próxima vez.

---

## 2. Cadena de propagación del `producto_id` (mapa de verdad)

El `producto_id` es el eje. Su recorrido y los archivos exactos:

```
solicitudes_partidas.producto_id  (nullable; FK productos.id)
  │  resuelto por: clientes_skus (codigo_cliente confirmado) o manual (ProductoPicker)
  ▼
cotizaciones_cliente_partidas.producto_id + sku_interno
  │  cotcli.controller.js create()  → inserta p.producto_id / p.sku_interno
  ▼
pedidos_cliente_partidas.producto_id + sku_interno
  │  ventas.controller.js crearPedido()  → copia de ccp
  ▼
ordenes_compra_partidas.producto_id + sku_interno
  │  ventas.controller.js generarOC()  → copia de pp
  ▼
recepción → ENTRADA a inventario     ⚠️ ventas.controller.js recepcion():
  │                                      RECHAZA si producto_id es NULL
  ▼
entrega FEFO → SALIDA de inventario  ⚠️ ventas.controller.js crearEntrega():
                                         RECHAZA si producto_id es NULL
```

**Aprendizaje de diccionarios (depende de que producto_id esté resuelto temprano):**
- `clientes_skus`: lo escribe `solicitudes.controller.js updatePartida()` cuando llegan
  `producto_id` + `codigo_cliente` juntos (ON DUPLICATE KEY UPDATE, confirmado=1).
- `proveedores_skus`: lo escribe `cotprov.controller.js` (~línea 114) SOLO si la partida
  ya tiene `producto_id`. Sin vínculo temprano, el diccionario de proveedores no crece.

---

## 3. Lo IMPLEMENTADO (Fase 1 + 2) — 2026-06-16

### Fase 1 — Desbloqueo (el bug crítico)
**Síntoma:** aunque la partida tuviera `producto_id`, la cotización lo guardaba NULL y
rompía toda la cadena de inventario.
**Causa:** la vista `v_comparador_precios` no exponía `producto_id`/`sku_interno`, y
`ComparadorPrecios.buildPartidas()` no los enviaba.

| Archivo | Cambio |
|---|---|
| `dismed/backend/migrate_v8.js` (NUEVO) | `CREATE OR REPLACE VIEW v_comparador_precios` + `sp.producto_id`, `pr.sku_interno`, `pr.descripcion AS descripcion_interna`, con `LEFT JOIN productos pr ON pr.id = sp.producto_id`. **Ya ejecutado en prod.** |
| `dismed/frontend/src/pages/Proveedores/ComparadorPrecios.jsx` | El pivot guarda `producto_id`/`sku_interno`; `buildPartidas()` los incluye. |
| `cotcli.controller.js` | Sin cambio: ya insertaba `p.producto_id`/`p.sku_interno`. |

### Fase 2 — Vinculación manual asistida (motor + UI)

| Archivo | Cambio |
|---|---|
| `dismed/backend/src/modules/solicitudes/matcher.js` (NUEVO) | Motor de coincidencia. Exporta `normalizar`, `tokenizar`, `score`, `buscarCandidatos`. Ver §4. |
| `dismed/backend/src/modules/productos/productos.controller.js` | `+ match(req,res)` (usa `buscarCandidatos`). Export incluye `match`. |
| `dismed/backend/src/modules/productos/productos.routes.js` | `router.get('/match', c.match)` **antes** de `/:id`. |
| `dismed/frontend/src/components/shared/ProductoPicker.jsx` (NUEVO) | Modal reutilizable: sugerencias auto + búsqueda libre (debounce 300ms), badge de score, llama `GET /productos/match`. Props: `open, onClose, partida{descripcion_original,codigo_cliente}, clienteId, onSelect(producto)`. |
| `dismed/frontend/src/pages/Solicitudes/NuevaSolicitud.jsx` | Columna "Producto catálogo" + botón Vincular por partida. Guarda `producto_id`/`sku_interno` en el estado local → se mandan en `bulkPartidas`. Usa `watch('cliente_id')`. |
| `dismed/frontend/src/pages/Solicitudes/DetalleSolicitud.jsx` | Celda SKU ahora editable (Vincular/Cambiar/Quitar). `vincularMut` → `PUT /solicitudes/:id/partidas/:pid` con `producto_id` (+`codigo_cliente`+`descripcion_original` para que aprenda `clientes_skus`). |

**Endpoint:** `GET /api/productos/match?q=&descripcion=&cliente_id=&codigo_cliente=&codigo_gobierno=`
→ `{ candidatos: [{ id, sku_interno, descripcion, fabricante, unidad_medida, precio_lista, ean, score(0-100), match_reason }] }`
- Con `q` (usuario teclea) → búsqueda directa, umbral 0.
- Sin `q`, con `descripcion`/códigos → auto-sugerencia, umbral 0.2.
- `match_reason`: `codigo_cliente` | `codigo_cliente_sugerido` | `ean` | `descripcion`.

---

## 4. Cómo funciona el matcher (matcher.js)

**Pipeline:**
1. `normalizar(texto)`: MAYÚSCULAS, quita acentos (NFD), deja `[A-Z0-9.%/]`, expande
   abreviaturas médicas (`ABREV`: JGA→JERINGA, AMP→AMPOLLETA, TAB→TABLETA…), y **pega
   número+unidad** con `RE_GLUE`: `"5 ML"→"5ML"`, `"22 G"→"22G"`, `"0.9 %"→"0.9%"`.
2. `tokenizar(norm)`: separa `{ texto:[palabras sin stopwords, len>1], medidas:[tokens con dígito] }`.
3. `score(qTokens, prodNorm)`: `0.6·jaccard(texto) + 0.4·medScore`.
   - **GUARDA CLAVE:** si la consulta tiene medidas y alguna NO está en el producto → **`-1` (descarta)**.
     Por eso "jeringa 5ML" jamás matchea "jeringa 10ML". Verificado en prod.
   - Sin medidas en la consulta → medScore neutro 0.5; producto sin medidas → no descarta pero medScore 0.
4. `buscarCandidatos({...})`: C1 `clientes_skus` (codigo_cliente) → C2 EAN (regex `\d{8,14}`) →
   C4/C5 descripción (recupera por `LIKE` de sku + 4 tokens más largos, máx 80 filas, puntúa en JS).
   Dedup por id, ordena por score desc, top 10.

**Para extender el matcher** (sin tocar el resto): editar `ABREV` (más abreviaturas),
`UNIT` (más unidades que pegar), o los pesos en `score()`. Las pruebas rápidas se hacen con
`node -e "const m=require('./src/modules/solicitudes/matcher'); ..."`.

**Bandas de confianza para UI:** ≥85 verde, 60–84 ámbar, <60 gris (`ProductoPicker.badgeCls`).

---

## 5. Fases 3 y 4 — ✅ IMPLEMENTADAS Y DESPLEGADAS (2026-06-16)

> Todas desplegadas en producción y verificadas. `migrate_v9.js` (idempotente) cubre el
> esquema de F3.1/F3.2/F3.3/F4.2. Resumen de lo realizado al final de cada bloque.
> Conserva la spec abajo como referencia de criterios de aceptación.

> Implementar en este orden. Cada bloque es independiente y desplegable por separado.

### F3.1 — Búsqueda difusa robusta con FULLTEXT
**Problema actual:** la recuperación de candidatos usa `LIKE %token%` (lento si crece el
catálogo y no rankea bien). Migrar a índice FULLTEXT sobre una columna normalizada.
- **Migración `migrate_v9.js`:**
  - `ALTER TABLE productos ADD COLUMN descripcion_norm VARCHAR(800) NULL;`
  - Poblar: `UPDATE productos SET descripcion_norm = <normalizar(descripcion)>` — hacerlo en
    Node iterando (reusar `matcher.normalizar`) porque la normalización vive en JS, no en SQL.
  - `ALTER TABLE productos ADD FULLTEXT KEY ftx_desc_norm (descripcion_norm);`
- **Mantener `descripcion_norm`** en `productos.controller.js` `create()`/`update()` e
  `importConfirm()` (calcular con `matcher.normalizar(descripcion)` al insertar/actualizar).
- **matcher.buscarCandidatos:** sustituir el bloque LIKE por
  `... WHERE MATCH(descripcion_norm) AGAINST (? IN NATURAL LANGUAGE MODE) LIMIT 80`, pasando
  los tokens de texto. Mantener el `score()` JS (incl. la guarda de medidas) sobre el shortlist.
- **Aceptación:** "jeringa 5 ml esteril" trae las jeringas 5ML arriba; ninguna 10ML aparece.

### F3.2 — Estado de vinculación por partida (trazabilidad + UI)
- **Migración:** `ALTER TABLE solicitudes_partidas ADD COLUMN match_estado ENUM('sin_vincular','sugerido','confirmado') NOT NULL DEFAULT 'sin_vincular', ADD COLUMN match_score DECIMAL(4,3) NULL, ADD COLUMN match_origen VARCHAR(20) NULL;`
- **Backend:** en `bulkPartidas`/`addPartida`/`updatePartida` setear `match_estado='confirmado'`
  cuando el usuario vincula manual; `'sugerido'` si se auto-pobló por código exacto sin confirmar.
  Exponer estos campos en `getById` (ya hace `sp.*`) y en `v_comparador_precios`.
- **Frontend:** badge de estado en la celda Producto de `NuevaSolicitud`/`DetalleSolicitud`;
  contador "N partidas sin vincular" antes de pasar a pedido (recepción/entrega lo exigen).
- **Aceptación:** se ve de un vistazo qué partidas están vinculadas/sugeridas/sin vincular.

### F3.3 — Auto-vinculación por código de gobierno (codigo_gobierno)
- Hoy `solicitudes_partidas.codigo_gobierno` se captura pero no mapea a nada.
- **Opción A (simple):** `ALTER TABLE productos ADD COLUMN clave_cuadro_basico VARCHAR(30) NULL`
  + índice; poblar desde el catálogo maestro; en matcher agregar capa C3 (exacto, auto-vincula).
- **Opción B:** tabla puente `productos_claves_gobierno(producto_id, clave, fuente)` (1 producto
  puede tener varias claves IMSS/ISSSTE/cuadro básico).
- **Aceptación:** una partida con `codigo_gobierno` conocido se auto-vincula (código exacto = permitido).

### F4.1 — IA de desempate (opcional, casos ambiguos)
- Reusar patrón de `buscador.web.js` (Anthropic `claude-sonnet-4-6`).
- **Constraint anti-alucinación:** pasar a la IA SOLO el shortlist de `buscarCandidatos`
  (top 5) + la descripción original; debe devolver `producto_id` elegido (de la lista) o
  `null`, + confianza + justificación. **Lista cerrada: no puede inventar SKUs.**
- Endpoint nuevo p.ej. `POST /productos/match-ia` o flag `?ia=1` en `/match`.
- **Sigue siendo sugerencia** (la decisión de negocio no cambia): el usuario confirma.
- Costo ~similar a una búsqueda web por partida; ofrecer botón manual, no automático.

### F4.2 — Autocompletar sku_proveedor en la OC desde proveedores_skus
- Al generar OC (`ventas.controller.js generarOC`), si existe `proveedores_skus(proveedor_id, producto_id)`,
  rellenar `ordenes_compra_partidas.sku_proveedor` (requiere ADD COLUMN si no existe) para que
  el PDF de la OC lleve el código que el proveedor reconoce.
- **Aceptación:** la OC muestra el SKU del proveedor cuando ya se conoce.
- ✅ **HECHO:** `ordenes_compra_partidas.sku_proveedor` (migrate_v9). `generarOC` lo rellena
  con `proveedores_skus(proveedor_id, producto_id)` (más reciente por `ultima_cotizacion`).
  `ventas.pdf.js` muestra la columna "SKU Prov." solo si alguna partida la trae.

---

## 5bis. Resumen de implementación Fases 3-4 (2026-06-16)

- **migrate_v9.js** (idempotente, ya corrido en prod): `productos.descripcion_norm` (poblada
  con `matcher.normalizar` para los 1,566 productos) + FULLTEXT `ftx_desc_norm`;
  `productos.clave_cuadro_basico` + índice; `solicitudes_partidas.match_estado`(enum)/`match_score`/`match_origen`
  (+backfill confirmado para las ya vinculadas); `ordenes_compra_partidas.sku_proveedor`;
  `CREATE OR REPLACE VIEW v_comparador_precios` ahora expone `match_estado`/`match_score`.
- **matcher.js**: capa **C3** (codigo_gobierno → `clave_cuadro_basico` exacto, reason `codigo_gobierno`)
  y recuperación por **FULLTEXT** (`MATCH ... AGAINST IN NATURAL LANGUAGE MODE`) con **respaldo LIKE**
  si no hay índice o no hay filas. La guarda de medidas en `score()` se mantiene.
- **matcher.ia.js** (NUEVO): `desempatarConIA()` — Anthropic `claude-sonnet-4-6`, **lista cerrada**
  (solo ids del shortlist top-5 o null), valida que el id devuelto esté en la lista. Sigue siendo sugerencia.
- **productos.controller.js**: mantiene `descripcion_norm` en create/update/importConfirm;
  `clave_cuadro_basico` en PROD_FIELDS e importConfirm; endpoint `matchIa` (`POST /productos/match-ia`).
- **solicitudes.controller.js**: `bulkPartidas`/`addPartida`/`updatePartida` setean
  `match_estado`/`match_score`/`match_origen` (manual→confirmado, código exacto→sugerido) y
  `bulkPartidas` resuelve también por `clave_cuadro_basico`.
- **ventas.controller.js** `generarOC`: autocompleta `sku_proveedor` desde `proveedores_skus`.
- **Frontend**: `ProductoPicker.jsx` (+botón "Desempatar con IA", resalta el elegido, label
  "clave de gobierno"); `DetalleSolicitud.jsx` y `NuevaSolicitud.jsx` (badge de estado por
  partida + contador "N sin vincular al catálogo").
- **Endpoints nuevos:** `POST /api/productos/match-ia` (auth, requiere ANTHROPIC_API_KEY).
- **Pendiente futuro (no crítico):** F3.3 Opción B (tabla puente `productos_claves_gobierno`
  para múltiples claves IMSS/ISSSTE por producto); poblar `clave_cuadro_basico` desde el catálogo
  maestro (hoy la columna existe pero está vacía hasta que se importe/capture).

---

## 6. Notas de despliegue (VPS) — recordatorio

- Credenciales y rutas: ver memoria [[infra-credenciales]]. SSH `claude@72.249.60.175` (ed25519, sudo NOPASSWD).
- **Backend corre en `/var/www/dismed/backend/`** (NO `/root/...`). Frontend fuente en `/root/dismed/frontend/`, publicado en `/var/www/dismed/frontend/dist/`.
- Plantilla: `scp` a `/tmp` → `sudo bash -c 'cp ...; node migrate_vN.js; pm2 restart dismed-api; cd /root/dismed/frontend && npm run build && cp -r dist/* /var/www/dismed/frontend/dist/'`.
- Migraciones son idempotentes; `CREATE OR REPLACE VIEW` y `ADD COLUMN IF NOT EXISTS` se pueden re-correr.
- Probar matcher sin token: script `node test_matcher.js` (carga `.env`, llama `buscarCandidatos`).

---

## 7. Resumen de archivos tocados (para revisión rápida)

**Backend:** `migrate_v8.js` (nuevo), `modules/solicitudes/matcher.js` (nuevo),
`modules/productos/productos.controller.js` (+match), `modules/productos/productos.routes.js` (+ruta).
**Frontend:** `components/shared/ProductoPicker.jsx` (nuevo),
`pages/Proveedores/ComparadorPrecios.jsx`, `pages/Solicitudes/NuevaSolicitud.jsx`,
`pages/Solicitudes/DetalleSolicitud.jsx`.
**Sin cambios pero relevantes:** `cotcli.controller.js`, `ventas.controller.js` (consumen producto_id).
