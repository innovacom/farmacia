# Reporte QA — Frontend DISMED

**Fecha:** 2026-07-02
**Alcance:** revisión de las 48 pantallas/componentes de `dismed/frontend/src` en dos pases (ingeniería de software + control de calidad), sin modificar código.
**Estado:** Fases 1–5 COMPLETAS e implementadas (2026-07-02), compiladas con Vite. Pendiente de desplegar con `python deploy.py`.
Fase 5 incluyó: edición inline de partidas en Detalle de Solicitud, componentes compartidos `ui/Modal.jsx` y `ui/ConfirmDialog.jsx` (useConfirm reemplaza window.confirm en 9 pantallas), exportación a Excel en Solicitudes/Cotizaciones/Pedidos (services/exportarExcel.js, xlsx con import dinámico), fetch único en ProductoPicker y payload limpio en edición de usuarios.

---

## 1. BUGS — Severidad ALTA

### B-01 · Cantidad no se puede capturar en Nueva Solicitud (bug reportado)
**Archivo:** `pages/Solicitudes/NuevaSolicitud.jsx:455-457`
```jsx
<input type="number" value={p.cantidad} min="0.01" step="0.01"
  onChange={(e) => updatePartida(idx, 'cantidad', parseFloat(e.target.value) || 1)} />
```
**Causa raíz:** input controlado que "normaliza" en cada tecla con `parseFloat(...) || 1`:
- Borrar el campo (Backspace/Supr) → `parseFloat('')` = NaN → regresa **1** al instante. Nunca se puede vaciar para teclear.
- Teclear `0`, `0.5` o cualquier valor intermedio que parsea a 0/NaN → regresa a **1**.
- Como el valor rebota, el usuario percibe que ni la captura directa ni las flechas del selector "colocan nada".

El mismo antipatrón en la misma pantalla: columna **Part.#** (línea 416, `parseInt || 0`).

**Patrón correcto ya usado en el propio sistema** (referencia): `Configuracion.jsx`, `Movimientos.jsx`, `DetallePedido.jsx` guardan el texto crudo en el estado (`onChange={(e)=>set(e.target.value)}`) y parsean **al guardar**. La corrección es unificar todos los numéricos a ese patrón.

### B-02 · Cambiar el margen global borra los márgenes por partida
**Archivo:** `pages/Cotizaciones/NuevaCotizacion.jsx:40-68`
El `useEffect` que construye las partidas depende de `[comparador, margenGlobal]` y al final hace `map((p) => ({...p, margen_pct: margenGlobal}))`. Cualquier cambio del margen global **reconstruye todas las partidas y pisa los márgenes individuales** que el usuario ya capturó. También un refetch del comparador (al volver a la pestaña) borra la captura.

### B-03 · Nueva Cotización ignora el IVA exento por partida
**Archivo:** `pages/Cotizaciones/NuevaCotizacion.jsx:44-56 y 81-83`
- Las partidas se envían al backend **sin el campo `iva_exento`** → el backend (`cotcli.controller.js:100`) lo interpreta como 0 y cobra IVA 16% a partidas exentas.
- Los totales en pantalla aplican `subtotal * 0.16` plano.
En cambio, la ruta Comparador → "Crear cotización" sí envía `iva_exento` (`ComparadorPrecios.jsx:200`). **Dos rutas al mismo documento producen totales distintos.**

### B-04 · Catálogo de productos truncado a 200 renglones en silencio
**Archivo:** `pages/Productos/ProductosList.jsx:67`
La consulta manda `limit: 200` fijo y la paginación es client-side. Con más de 200 productos que coincidan, el resto **no existe para el usuario** (ni aviso, ni página siguiente real). `CatalogoProveedor.jsx` ya implementa paginación de servidor correcta — usar ese patrón.

### B-05 · Plantillas de importación faltantes (bug reportado)
Solo **Herramientas → Importar** tiene "Descargar plantilla" (tipos `catalogo` y `equivalencias`, backend `herramientas.service.js:337`). Faltan:
| Pantalla | Modal | Plantilla |
|---|---|---|
| Productos → Importar catálogo maestro (hoja «CATALOGO») | `ImportCatalogoModal.jsx` | ❌ no existe (ni endpoint) |
| Inventario → Importar existencias | `ImportExistenciasModal.jsx` | ❌ no existe (ni endpoint) |
| Herramientas → Importar | `ImportarDatos.jsx` | ✅ |

Requiere: 2 endpoints nuevos de plantilla en backend + botón "Descargar plantilla" en ambos modales (reusando `services/descargas.js`).

---

## 2. BUGS — Severidad MEDIA

### B-06 · Familia del antipatrón `parseFloat(...) || X` en más pantallas
Mismo defecto de B-01 (no se puede vaciar el campo; valores intermedios rebotan):
- `NuevaCotizacion.jsx:129` margen global (`|| 0`), `:154` vigencia (`|| 30` — al borrar salta a 30), `:195` margen por partida (`|| 0`).
- `ComparadorPrecios.jsx:248` margen global, `:333` margen por partida.
- `Polizas.jsx:89` año (`|| añoActual`).

### B-07 · Registrar Precios envía partidas que el proveedor no cotiza
**Archivo:** `pages/Proveedores/RegistrarPrecios.jsx:34-48 y 59-66`
El `useEffect` inicializa `precios` para **todas** las partidas de la solicitud (con `disponible: true`), pero la tabla solo muestra las de `partidas_incluidas`. Al guardar, el payload incluye las partidas no mostradas marcadas como **disponibles con precio null**, contaminando el comparador.

### B-08 · Desactivar usuario sin confirmación
**Archivo:** `pages/Usuarios/UsuariosList.jsx:161`
"Desactivar" ejecuta directo, mientras Productos/Proveedores/Catálogo proveedor sí piden `window.confirm`. Igual: cambio de estatus Aceptada/Rechazada en `DetalleCotizacion.jsx:86-91` es irreversible visualmente y va sin confirmación.

### B-09 · Editor de precio del catálogo proveedor inconsistente y sin validación
**Archivo:** `pages/Proveedores/CatalogoProveedor.jsx:351-377` (`PrecioEdit`)
- No maneja Enter/Escape (el `TextoEdit` de la misma pantalla sí) — Enter no guarda.
- Guardar con el campo vacío manda `precio_lista: ''` al backend sin validar.
- No hay botón cancelar (X) como en el comparador.

### B-10 · Crear Pedido permite asignar más cantidad que la cotizada
**Archivo:** `pages/Ventas/CrearPedido.jsx:90-92`
El input de cantidad asignada no tiene `max={p.cantidad}` ni validación contra lo cotizado (Recepción y Entrega sí acotan con `max`).

---

## 3. INCONSISTENCIAS ENTRE PANTALLAS (bug reportado: "inconsistencia de funcionalidad")

| # | Funcionalidad | Pantallas que SÍ | Pantallas que NO |
|---|---|---|---|
| I-01 | Búsqueda/filtros en listados | Productos, Catálogo proveedor, Existencias, Movimientos, Bancos, Catálogo cuentas, Consultas, CFDI | **Solicitudes, Cotizaciones, Pedidos, Clientes, Proveedores, Usuarios** (ni texto ni filtro por estatus/fecha) |
| I-02 | Confirmación antes de acción destructiva | Productos, Proveedores, Catálogo prov., Pólizas, Descargas SAT, Cancelar CFDI | Usuarios (desactivar), Cotización (aceptar/rechazar) |
| I-03 | Patrón para abrir el detalle | Solicitudes/Cotizaciones: link "Abrir" | Pedidos: clic en el renglón completo (sin affordance visible) |
| I-04 | Acción "dar de baja" en catálogos | Productos y Proveedores (individual + masiva) | **Clientes: no se puede desactivar ningún cliente desde la UI** |
| I-05 | Formatos aceptados al importar | Herramientas y Nueva Solicitud aceptan `.xlsx/.xls/.csv` | ImportCatalogoModal e ImportExistenciasModal solo `.xlsx/.xls` (sin CSV) |
| I-06 | Inputs numéricos | Configuración, Movimientos, Recepción/Entrega, RegistrarPrecios (texto crudo, parse al guardar) ✅ | NuevaSolicitud, NuevaCotizacion, Comparador, Pólizas (normalizan por tecla) ❌ |
| I-07 | Paginación | Server-side: Catálogo proveedor. Client-side: 13 listados | ProductosList mezcla ambas (limit 200 + client-side) → B-04 |

---

## 4. MEJORAS PROPUESTAS (no son bugs)

- **M-01** `DetalleSolicitud.jsx`: cantidad, descripción y U/M de las partidas no son editables después de crear la solicitud (solo IVA y vínculo). Un error de captura obliga a rehacer la solicitud.
- **M-02** `ProductoPicker.jsx:25-37`: al abrir dispara la búsqueda dos veces (efecto de apertura + efecto de debounce sobre `q` inicial). Deduplicar.
- **M-03** `UsuariosList.jsx:87`: al editar se envía el objeto completo (`jefe_nombre`, `created_at`, etc.) al PUT. Enviar solo los campos del formulario.
- **M-04** Extraer el componente `Modal` duplicado en 5+ archivos (NuevaSolicitud, UsuariosList, ProductosList, ClientesList, ProveedoresList, DetallePedido) a `components/ui/Modal.jsx`.
- **M-05** Crear un componente compartido `InputNumerico` (o hook) con el patrón correcto, para que B-01/B-06 no reaparezcan.
- **M-06** Listados sin exportación: Solicitudes, Cotizaciones, Pedidos no tienen exportar a Excel mientras Herramientas sí exporta catálogos (definir si se desea homogeneizar).
- **M-07** Reemplazar `window.confirm` por un modal de confirmación propio y consistente (opcional, estético).

---

## 5. PLAN DE CORRECCIÓN INTEGRAL PROPUESTO

**Fase 1 — Bugs de captura (B-01, B-06, M-05):** componente/patrón único de input numérico (estado crudo, parse al guardar) y aplicarlo a NuevaSolicitud, NuevaCotizacion, Comparador y Pólizas. *Resuelve el bug reportado.*

**Fase 2 — Plantillas e importación (B-05, I-05):** endpoints `GET /productos/plantilla-catalogo` y `GET /inventario/plantilla-existencias` + botón "Descargar plantilla" en ambos modales + aceptar CSV.

**Fase 3 — Corrección de datos (B-02, B-03, B-07, B-10, B-04):** margen global sin pisar overrides, enviar `iva_exento` desde NuevaCotizacion, filtrar payload de RegistrarPrecios, `max` en CrearPedido, paginación de servidor en Productos.

**Fase 4 — Consistencia UI (I-01..I-04, B-08, B-09):** búsqueda + filtro de estatus en los 6 listados que no la tienen, confirmaciones faltantes, baja de clientes, PrecioEdit con Enter/Escape/cancelar.

**Fase 5 — Mejoras opcionales (M-01..M-04, M-06, M-07):** según prioridad que definas.

Cada fase se probará contra la app local y se desplegará con `python deploy.py` cuando lo indiques.
