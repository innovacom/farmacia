# INNOVACOM — ERP Distribución Médica
## Diccionario Técnico y Reglas de Negocio
_Última actualización: 2026-06-10_

---

## 1. Terminología del negocio

| Término | Definición | Campo en BD | Notas |
|---|---|---|---|
| **COC** | Número de pedido del cliente (Client Order Code). Es la referencia que el hospital/clínica asigna a su propia requisición de compra. Puede venir o no en el documento. | `solicitudes.referencia_cliente` | Aparece en el encabezado del PDF de cotización bajo la etiqueta **"No. Solicitud Cliente"** (antes decía "COC") |
| **Atención** | Persona a quien se dirige la cotización ("DIRIGIR A" en el Excel, col C). Texto libre capturado en Nueva Solicitud; se hereda a la cotización al crearla. | `solicitudes.atencion` → `cotizaciones_cliente.atencion` | En el PDF: campo "Atención". Fallback: nombre del contacto (`contacto_id`) si atención está vacío |
| **Concepto** | Descripción/tipo de la cotización (ej. "INSUMOS MÉDICOS Y MATERIAL DE CURACIÓN"). En el Excel: encabezado "DESCRIPCION" col G. Texto libre capturado en Nueva Solicitud; se hereda a la cotización. | `solicitudes.concepto` → `cotizaciones_cliente.concepto` | En el PDF: campo "Concepto" |
| **Solicitud** | Petición de cotización recibida de un cliente. Puede venir en Excel, PDF o captura manual. | `solicitudes` | Folio SOL-YYYY-NNNN |
| **Partida** | Renglón individual dentro de una solicitud. Cada partida es un producto diferente. | `solicitudes_partidas` | El número de partida debe respetarse tal como viene del cliente, NO se auto-genera |
| **Comparador** | Pantalla que muestra los precios de todos los proveedores por partida y resalta el menor. | Vista `v_comparador_precios` | — |
| **Cotización al cliente** | Documento PDF que se envía al hospital/clínica con los precios de venta calculados. | `cotizaciones_cliente` | Folio COT-YYYY-NNNN |
| **Factor de ganancia** | Multiplicador que se aplica al mejor precio de compra para obtener el precio de venta. Ejemplo: 0.15 = 15% de margen. | `cotizaciones_cliente.margen_global_pct` (o por partida) | En el Excel viene en fila 4, col F |
| **Elaboró** | Usuario del sistema que creó la cotización. | `usuarios.nombre` via `cotizaciones_cliente.elaborado_por_id` | Se toma del usuario logueado, NO se captura manualmente |
| **Autorizó** | Jefe directo del usuario que elaboró. Aparece en el PDF como quien aprueba. | `usuarios.nombre` via `usuarios.jefe_id` | Se toma de la jerarquía en la BD, NO se captura manualmente |
| **NO COTIZO** | Leyenda que indica que ningún proveedor ofertó precio para esa partida. | `solicitudes_partidas.observaciones` | Se coloca automáticamente cuando todas las columnas de precio de proveedor están vacías. La partida SÍ se guarda y SÍ aparece en el PDF con precio $0.00 |
| **Código gobierno** | Clave que el hospital/dependencia pública asigna al producto en su catálogo interno. | `solicitudes_partidas.codigo_gobierno` | Columna C en el Excel de cotización. Puede estar vacío. |

---

## 2. Estructura del Excel de cotización (formato de producción)

El archivo Excel de trabajo tiene la siguiente estructura fija:

### Zona de encabezado (filas 1-4)

| Fila | Col A | Col B | Col C | Col D | Col E | Col F |
|---|---|---|---|---|---|---|
| 1 | COTIZACION | CLIENTE | DIRIGIR A | COC | ELABORO | AUTORIZO |
| 2 | — | Nombre del cliente | — | — | Nombre elaborador | Nombre autorizador |
| 3 | — | **Número COC** | — | — | ID usuario | ID usuario |
| 4 | — | — | — | — | FACTOR GANANCIA | **Valor factor** (ej: 0.15) |

A partir de la columna Q en la fila 4, vienen los **nombres de los proveedores** en columnas impares (Q, S, U, W, Y, AA, AC...).

### Zona de encabezados de tabla (fila 5)

| Col | Letra | Contenido |
|---|---|---|
| 1 | A | PARTIDA (número original, se respeta) |
| 2 | B | CODIGO (código del cliente para el producto) |
| 3 | C | CODIGO GOBIERNO |
| 4 | D | CANTIDAD |
| 5 | E | UNIDAD |
| 6 | F | DESCRIPCION |
| 7 | G | PRECIO COMPRA (mejor precio, calculado) |
| 8 | H | SUBTOTAL COMPRA (calculado, no importar) |
| 9 | I | GANANCIA (calculado, no importar) |
| 10 | J | PROVEEDOR (quién tiene el mejor precio) |
| 11 | K | P. Unitario (precio venta, calculado, no importar) |
| 12-14 | L-N | Subtotal, IVA, Total (calculados, no importar) |
| 15 | O | OBSERVACION INNOVACOM (nuestras notas) |
| 16 | P | LIGA A FOTO (URL, no importar) |
| 17+ | Q en adelante | Pares PRECIO / COMENTARIO por proveedor |

### Zona de datos (fila 6 en adelante)

Cada fila es una partida. El parser debe:
- Respetar el número en col A como `linea`
- Saltar filas sin descripción en col F
- Saltar filas cuya col A no sea numérica (notas, subtotales)
- Si TODAS las columnas de precio de proveedores están en 0 o vacías → poner "NO COTIZO" en observaciones (sin sobreescribir si ya tiene texto)

### Proveedores (fila 4 col Q en adelante)

Patrón: columna impar = nombre proveedor, siguiente columna = par precio/comentario
- Col Q (17) = PRONAMAC → Col Q precio, col R comentario
- Col S (19) = Medifacil → Col S precio, col T comentario
- Col U (21) = ALFA MEDICAL → precio, comentario
- etc.

---

## 3. Reglas de negocio críticas

### RN-001: Número de partida
El número de partida del Excel (col A) se respeta tal cual. El sistema NO genera numeración consecutiva propia. Si el cliente entrega su solicitud con partidas 1, 3, 5 (saltándose números), así se guarda.

### RN-002: Líneas sin precio — "NO COTIZO"
Si para una partida ningún proveedor tiene precio, la partida:
1. **SÍ se guarda** en `solicitudes_partidas`
2. **SÍ aparece** en el comparador de precios
3. **SÍ aparece** en el PDF de cotización con precio $0.00
4. El campo `observaciones` recibe el texto `"NO COTIZO"` automáticamente (solo si estaba vacío; si el usuario escribió otra observación, se conserva)

### RN-003: Campos calculados del Excel
Las columnas H (Subtotal compra), I (Ganancia), K (P. Unitario), L (Subtotal), M (IVA), N (Total) son fórmulas calculadas en el Excel. **No se importan** — el sistema los recalcula.

### RN-004: Elaboró / Autorizó
Estos campos **no se capturan del Excel** aunque vengan ahí. El sistema los obtiene de la BD:
- `elaboro_nombre` = usuario logueado que crea la cotización
- `autoriza_nombre` = `usuarios.jefe_id` del usuario logueado

### RN-005: Todas las partidas van al PDF
Sin excepción, todas las partidas de una cotización deben aparecer en el PDF, tengan precio o no. Las que no tienen precio muestran $0.00 y "NO COTIZO" en observaciones.

---

## 4. Estructura de base de datos — tablas clave

### `solicitudes`
| Campo | Tipo | Descripción |
|---|---|---|
| `referencia_cliente` | VARCHAR(100) | **COC** — número de pedido del cliente |
| `atencion` | VARCHAR(150) | "DIRIGIR A" — persona a quien va la cotización (desde 2026-06-10) |
| `concepto` | VARCHAR(200) | Descripción/tipo de la cotización (desde 2026-06-10) |
| `tipo_origen` | ENUM | excel / pdf / manual |

### `solicitudes_partidas`
| Campo | Tipo | Descripción |
|---|---|---|
| `linea` | SMALLINT | Número de partida original del cliente (RN-001) |
| `codigo_cliente` | VARCHAR(80) | Col B del Excel |
| `codigo_gobierno` | VARCHAR(80) | Col C del Excel |
| `descripcion_original` | VARCHAR(300) | Col F — nunca se modifica |
| `cantidad` | DECIMAL | Col D |
| `unidad_medida` | VARCHAR(30) | Col E |
| `observaciones` | TEXT | Col O; si "NO COTIZO" aplica RN-002 |

### `cotizaciones_cliente`
| Campo | Tipo | Descripción |
|---|---|---|
| `concepto` | VARCHAR(200) | Descripción / tipo de la cotización (heredado de `solicitudes.concepto` si no se envía) |
| `atencion` | VARCHAR(150) | Texto libre "Atención" (heredado de `solicitudes.atencion`; desde 2026-06-10) |
| `contacto_id` | INT | FK → clientes_contactos (fallback de "Atención:" si `atencion` está vacío) |
| `elaborado_por_id` | INT | FK → usuarios (RN-004) |

### `usuarios`
| Campo | Tipo | Descripción |
|---|---|---|
| `puesto` | VARCHAR(100) | Cargo del usuario |
| `jefe_id` | INT | FK autorreferencial → usuario autorizador (RN-004) |

### `proveedores_catalogo` (desde 2026-06-16)
Tarifario completo por proveedor con la equivalencia al SKU INNOVACOM. Distinta de `proveedores_skus` (que es el diccionario auto-aprendido de las cotizaciones); esta tabla guarda la **lista de precios completa** del proveedor.

| Campo | Tipo | Descripción |
|---|---|---|
| `proveedor_id` | INT UNSIGNED | **PK (parte 1)** + FK → proveedores. El nombre vive solo en `proveedores.nombre_empresa` |
| `sku_proveedor` | VARCHAR(40) | **PK (parte 2)** — código del proveedor (ej. Pronamac "AMB 091"). Único por proveedor |
| `referencia_fabricante` | VARCHAR(80) | Ref./código del fabricante (puede venir vacío) |
| `fabricante` | VARCHAR(100) | Nombre del fabricante (migrate_v24, 2026-06-23) |
| `descripcion` | VARCHAR(800) | Descripción del tarifario (NULL si el renglón viene solo de equivalencias) |
| `unidad_medida` | VARCHAR(20) | PIEZA / CAJA / PAQUETE / PAR / SOBRE / KIT |
| `precio_lista` | DECIMAL(12,2) | Precio de lista sin IVA (NULL si el tarifario lo trae como "$ -") |
| `vigencia` | VARCHAR(20) | Periodo del tarifario (ej. "FEBRERO 2026") |
| `sku_innovacom` | VARCHAR(20) | Código INNOVACOM equivalente (texto del archivo de equivalencias) |
| `producto_id` | INT UNSIGNED | FK → productos; se resuelve cuando el `sku_innovacom` existe en el catálogo interno |
| `match_estado` | ENUM | sin_vincular / sugerido / confirmado |

**Llave primaria COMPUESTA `(proveedor_id, sku_proveedor)`** — sin autonumérico (decisión de diseño 2026-06-16).

**Carga (desde 2026-06-23, ya NO amarrada a un proveedor fijo):** se importa/exporta desde la pantalla **Herramientas → Importar/Exportar** o por CLI, ambos con la misma lógica (`src/modules/herramientas/herramientas.service.js`). Cada renglón del archivo trae la columna **PROVEEDOR** (nombre o ID); el proveedor se resuelve y se crea si no existe, así un archivo puede incluir varios. Idempotente (ON DUPLICATE KEY UPDATE).

Layouts (mapeo por nombre de encabezado, tolerante a acentos/mayúsculas):
- **Catálogo:** `PROVEEDOR | SKU PROVEEDOR | DESCRIPCION | REFERENCIA FABRICANTE | FABRICANTE | UNIDAD MEDIDA | PRECIO | [VIGENCIA]`. **SKU PROVEEDOR es opcional**: si viene vacío se genera una llave determinística `GEN-<md5hex8>` del contenido del renglón (reimportar el mismo archivo actualiza, no duplica).
- **Equivalencias:** `PROVEEDOR | SKU PROVEEDOR | SKU INNOVACOM`

CLI: `node import_pronamac_cli.js <archivo.xlsx> [--tipo=catalogo|equivalencias] [--vigencia="JUNIO 2026"] [--dry-run]` (delega en el service; ya no usa `--proveedor=`).

---

## 5. Flujo completo del negocio

```
1. Cliente envía solicitud (Excel / PDF / verbal)
2. Se carga al sistema → parser extrae partidas → usuario valida
3. Se seleccionan proveedores → se les envía solicitud de cotización
4. Proveedores responden con precios → se registran en el comparador
5. Comparador resalta mejor precio por partida
   - Líneas sin ningún precio → "NO COTIZO"
6. Se genera cotización al cliente:
   - Factor ganancia aplicado al mejor precio
   - Todas las partidas incluidas (con o sin precio)
7. PDF generado con membrete INNOVACOM y firma de elaboró/autorizó
8. Cliente acepta → se convierte en Pedido (PED)
9. Se surte de inventario (FIFO)
10. Se timbra CFDI
11. Se registra en cobranza
```

---

## 6. Historial de versiones del sistema

| Versión | Fecha | Cambios |
|---|---|---|
| v1.0 | 2026-06-07 | Deploy inicial: Auth, Solicitudes (Excel/PDF), Comparador, Cotización PDF |
| v1.1 | 2026-06-07 | Branding INNOVACOM: logo, colores, nombre sistema |
| v1.2 | 2026-06-07 | PDF rediseñado: turquesa, IVA por línea, COC, firmas |
| v1.3 | 2026-06-07 | Schema v2: usuarios con puesto/jefe_id, cotizaciones con elaborado_por_id, iva_exento |
| v1.4 | 2026-06-07 | Módulo gestión de usuarios con jerarquía elaboró/autorizó |
| v1.5 | 2026-06-08 | Fix Apache HTTPS sistema.innovacom.mx con SSL Let's Encrypt |
| v1.6 | pendiente | Fix parser Excel: encabezados en fila 5, COC, partidas originales, NO COTIZO |
| v1.7 | 2026-06-10 | Atención y Concepto: columnas en BD, captura en Nueva Solicitud, herencia a la COT, en PDF; etiqueta del PDF "COC" → "No. Solicitud Cliente"; parser extrae DIRIGIR A (col C) y DESCRIPCION (col G) |
| v1.8 | 2026-06-10 | PWA instalable en iOS/Android: manifest, service worker, íconos, meta tags Apple; layout responsive móvil (sidebar drawer + hamburguesa); Apache sirve manifest+json y sw.js sin caché |
| v1.9 | 2026-06-16 | Tabla `proveedores_catalogo` (tarifario por proveedor + equivalencia SKU INNOVACOM, PK compuesta sin autonumérico). Migración `migrate_v10.js`. Carga del catálogo Pronamac Febrero 2026: 2,407 renglones (2,305 con precio, 461 con equivalencia, 459 vinculados a productos) vía `import_pronamac_cli.js` |
| v2.0 | 2026-06-16 | **Búsqueda automática de precios = catálogo primero, internet (IA) como respaldo.** Nuevo endpoint `POST /solicitudes/:id/partidas/:pid/buscar-precio-catalogo` (auto-registra solo con vínculo confiable: `producto_id` o código exacto; descripción = sugerencia, no registra). Página **Catálogo proveedores** (`/catalogo-proveedores`): buscar/filtrar/editar precio y vincular producto. En `DetalleSolicitud`: botones "Solo catálogo" / "Solo internet" / "Buscar precios" (combinado). El registro de precio se unificó en helpers `registrarPrecioProveedor` + `recalcularMejorPrecio` |
| v2.1 | 2026-06-23 | **Módulo Herramientas → Importar/Exportar.** Layout de catálogo y equivalencias desamarrado de Pronamac: ambos archivos llevan columna **PROVEEDOR** (nombre o ID), resuelto/creado por renglón. Backend nuevo `src/modules/herramientas/` (service + controller + routes en `/api/herramientas`: `POST /importar/:tipo` con `?dry_run=1`, `GET /plantilla/:tipo`, `GET /exportar/:tipo?proveedor_id=`), fuente única usada también por el CLI `import_pronamac_cli.js` (refactorizado). Frontend: grupo de menú **Herramientas** con `Importar datos` (dropzone + vista previa gráfica de columnas + plantilla) y `Exportar datos` (xlsx mismo layout); helper `services/descargas.js`. Sin migración |
