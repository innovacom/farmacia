# Propuesta — Módulo POS Farmacia (conectado a DISMED)

> Documento para revisión del propietario **antes** de codificar.
> Fecha: 2026-07-10.

---

## 0. Resumen

DISMED hoy es un sistema **B2B** (solicitud → cotización → pedido → orden de compra → recepción → entrega/CFDI). Este módulo agrega un canal **B2C de mostrador**: venta directa al público en una farmacia física, con caja, receta médica y control de medicamentos controlados.

**Alcance confirmado con el propietario:**
- Uso dual: farmacia(s) propia(s) de DISMED **y** producto vendible a farmacias cliente.
- Control de recetas/controlados (COFEPRIS) crítico desde el MVP — sin esto no se puede operar legalmente.
- Multi-sucursal desde el diseño inicial.

**Implicación de arquitectura:** como eventualmente se vende a terceros, todo lo nuevo debe llevar `empresa_id` desde el día uno (aislamiento multi-tenant), aunque el primer tenant sea la propia operación de DISMED. Agregarlo después, con datos reales, es mucho más caro que incluirlo ahora.

---

## 1. Investigación de mercado

**Odoo (`pos_pharmacy_management` / `bi_pos_pharmacy_management`):**
Ficha de medicamento (sal, fabricante, padecimiento, efectos secundarios, alternativos), alertas de interacción/alergia que bloquean la venta, panel de info en el POS, receta y médico capturados en el ticket, vistas lista/cuadrícula + quickpay, integración nativa Inventario-Compras-Contabilidad.

**Pharmacy Lite (líder MX, 25 años):**
POS + Inventario móvil + Concentrador multi-sucursal + Consultorio médico integrado. Compra inteligente por consumo real, comparación de proveedores, inventarios desde celular, CFDI 4.0 con envío automático, bitácora de antibióticos/controlados, cumplimiento COFEPRIS, actualización automática de PMP vía catálogo PLM, roles de usuario, dashboard consolidado.

**SICAR X (otro líder MX):**
Lotes y caducidades, stock global en la nube multi-sucursal, receta médica + bitácora de controlados lista para auditoría COFEPRIS, etiquetado por componente químico (búsqueda de genéricos/alternativos), importación masiva vía Excel, reportes de caducidad y cortes de caja.

**Fuentes:**
- [pos_pharmacy_management — Odoo Apps](https://apps.odoo.com/apps/modules/19.0/pos_pharmacy_management)
- [Pharmacy Lite — Características](https://www.pharmacylite.mx/software-farmacias-caracteristicas)
- [SICAR X — Sistema para Farmacias](https://www.sicarx.com/sistema-para-farmacias-punto-de-venta)

---

## 2. Qué ya tiene DISMED y se reutiliza tal cual

Esto es clave: **gran parte de la infraestructura de un POS de farmacia ya está construida** en DISMED, para el flujo B2B. No hay que rediseñarla, solo conectarla al mostrador.

| Ya implementado | Dónde | Reutilización en POS Farmacia |
|---|---|---|
| Catálogo de productos con `control_lote_caducidad`, `unidad_base`/`factor_empaque`, taxonomía familia/categoría/subcategoría | `productos`, módulo `productos` | Mismo catálogo — no se duplica |
| Almacenes, ubicaciones, lotes por caducidad, kardex (entrada/salida/traspaso/ajuste), **FEFO** | `inventario_lotes`, `inventario_movimientos`, módulo `inventario` (`Almacenes.jsx`, `Movimientos.jsx`, `Existencias.jsx`) | Cada venta de mostrador = una **SALIDA** de inventario vía `movimientos.service.js`, ya con FEFO |
| Clientes (con SKU propios, RFC, datos CFDI) | `clientes`, módulo `clientes` | Cliente registrado en mostrador = mismo modelo; venta a "público en general" = cliente genérico |
| Proveedores + catálogo por proveedor (`proveedores_catalogo`) | módulo `proveedores` | Compras de reabastecimiento de farmacia usan el mismo flujo de OC/recepción ya construido en `DISEÑO_VENTA_COMPRA.md` |
| CFDI (Facturama), generación de TXT, folios | `cfdi.facturama.js`, `cfdi.txt.generator.js` | Ticket/factura de mostrador reutiliza el mismo timbrado, solo cambia el origen (venta directa vs entrega) |
| Roles y permisos por usuario | `usuarios_permisos`, `/me/permisos` | Base para roles nuevos: cajero, farmacéutico responsable |
| PDF letterhead (Puppeteer) | `pdf.generator.js` / `ventas.pdf.js` | Mismo patrón para el ticket de venta |

**Conclusión:** no hace falta un "Fase 2 de inventario" nuevo — ya existe. El trabajo nuevo real es más chico de lo que parecía en el primer análisis.

---

## 3. Qué es genuinamente nuevo

| # | Submódulo | Por qué es nuevo | Depende de |
|---|---|---|---|
| 1 | **`empresa_id` (tenant)** | Ninguna tabla actual distingue "farmacia propia" vs "farmacia cliente". Es la base de todo lo demás si se va a vender como producto. | — |
| 2 | **Sucursales** | `almacenes` es un concepto de bodega física, no de "punto de venta con caja". Una sucursal de farmacia normalmente ES también un almacén, pero necesita datos propios (horario, responsable, terminal). | `empresa_id` |
| 3 | **Caja y turnos** | Apertura/cierre de caja, fondo inicial, corte por cajero, arqueo. No existe nada parecido hoy (DISMED no maneja efectivo de mostrador). | Sucursales |
| 4 | **Venta mostrador (POS UI)** | Pantalla táctil optimizada para velocidad: código de barras, carrito, pago mixto (efectivo/tarjeta), ticket impreso. Muy distinta de la UI B2B de cotizaciones. | Caja, catálogo existente |
| 5 | **Recetas y medicamentos controlados (COFEPRIS)** | Folio de receta, médico (cédula), paciente, bitácora de antibióticos/psicotrópicos exportable para auditoría. No existe ningún concepto de "receta" en el sistema actual. | Venta mostrador |
| 6 | **Venta a público en general + CFDI simplificado** | Hoy todo CFDI nace de una `entrega` ligada a un `cliente` con RFC fiscal. El mostrador necesita ticket sin factura + "factura global" o RFC genérico (XAXX010101000). | CFDI existente |
| 7 | **Hardware POS** | Lector de código de barras, impresora térmica de tickets, cajón de dinero — integración física nueva en el frontend. | Venta mostrador |

---

## 4. Fases propuestas

### MVP
1. `empresa_id` en tablas nuevas (diseño de aislamiento tenant)
2. Sucursales (vinculadas 1:1 a un almacén existente)
3. Caja y turnos (apertura, cierre, arqueo)
4. Venta mostrador (POS UI + salida de inventario vía servicio existente)
5. Recetas y controlados con bitácora COFEPRIS
6. Ticket/CFDI simplificado desde POS
7. Hardware básico (código de barras + impresora)

### Fase 2
- Traspasos entre sucursales (ya existe el movimiento `traspaso` en kardex — solo exponerlo en UI de farmacia)
- Alertas de interacción medicamentosa / alergias / sustitutos genéricos (requiere nuevo campo de sal activa — parcialmente cubierto por `sustancia_activa` en `productos`)
- Compras automáticas por consumo/rotación (reabastecimiento sugerido)
- Dashboard concentrador multi-sucursal

### Fase 3
- Promociones/fidelización
- Empaquetado como producto self-service para farmacias cliente (onboarding, facturación del propio SaaS)

---

## 5. Decisiones tomadas (2026-07-10, confirmadas por el propietario)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Aislamiento de datos | ✅ **Una BD compartida con `empresa_id`** en todas las tablas nuevas. Middleware que fuerza el filtro por empresa en cada query (deny-by-default, mismo espíritu que los permisos de menú). |
| 2 | Sucursal vs almacén | ✅ **Sucursal ligada 1:1 a un almacén** existente (FK a `almacenes`). Las ventas de mostrador descuentan de ese almacén vía el kardex FEFO ya construido. |
| 3 | Facturación del mostrador | ✅ **Ticket simple + factura global** al RFC genérico XAXX010101000 por los tickets no facturados (cierre diario/mensual). Factura individual en caja cuando el cliente da su RFC. La autofactura en línea con código en el ticket queda como candidata a Fase 2. |
| 4 | Hardware | ✅ **PC/laptop + lector USB (modo teclado) + impresora térmica 58/80mm** (navegador o QZ Tray) + cajón conectado a la impresora. El POS se diseña como web; el lector no requiere integración especial. |
| 5 | Cédula del médico | ✅ **Captura libre + catálogo propio de médicos** (tabla `medicos`): autocompletado por cédula en ventas siguientes. Sin validación externa (COFEPRIS exige registrar, no verificar). Verificación contra SEP: opcional, Fase 2. |

**Impacto en el MVP:** estas decisiones no agregan submódulos; concretan los ya listados en §4. La tabla `medicos` se suma al submódulo de recetas (§3.5) y la factura global se suma al submódulo CFDI simplificado (§3.6).
