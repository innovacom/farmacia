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

**Adición (revisión del plan, 2026-07-10):** branding por empresa (white-label) — logo, colores, tema y parámetros clave-valor por tenant, con pantalla de configuración multi-empresa. Ver §7.

---

## 6. Estado de implementación (2026-07-10)

**Entrega 1 — Fundación: ✅ IMPLEMENTADA Y VERIFICADA EN LOCAL**
1. ✅ `migrate_v28.js`: `empresas` (+branding), `empresas_config`, `sucursales` (1:1 almacén), `pos_cajas`, `pos_turnos` (UNIQUE de turno abierto por columna generada), `pos_caja_movimientos`, `medicos`, `pos_recetas`, `pos_ventas`, `pos_ventas_partidas`, `pos_facturas_globales`; ALTERs: `usuarios.empresa_id` (backfill=1), `productos.clasificacion_cofepris`, `cfdi_comprobantes.origen/pos_venta_id/pos_factura_global_id` (entrega_id ahora NULL-able). Corrida + re-corrida idempotente en MariaDB local.
2. ✅ `middleware/tenant.js` (deny-by-default, fallback a BD para JWT viejos) y `middleware/permisos.js` (`requirePermiso` — primer permiso server-side del repo). Claves `pos-venta/pos-turnos/pos-bitacora/pos-admin` en `menu.keys.js` + frontend.
3. ✅ Módulo `pos` (sucursales, cajas, turnos: abrir con doble candado, retiros/depósitos, corte, cierre con diferencia registrada — verificado por curl: doble apertura 409, arqueo con diferencia +50, 403 a operador sin permiso).
4. ✅ Módulo `empresas` + `services/branding.service.js` (caché): `mi-branding`, CRUD admin, config clave-valor (META), upload de logos (png/jpg/webp ≤2MB, nombre generado por server) servidos en `/uploads/branding`.
5. ✅ Theming: paleta `brand` → CSS variables (defaults INNOVACOM idénticos), `useBranding` genera la escala desde el color de la empresa; Sidebar con logo/nombre del tenant. Pantalla `Configuracion/Empresas.jsx` (datos fiscales, identidad visual con vista previa en vivo, parámetros POS) + select de empresa en usuarios.

**Entrega 2 — Venta mostrador: ✅ IMPLEMENTADA Y VERIFICADA EN LOCAL**
6. ✅ `registrarSalidaFEFO` extendido con `almacen_id` opcional + desglose de lotes (sin él, comportamiento idéntico — regresión verificada con salida multi-almacén).
7. ✅ `POST /api/pos/ventas` transaccional: idempotencia `client_uuid` (verificada: reintento devuelve el mismo folio), FEFO del almacén de la sucursal (verificado: caduca-antes primero, no toca otros almacenes), 409 stock con disponible, pagos mixtos con cambio, IVA desglosado del precio público.
8. ✅ Cancelación mismo-turno con reingreso por lote exacto (verificada en kardex) y 409 fuera de condiciones. Corte cuadra excluyendo canceladas.
9. ✅ UI: `VentaMostrador.jsx` (input siempre-focus para lector EAN, carrito, F2/F4, `.btn-pos`), `ModalCobro` (mixto, denominaciones, uuid al abrir), `TicketPrint` 58/80mm vía `window.print()` con branding y `@page` inyectado, `HistorialVentas.jsx` (reimpresión, cancelación, facturación).

**Entrega 3 — Recetas/COFEPRIS: ✅ IMPLEMENTADA Y VERIFICADA EN LOCAL**
10. ✅ Venta de controlado sin receta → 422 backend (verificado); con receta crea/reusa médico por cédula (verificado autocompletado). `ModalReceta` exige domicilio en fracciones II/III.
11. ✅ Bitácora = vista de consulta con lote/caducidad del FEFO, receta, médico, paciente, dispensó (verificada: la venta cancelada NO aparece; 403 sin permiso `pos-bitacora`). `Bitacora.jsx` exporta Excel (xlsx del frontend, una hoja por clasificación).
12. ✅ `clasificacion_cofepris` editable en el alta/edición de producto.

**Entrega 4 — CFDI mostrador: ✅ IMPLEMENTADA; PENDIENTE prueba con Facturama sandbox**
13. ✅ Refactor `cfdi.facturama.js`: extraídos `timbrarComprobante` (PAC + XML, sin BD) e `insertarComprobante` (INSERT con origen); `timbrarEntrega` queda como composición idéntica.
14. ✅ Factura individual `POST /api/pos/ventas/:id/facturar` (verificado: 422 con faltantes de claves SAT ANTES de llamar al PAC; 409 si ya facturada/global). Captura de RFC en `ModalCobro` y desde el historial.
15. ✅ Factura global en dos pasos (verificado: el borrador marca tickets transaccionalmente y excluye canceladas; segundo borrador mismo periodo → 422; fallo de timbre → `estatus='error'` re-timbrable; liberar tickets = acción manual con cerrojo). `FacturasGlobales.jsx` con confirmación antes de timbrar.
16. ✅ Consumidores de `cfdi_comprobantes` auditados: todos filtran `entrega_id = ?` — los registros POS (entrega_id NULL) no los afectan.
17. ⚠️ **Pendiente del usuario:** probar timbrado real (individual + global con `GlobalInformation`) contra Facturama **sandbox** — requiere `FACTURAMA_URL`/`FACTURAMA_TOKEN` en `.env`, que no están en esta copia. Todos los caminos previos al PAC quedaron verificados.

**Hallazgo pre-existente (no causado por este trabajo):** el repositorio NO incluye `frontend/src/pages/Cfdi/` (ConsultaCfdi, DescargasSat) ni `backend/src/modules/cfdi/` (consulta SAT + sat.cron), aunque `App.jsx`/`app.js` los importan — ni el build ni el arranque funcionaban desde esta copia. Se crearon **stubs marcados como tales** para restaurar build/arranque; hay que restaurar los originales desde la copia de producción/OneDrive y borrar los stubs.

## 7. Branding multi-empresa (white-label) — implementado

- `empresas`: `logo_path`, `logo_ticket_path`, `color_primario/secundario`, `tema`; `empresas_config`: clave-valor por tenant (`ticket_ancho_mm`, `ticket_leyenda_pie`, `ticket_mostrar_leyenda_factura`, `global_periodicidad_default`, `pos_permitir_descuento`) validado contra un `META` extensible sin migraciones.
- Frontend con CSS variables: sin branding configurado la app se ve idéntica a hoy; con branding, el color primario genera la escala 50–700 y pinta toda la UI; el ticket usa logo/leyendas del tenant.
- **Límite explícito:** el CFDI se timbra con el perfil Facturama global (un RFC por cuenta del PAC). Los datos fiscales por empresa ya están capturados para el multiemisor de Fase 3 (primera farmacia cliente externa con RFC propio).
