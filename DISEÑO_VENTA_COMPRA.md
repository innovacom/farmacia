# Diseño — Enlace Cotización ↔ Compras ↔ Inventario ↔ Entrega

> Para revisión antes de codificar. Sin interfaz CFDI en este paso.
> Fecha: 2026-06-14.

## Flujo completo
```
COTIZACIÓN (aceptada)
  │
  ├─▶ 1. ASIGNACIÓN DEL CLIENTE  (pantalla)
  │      El cliente dice qué partidas/cantidades nos asignó → se crea el PEDIDO.
  │
  ├─▶ 2. GENERAR ÓRDENES DE COMPRA
  │      Agrupa las partidas del pedido por el proveedor que dio el mejor precio
  │      → una OC por proveedor. (Se dispara desde el pedido.)
  │
  ├─▶ 3. RECEPCIÓN DE COMPRAS  (pantalla, admite PARCIALES)
  │      Por cada OC se reciben piezas (total o parcial, en varias entregas).
  │      Cada recepción genera una ENTRADA al inventario (lote + caducidad + ubicación).
  │
  └─▶ 4. ENTREGA AL CLIENTE  (pantalla, admite PARCIALES)
         Remisión o Factura por lo que vamos a entregar → genera SALIDA de inventario
         y un PDF (mismo formato, solo cambia el título). Sin timbrado CFDI por ahora.
```

## Tablas nuevas
| Tabla | Rol |
|---|---|
| `pedidos_cliente` | Encabezado del pedido (nace de la cotización aceptada). Folio PED. Estatus: abierto / surtido_parcial / surtido / entregado / cerrado. |
| `pedidos_cliente_partidas` | Partidas asignadas: producto, cantidad_asignada, precio_venta, proveedor mejor precio, precio_compra, **cantidad_recibida** y **cantidad_entregada** (acumuladores de avance). |
| `ordenes_compra` | Encabezado de OC por proveedor. Folio OC. Estatus: abierta / parcial / recibida / cancelada. |
| `ordenes_compra_partidas` | Renglones de la OC: producto, cantidad, precio_compra, **cantidad_recibida**. |
| `recepciones` + `recepciones_partidas` | Cada recepción (parcial) de una OC; cada renglón dispara una ENTRADA al inventario (con lote/caducidad/ubicación). Folio REC. |
| `entregas` + `entregas_partidas` | Remisión/Factura al cliente (parcial); cada renglón dispara una SALIDA de inventario. Folio REM o FAC. Campo `tipo`. |

Reutiliza el servicio de inventario ya hecho (`registrarEntrada` / `registrarSalida`) y el generador de PDF (parametrizado por título).

## Pantallas nuevas (menú nuevo «Ventas / Surtido»)
1. **Pedido / Asignación** — desde una cotización aceptada: marcar partidas y capturar la cantidad asignada por el cliente.
2. **Órdenes de compra** — lista + detalle; botón para generarlas desde el pedido; PDF de OC por proveedor.
3. **Recepción de compras** — por OC, captura de lo recibido (parcial), lote, caducidad, ubicación → afecta inventario.
4. **Entregas al cliente** — genera remisión/factura por lo disponible → afecta inventario + PDF.

## Decisiones a confirmar (ver preguntas)
1. Agrupación de las OC.
2. Salida de la OC hacia el proveedor (PDF/registro).
3. Selección de lote al entregar al cliente.
4. Entregar solo lo que hay en inventario (vs backorder).
