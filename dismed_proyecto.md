# innovacom — Sistema Web de Distribución de Insumos Médicos

## Documento Técnico para Claude Code · v1.0 · Mayo 2025

\---

## 1\. CONTEXTO DE LA EMPRESA

|Campo|Detalle|
|-|-|
|**Giro**|Distribución de insumos y equipamiento médico|
|**Ubicación**|México|
|**Usuarios del sistema**|2 a 5 personas|
|**Propietario**|Hombre, 54 años, experiencia en el sector|
|**Urgencia**|Implementación en 2 a 3 meses|

### Productos que distribuye

* Medicamentos
* Materiales de curación
* Ropa de hospital
* Equipamiento para clínicas
* Instrumentos de laboratorio médico
* Detergentes especializados para hospitales

### Clientes típicos

Hospitales públicos, clínicas privadas, farmacias, laboratorios clínicos.  
Ventas a **contado y crédito** (facturas a plazo).

### Característica crítica del negocio

**No existe un catálogo fijo de productos.** Cada solicitud del cliente puede traer productos diferentes. El flujo inicia siempre con:

1. El cliente envía una solicitud (Excel, PDF o verbal)
2. Se consultan múltiples proveedores para cotizar esos productos específicos
3. Se comparan precios y se elige el menor
4. Se aplica margen de ganancia y se genera cotización al cliente

\---

## 2\. SISTEMA ACTUAL (a reemplazar)

* Aplicación de escritorio en **C# + MySQL** sobre Windows
* Comparación de precios en **Excel manual** (columna por proveedor)
* Generación de cotización en PDF desde el mismo Excel
* CFDI timbrado ante el SAT (ya opera con facturación electrónica)
* Acceso a base de datos: MySQL expuesto con usuario/contraseña
* Infraestructura: **VPS propio disponible** (cPanel + phpMyAdmin)

\---

## 3\. OBJETIVO DEL PROYECTO

Construir un **sistema web** moderno que reemplace la aplicación de escritorio y el Excel, con enfoque inicial en el módulo de cotización (el más crítico), escalable hacia inventario, facturación CFDI y cobranza.

### Objetivos específicos

1. Eliminar la recaptura manual: cargar solicitudes del cliente desde Excel/PDF directamente
2. Automatizar la comparación de precios de múltiples proveedores
3. Construir un diccionario de equivalencias de códigos (cliente ↔ interno ↔ proveedor)
4. Generar cotizaciones en PDF con membrete profesional
5. Controlar inventario por lotes y fechas de caducidad
6. Emitir CFDI timbrado desde el sistema
7. Gestionar cuentas por cobrar y pagos parciales

\---

## 4\. ARQUITECTURA TÉCNICA

### Stack recomendado

```
Frontend:   React + Vite + TailwindCSS
Backend:    Node.js + Express
Base datos: MySQL 8.0 (VPS existente)
PDF:        Puppeteer (generación server-side)
Email:      Nodemailer + SMTP Gmail/Outlook
IA parser:  Anthropic API (claude-sonnet) — extracción de productos desde PDF
Excel:      SheetJS (xlsx) — lectura de archivos del cliente
CFDI:       PAC a definir (Finkok, SW Sapien, Facturapi, etc.)
Auth:       JWT + bcrypt
```

### Infraestructura

```
VPS propio del cliente
├── Panel: cPanel
├── MySQL 8.0 expuesto en puerto 3306
├── Acceso: phpMyAdmin disponible
└── SO: Linux (típico en cPanel)
```

### Capas del sistema

```
\[Navegador — React]
       ↕ HTTPS / REST API
\[Servidor Node.js + Express]
  ├── Parser archivos (xlsx, pdf-parse, Anthropic API)
  ├── Motor de comparación de precios
  ├── Generador PDF (Puppeteer)
  ├── Envío de correos (Nodemailer)
  ├── Integración CFDI (PAC)
  └── Alertas (caducidades, stock, CxC)
       ↕ SQL queries
\[MySQL 8.0]
```

\---

## 5\. MÓDULOS DEL SISTEMA

### Módulo 1 — Solicitudes del cliente ⭐ PRIORIDAD 1

**Problema actual:** El cliente envía Excel o PDF con lista de productos. Hoy se recaptura manualmente.

**Solución:**

* Drag \& drop de archivos Excel (.xlsx, .xls, .csv) y PDF
* Para Excel: detección automática de columnas (producto, cantidad, unidad) con SheetJS
* Para PDF: extracción con Anthropic API (claude-sonnet) via prompt estructurado
* Captura manual como fallback
* Tabla editable para corregir antes de continuar
* Reconocimiento automático de códigos del cliente (via tabla `clientes\_skus`)

**Campos que se capturan por partida:**

* `codigo\_cliente` — código exacto del cliente tal cual
* `descripcion\_original` — texto sin modificar
* `producto\_id` — resuelto automático si existe equivalencia, manual si es primera vez
* `cantidad`, `unidad\_medida`, `observaciones`

\---

### Módulo 2 — Solicitud y comparación de precios a proveedores ⭐ PRIORIDAD 1

**Problema actual:** Excel con columna por proveedor, proceso manual y disperso.

**Solución:**

* Catálogo de proveedores con chips seleccionables
* El usuario elige qué proveedores consultar para cada solicitud (por experiencia)
* Generación automática de mensaje de solicitud de cotización (texto listo para copiar o enviar por correo)
* Apertura directa en cliente de correo (`mailto:`) con asunto y cuerpo prellenados
* Registro de precios por proveedor conforme responden (formulario por proveedor)
* Comparador automático: verde = menor precio, rojo = mayor precio, "N/D" = no cotizó
* El `sku\_proveedor` se guarda automáticamente en `proveedores\_skus` al registrar precios
* Buscador con IA para proveedores desconocidos (Anthropic API)

**Lógica de comparación:**

```
Para cada partida:
  mejor\_precio = MIN(precio\_unitario) donde disponible = 1
  es\_mejor\_precio = 1 para ese proveedor
  precio\_venta = mejor\_precio \* (1 + margen\_pct / 100)
```

\---

### Módulo 3 — Cotización al cliente ⭐ PRIORIDAD 1

**Problema actual:** Generada desde Excel, proceso separado del comparador.

**Solución:**

* Generación automática desde el comparador (un clic)
* Margen de ganancia: % base global + ajuste manual por partida
* PDF generado server-side con Puppeteer

**Formato del PDF de cotización:**

```
Encabezado:
  - Logo + nombre empresa + RFC + teléfono + email
  - Folio: COT-2025-0001
  - Fecha y vigencia (10 días por defecto)

Datos del cliente:
  - Razón social, RFC, referencia de su requisición

Tabla de partidas:
  # | Descripción | Cant. | U/M | P. Unitario | Importe | Observaciones
  (columna Observaciones es diferenciador del negocio)
  Mostrar también: SKU interno (DM-00045) y código cliente (HRN-MED-0042)

Totales:
  Subtotal | IVA 16% | Total

Condiciones:
  Moneda | Condición de pago | Tiempo de entrega

Firma del elaborador
Nota de pie (precios sujetos a disponibilidad, etc.)
```

\---

### Módulo 4 — Inventario con lotes y caducidades

* Stock por producto, lote y fecha de caducidad
* FIFO automático en salidas (descuenta el lote más antiguo primero)
* Alertas automáticas a 90, 60 y 30 días antes de caducidad
* Alerta de stock mínimo
* Vista `v\_inventario` con semáforo: CADUCADO / ALERTA\_30 / ALERTA\_60 / ALERTA\_90 / OK

\---

### Módulo 5 — Pedidos

* Nace de cotización aceptada (un clic: COT → PED)
* Folio automático: PED-2025-0001
* Estatus: confirmado → en\_proceso → entregado → cancelado
* Dispara descuento de inventario (FIFO por lote)

\---

### Módulo 6 — Facturación CFDI

* Integración con PAC (a definir: Finkok, SW Sapien o Facturapi)
* Timbrado desde el pedido (un clic)
* Almacenamiento de XML y PDF en servidor
* UUID SAT guardado en BD
* Cancelación ante SAT desde el sistema
* Campos requeridos del cliente: RFC, régimen fiscal, uso CFDI

\---

### Módulo 7 — Cobranza y cuentas por cobrar

* CxC generada automáticamente al timbrar factura
* Soporte para pagos parciales
* Vista `v\_cuentas\_por\_cobrar` con semáforo:

  * `AL\_CORRIENTE` — no vencida
  * `POR\_VENCER` — vence en ≤ 7 días
  * `VENCIDA` — vencida
  * `VENCIDA\_CRITICA` — vencida > 30 días
* Registro de comprobante de pago (imagen/PDF)

\---

### Módulo 8 — Dashboard y reportes

* Indicadores clave: cotizaciones activas, pedidos en proceso, CxC vencida, productos por caducar
* Exportación a Excel
* Historial de precios por proveedor (para negociación futura)

\---

## 6\. DICCIONARIO DE EQUIVALENCIAS DE CÓDIGOS

Este es uno de los elementos más importantes del sistema. Resuelve el problema de que el mismo producto tiene tres nombres distintos:

```
Cliente usa:    HRN-MED-0042  "Guantes nitrilo talla M paq 100"
Nosotros usamos: DM-00045     "Guantes de nitrilo T-M (caja 100 piezas)"
MedSupply usa:  GL-NIT-M-100  "Nitrile Gloves M 100ct"
FarmaPlus usa:  GNT100M       "Guante Nitrilo Mediano Caja"
```

**Tablas involucradas:**

* `clientes\_skus` — código cliente → producto\_id
* `proveedores\_skus` — sku\_proveedor → producto\_id
* `productos.sku\_interno` — eje central (formato DM-00001)

**Flujo de aprendizaje:**

1. Primera vez: sistema sugiere equivalencia, usuario confirma
2. Segunda vez: resolución automática sin intervención
3. Registro del campo `confirmado` para distinguir sugerencias de confirmaciones

\---

## 7\. FLUJO COMPLETO DEL NEGOCIO

```
Cliente envía solicitud (Excel/PDF/email)
        ↓
\[1] Carga en sistema → detección automática de productos
        ↓
\[2] Selección de proveedores → envío de solicitud de cotización
        ↓
\[3] Registro de precios conforme responden (3+ días típicamente)
        ↓
\[4] Comparador automático → selección del menor precio
        ↓
\[5] Aplicar margen (% base + ajuste manual por partida)
        ↓
\[6] Generar cotización PDF → enviar al cliente
        ↓
\[7] Cliente acepta → convertir en Pedido (PED)
        ↓
\[8] Surtir de inventario (FIFO por lote/caducidad)
        ↓
\[9] Timbrar CFDI ante SAT
        ↓
\[10] Registrar en cobranza → seguimiento de pagos
```

\---

## 8\. ESQUEMA DE BASE DE DATOS COMPLETO

> El script SQL ejecutable está en el archivo `dismed\_schema\_v2.sql`

### Resumen de tablas (15 tablas + 3 vistas + 2 stored procedures)

#### Clientes

|Tabla|Descripción|
|-|-|
|`clientes`|Razón social, RFC, régimen fiscal, uso CFDI, límite de crédito, días de crédito|
|`clientes\_contactos`|Contactos por cliente (compras, pagos). `es\_principal` recibe cotizaciones|
|`clientes\_skus`|Diccionario: código del cliente → `producto\_id` interno|

#### Proveedores

|Tabla|Descripción|
|-|-|
|`proveedores`|`nombre\_empresa`, `nombre\_contacto`, `puesto\_contacto`, email, teléfono, WhatsApp|
|`proveedores\_categorias`|Categorías que maneja cada proveedor|
|`proveedores\_skus`|Diccionario: `sku\_proveedor` → `producto\_id` interno. Se alimenta automáticamente|

#### Productos e inventario

|Tabla|Descripción|
|-|-|
|`productos`|`sku\_interno` UNIQUE (DM-00001) es la llave maestra del sistema|
|`inventario\_lotes`|Lotes con `fecha\_caducidad`, `cantidad\_actual`, `costo\_unitario`. FIFO en salidas|

#### Solicitudes y comparación

|Tabla|Descripción|
|-|-|
|`solicitudes`|Encabezado. Folio SOL-2025-0001. `tipo\_origen`: excel/pdf/manual|
|`solicitudes\_partidas`|`codigo\_cliente` (tal cual), `descripcion\_original`, `producto\_id` resuelto|
|`cotizaciones\_proveedor`|Una fila por proveedor × solicitud. Mide tiempo de respuesta|
|`cotizaciones\_proveedor\_precios`|Precio por proveedor × partida. `sku\_proveedor` se guarda aquí|

#### Cotizaciones al cliente

|Tabla|Descripción|
|-|-|
|`cotizaciones\_cliente`|Folio COT-2025-0001. Subtotal, IVA, total. Estatus: borrador→enviada→aceptada|
|`cotizaciones\_cliente\_partidas`|`sku\_interno` + `codigo\_cliente` + `precio\_compra` + `margen\_pct` + `precio\_unitario\_venta`|

#### Ventas y cobranza

|Tabla|Descripción|
|-|-|
|`pedidos`|Folio PED-2025-0001. Nace de cotización aceptada|
|`facturas`|`uuid\_sat`, `xml\_path`, `pdf\_path`, `estatus\_sat`|
|`cobranza`|CxC por factura. `saldo` = `monto\_total` - `monto\_pagado`|
|`pagos`|Pagos parciales. `comprobante\_path` para voucher|

#### Infraestructura

|Tabla|Descripción|
|-|-|
|`folios`|Generador de consecutivos por serie y año|

#### Vistas

|Vista|Descripción|
|-|-|
|`v\_comparador\_precios`|Une solicitudes + partidas + precios de todos los proveedores|
|`v\_inventario`|Stock consolidado + semáforo de caducidad + alerta de stock mínimo|
|`v\_cuentas\_por\_cobrar`|CxC con semáforo: AL\_CORRIENTE / POR\_VENCER / VENCIDA / VENCIDA\_CRITICA|

#### Stored Procedures

|Procedimiento|Descripción|
|-|-|
|`sp\_generar\_folio(serie, OUT folio)`|Genera SOL-2025-0001, COT-2025-0001, PED-2025-0001|
|`sp\_generar\_sku(OUT sku)`|Genera DM-00001, DM-00002, ...|

\---

## 9\. ESTRUCTURA DE CARPETAS SUGERIDA

```
dismed/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js              # Conexión MySQL (mysql2/promise)
│   │   │   └── env.js             # Variables de entorno
│   │   ├── middleware/
│   │   │   ├── auth.js            # JWT verification
│   │   │   └── upload.js          # Multer config para archivos
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── clientes/
│   │   │   ├── proveedores/
│   │   │   ├── solicitudes/
│   │   │   │   ├── parser.excel.js    # SheetJS
│   │   │   │   └── parser.pdf.js      # Anthropic API
│   │   │   ├── cotizaciones/
│   │   │   │   ├── proveedor/
│   │   │   │   └── cliente/
│   │   │   │       └── pdf.generator.js  # Puppeteer
│   │   │   ├── inventario/
│   │   │   ├── pedidos/
│   │   │   ├── facturas/          # CFDI / PAC
│   │   │   └── cobranza/
│   │   └── app.js
│   ├── .env
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                # Botones, inputs, badges reutilizables
│   │   │   ├── layout/            # Sidebar, header, nav
│   │   │   └── shared/            # Tabla, modal, semáforo
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Solicitudes/
│   │   │   │   ├── NuevaSolicitud.jsx   # Carga Excel/PDF
│   │   │   │   └── DetalleSolicitud.jsx
│   │   │   ├── Proveedores/
│   │   │   │   ├── Comparador.jsx       # Tabla de precios
│   │   │   │   └── RegistrarPrecios.jsx
│   │   │   ├── Cotizaciones/
│   │   │   │   ├── NuevaCotizacion.jsx
│   │   │   │   └── DetalleCotizacion.jsx
│   │   │   ├── Inventario/
│   │   │   ├── Pedidos/
│   │   │   ├── Facturas/
│   │   │   └── Cobranza/
│   │   ├── services/              # Llamadas a la API REST
│   │   ├── store/                 # Estado global (Zustand o Context)
│   │   └── main.jsx
│   ├── index.html
│   └── package.json
│
├── uploads/                       # Archivos subidos (Excel, PDF clientes)
├── outputs/                       # PDFs generados (cotizaciones, facturas)
├── dismed\_schema\_v2.sql           # Script de creación de BD
└── README.md
```

\---

## 10\. VARIABLES DE ENTORNO REQUERIDAS

```env
# Base de datos
DB\_HOST=IP\_DEL\_VPS
DB\_PORT=3306
DB\_USER=dismed\_user
DB\_PASSWORD=password\_seguro
DB\_NAME=dismed\_db

# JWT
JWT\_SECRET=clave\_muy\_larga\_y\_aleatoria
JWT\_EXPIRES\_IN=8h

# Anthropic (parser de PDF y buscador de proveedores)
ANTHROPIC\_API\_KEY=sk-ant-...

# Email (para envío de solicitudes a proveedores)
SMTP\_HOST=smtp.gmail.com
SMTP\_PORT=587
SMTP\_USER=correo@empresa.com
SMTP\_PASS=app\_password

# Archivos
UPLOAD\_DIR=./uploads
OUTPUT\_DIR=./outputs
BASE\_URL=http://IP\_VPS:3000

# PAC CFDI (a configurar)
PAC\_USUARIO=
PAC\_PASSWORD=
PAC\_RFC\_EMISOR=
```

\---

## 11\. APIS REST PRINCIPALES

### Solicitudes

```
POST   /api/solicitudes                    # Crear solicitud
POST   /api/solicitudes/parse-excel        # Extraer productos de Excel
POST   /api/solicitudes/parse-pdf          # Extraer productos de PDF (IA)
GET    /api/solicitudes/:id                # Detalle con partidas
PUT    /api/solicitudes/:id/partidas/:pid  # Actualizar partida (resolver producto\_id)
```

### Proveedores y comparador

```
GET    /api/proveedores                    # Lista activos
POST   /api/cotizaciones-proveedor         # Iniciar cotización a proveedores
PUT    /api/cotizaciones-proveedor/:id/precios  # Registrar precios recibidos
GET    /api/solicitudes/:id/comparador     # Vista comparador (usa v\_comparador\_precios)
```

### Cotizaciones al cliente

```
POST   /api/cotizaciones-cliente           # Crear desde comparador
GET    /api/cotizaciones-cliente/:id/pdf   # Generar y descargar PDF
PUT    /api/cotizaciones-cliente/:id/estatus  # Cambiar estatus
POST   /api/cotizaciones-cliente/:id/convertir-pedido  # → PED
```

### Inventario

```
GET    /api/inventario                     # Vista v\_inventario con alertas
POST   /api/inventario/lotes               # Registrar entrada de lote
GET    /api/inventario/alertas             # Productos por caducar y stock bajo
```

### Cobranza

```
GET    /api/cobranza                       # Vista v\_cuentas\_por\_cobrar
POST   /api/cobranza/:id/pagos             # Registrar pago (parcial o total)
```

\---

## 12\. PLAN DE DESARROLLO SUGERIDO (FASES)

### Fase 1 — Núcleo (semanas 1-4) ⭐ EMPEZAR AQUÍ

* \[ ] Setup: proyecto Node.js + React + MySQL conectado al VPS
* \[ ] Auth: login con JWT, un usuario admin inicial
* \[ ] Módulo solicitudes: carga Excel, carga PDF con IA, captura manual
* \[ ] Módulo comparador: registro de precios, tabla comparativa
* \[ ] Módulo cotización cliente: cálculo de márgenes + generación PDF
* \[ ] Catálogo básico de clientes y proveedores

### Fase 2 — Inventario y pedidos (semanas 5-7)

* \[ ] Módulo inventario: lotes, caducidades, alertas
* \[ ] Módulo pedidos: conversión desde cotización aceptada
* \[ ] FIFO en salidas de inventario
* \[ ] Dashboard con indicadores clave

### Fase 3 — Facturación y cobranza (semanas 8-10)

* \[ ] Integración con PAC para timbrado CFDI
* \[ ] Módulo cobranza: CxC, pagos parciales, semáforos
* \[ ] Notificaciones por correo (vencimientos, pagos)

### Fase 4 — Refinamiento y migración (semanas 11-12)

* \[ ] Migración de datos desde BD actual
* \[ ] Pruebas con datos reales
* \[ ] Capacitación a usuarios
* \[ ] Go-live en VPS

\---

## 13\. DECISIONES DE DISEÑO CLAVE

1. **Sin catálogo fijo de productos** — los productos se crean al recibir la primera solicitud que los incluye. El `sku\_interno` se genera automáticamente (DM-00001).
2. **Tres mundos de códigos** — `clientes\_skus` y `proveedores\_skus` son las tablas puente que eliminan la ambigüedad. La primera vez requiere confirmación humana, luego es automático.
3. **Preservar el texto original** — `descripcion\_original` y `codigo\_cliente` en `solicitudes\_partidas` guardan exactamente lo que el cliente envió, sin modificar, para referencia futura.
4. **Margen en dos niveles** — `% base global` aplicable a toda la cotización + `margen\_pct` por partida para ajustes individuales. Ambos se guardan en BD para analítica futura.
5. **Folios trazables** — SOL-2025-0001 → COT-2025-0001 → PED-2025-0001 → FAC-A-0001. Todo el ciclo es rastreable desde cualquier punto.
6. **MySQL sin migración de motor** — se mantiene MySQL 8.0 para aprovechar el VPS existente y los datos históricos del sistema anterior.
7. **IA como asistente, no como reemplazo** — el parser de PDF usa Anthropic API pero siempre presenta los resultados en tabla editable para que el usuario valide antes de continuar.

\---

## 14\. NOTAS PARA CLAUDE CODE

* El archivo `dismed\_schema\_v2.sql` contiene el DDL completo listo para ejecutar en MySQL 8.0
* Empezar por **Fase 1** completa antes de tocar inventario o facturación
* El módulo más crítico y diferenciador es el **comparador de cotizaciones** (Módulo 2)
* La variable de entorno `ANTHROPIC\_API\_KEY` es necesaria desde el día 1 para el parser de PDF
* Los stored procedures `sp\_generar\_folio` y `sp\_generar\_sku` ya están en el SQL — usarlos desde el backend con `CALL sp\_generar\_folio('COT', @folio); SELECT @folio;`
* Las vistas `v\_comparador\_precios`, `v\_inventario` y `v\_cuentas\_por\_cobrar` simplifican los endpoints más complejos
* El formato de cotización PDF debe incluir tanto `sku\_interno` como `codigo\_cliente` en cada partida
* Todos los precios en MXN, IVA siempre al 16%
* El campo `observaciones` en partidas de cotización al cliente es un diferenciador importante para el negocio — siempre mostrarlo en el PDF

\---

*Documento generado a partir de sesión de análisis de requerimientos · Mayo 2025
Archivos relacionados: `dismed\_schema\_v2.sql`*

