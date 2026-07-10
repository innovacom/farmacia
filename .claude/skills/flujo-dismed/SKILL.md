---
name: flujo-dismed
description: Flujo de negocio de DISMED de punta a punta (solicitud → cotización → pedido → orden de compra → recepción → entrega/remisión/factura CFDI). Úsalo para entender en qué etapa está un proceso y cuál es el siguiente paso correcto.
---

# Flujo de negocio DISMED (workflow operativo)

Cadena de trazabilidad por folios: **SOL → COT → PED → OC → REC → REM/FAC**.

## 1. Solicitud (`solicitudes`)  — folio `SOL-AAAA-####`
- Entra una requisición del cliente (Excel, PDF o captura manual).
- Excel → `parser.excel.js` (SheetJS). PDF → `parser.pdf.js` (Anthropic API). El resultado SIEMPRE se valida en tabla editable antes de guardar.
- Se preservan `codigo_cliente` y `descripcion_original` sin modificar.
- Produce `solicitudes` + `solicitudes_partidas`.

## 2. Consulta a proveedores y comparación (`cotizaciones/proveedor`)
- Se seleccionan proveedores y se generan registros `cotizaciones_proveedor`.
- Se registran precios conforme responden → `cotizaciones_proveedor_precios`.
- El **Comparador de precios** (matriz producto × proveedor) marca el mejor precio (`es_mejor_precio`).
- Primera vez que se mapea un SKU de proveedor, el usuario confirma; luego es automático (SKU learning).

## 3. Cotización al cliente (`cotizaciones/cliente`) — folio `COT-AAAA-####`
- Se crea desde la solicitud. Se aplica margen (global % o por línea).
- `pdf.generator.js` (Puppeteer) genera el PDF con membrete de la empresa → `/outputs/`.
- Estatus: `borrador → enviada → aceptada/rechazada`.

## 4. Pedido (`ventas` · `crearPedido`) — folio `PED-AAAA-####`
- Cuando el cliente indica las **partidas ganadas**, el usuario las marca y se crea `pedidos_cliente` + `pedidos_cliente_partidas`.
- Cada partida resuelve su proveedor con mejor precio. La cotización pasa a `aceptada`.

## 5. Órdenes de compra (`ventas` · `generarOC`) — folio `OC-AAAA-####`
- Agrupa las partidas pendientes **por proveedor** y emite una OC por proveedor (`ordenes_compra` + `_partidas`), con PDF.

## 6. Recepción (`ventas` · `recepcion`) — folio `REC-AAAA-####`
- Recepción (puede ser parcial) contra la OC. Entra a inventario por lote/caducidad (FEFO) vía `movimientos.service`.
- Actualiza `cantidad_recibida` en OC y pedido; la OC pasa a `parcial`/`recibida`.

## 7. Entrega al cliente (`ventas` · `crearEntrega`) — folio `REM-` o `FAC-AAAA-####`
- El usuario decide **Remisión** o **Factura**. Salida de inventario por FEFO.
- **Remisión:** documento simple, PDF.
- **Factura (CFDI 4.0):** antes de confirmar se **valida** que estén capturados los datos fiscales (emisor, receptor con CP/régimen/uso CFDI, claves SAT por concepto). Si falta algo → 422 con la lista; no se crea la factura ni se descuenta inventario.
  - Al pasar, genera un **TXT delimitado por comas** en `/outputs/cfdi/<folio>.txt` (`cfdi.txt.generator.js`) y marca `estatus_cfdi='generado'`.
  - El **timbrado** (TXT → PAC) está PENDIENTE de la spec del PAC: solo se reescribirá `construirTxt()`.

## Reglas de negocio clave
- **IA como asistente:** Anthropic parsea/sugieren, el usuario confirma. La IA nunca decide sola (matcher usa lista cerrada anti-alucinación).
- **Preservar original:** `codigo_cliente` y `descripcion_original` jamás se modifican.
- **Sucursales = clientes separados:** comparten RFC pero cada una es un cliente con sus propias cotizaciones (la BD permite RFC duplicado).
- **Una sola BD y es producción:** cuidado con operaciones destructivas.

## Consultas históricas (`consultas`)
- `/consultas` (4 pestañas: solicitudes, cotizaciones, órdenes de compra, pedidos) con filtros por nombre/descripción, código, SKU y rango de fechas. Incluye los 3,078 registros migrados del sistema anterior.
