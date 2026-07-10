# Diseño del Módulo de Inventario — DISMED / INNOVACOM

> Documento para revisión del propietario **antes** de codificar.
> Fecha: 2026-06-14 · Fase 2 del roadmap.

---

## 0. Resumen de lo analizado

**`CATALOGO MAESTRO.xlsx` → hoja `CATALOGO`** (base del catálogo de productos):
- 1,597 productos, 20 columnas.
- `Id` (código INxxnnnnn): 100% lleno, **2 duplicados** → `INAP00236`, `PACI00102`.
- `EAN`: solo 248 reales (resto en 0) → **no sirve como clave única**.
- `IVA`: valores 0 ó 0.16 → mapea a la bandera `iva_exento` ya existente.
- `FAMILIA` (10), `CATEGORIA` (53), `SUBCATEGORIA` (156) → taxonomía a 3 niveles.

**`INVENTARIO REFINEIRA BODEGA.xlsx` → hoja `inventario 4 mayo 2026`** (existencias):
- Columnas: `SKU` (=Id catálogo), `LOTE` (0 = genérico), `CADUCIDAD`, `INVENTARIO` (cantidad), `TARIMA`/`ANAQUEL` (ubicación), `PRECIO`, `EMPAQUE MINIMO`.

**Estado producción:** `productos`=0 filas, `inventario_lotes`=0 filas. No existen tablas de almacén, ubicación ni movimientos.

---

## 1. Columnas del catálogo — propuesta de obligatorias (PARA TU VERIFICACIÓN)

| # | Columna Excel | Mapeo en sistema | Propuesta | Nota |
|---|---|---|---|---|
| 1 | `Id` | `sku_interno` (clave) | **OBLIGATORIA** | Eje de todo. Resolver 2 duplicados al importar. |
| 2 | `DESCRIPCION` | `descripcion` | **OBLIGATORIA** | |
| 3 | `UNIDAD_VENTA` | `unidad_medida` | **OBLIGATORIA** | Define la unidad de stock (ver QA-9). |
| 4 | `FAMILIA` | `familia_id` | **OBLIGATORIA** | Seleccionable desde tabla de apoyo `familias`. |
| 5 | `CATEGORIA` | `categoria_id` | **OBLIGATORIA** | Seleccionable desde tabla de apoyo `categorias_prod`. |
| 6 | `IVA` (0/0.16) | `iva_exento` | **OBLIGATORIA** | 0→exento=1; 0.16→exento=0. |
| 7 | `codigo_sat` | `clave_sat` | **OBLIGATORIA** | Necesaria para CFDI (Fase 3). |
| 8 | `unidad_sat` | `clave_unidad_sat` | **OBLIGATORIA** | Idem. |
| — | *(campo nuevo)* | `control_lote_caducidad` | **OBLIGATORIA (default = SÍ)** | Bandera nueva que pediste. |
| 9 | `SUBCATEGORIA` | `subcategoria_id` | **OBLIGATORIA** | Seleccionable desde tabla de apoyo. |
| 10 | `PRECIO_LISTA` | `precio_lista` | **OBLIGATORIA** | |
| 11 | `PRECIO_PUBLICO` | `precio_publico` | Recomendada | |
| 12 | `LABORATORIO` | `fabricante` | Recomendada | Solo 7% lleno aquí; mejor cruzar con hoja FABRICANTES. |
| 13 | `EAN` | `ean` | Opcional | Permitir nulo/duplicado. |
| 14 | `IEPS` | `ieps` | Opcional | |
| 15 | `SUSTANCIA ACTIVA` | `sustancia_activa` | Opcional | 4% lleno. |
| 16 | `TAMAÑO` | `tamano` | Opcional | |
| 17 | `LARGO` | `largo` | Opcional | |
| 18 | `ANCHO` | `ancho` | Opcional | |
| 19 | `CALIBRE` | `calibre` | Opcional | |
| 20 | `ESPECIFICACION` | `especificacion` | Opcional | |

> **Acción tuya:** confirma o ajusta las 8 obligatorias (+ la bandera nueva).

---

## 2. ROL: Ingeniero Industrial — diseño conceptual de inventario

### 2.1 Conceptos y jerarquía
```
ALMACÉN (sitio físico, ej. "Bodega Refinería")
  └── UBICACIÓN (tarima / anaquel / rack, ej. "TARIMA-01", "ANAQUEL-1-P2")
        └── EXISTENCIA = PRODUCTO × LOTE × UBICACIÓN → cantidad
```
- **Lote:** `numero_lote` + `fecha_caducidad` + `costo_unitario`.
- **Producto con control:** exige lote y caducidad reales en cada entrada.
- **Producto sin control:** se usa lote único **`GENERICO`** (caducidad nula) y ahí va toda su existencia.
- **Existencia:** se lleva por lote y por ubicación. Un mismo lote puede estar en varias ubicaciones (varias filas).

### 2.2 Movimientos (Kardex) — toda variación deja rastro
| Tipo | Efecto | Ejemplo |
|---|---|---|
| **ENTRADA** | + existencia | Recepción de compra, carga inicial |
| **SALIDA** | − existencia | Venta, surtido de pedido, merma, caducado |
| **TRASPASO** | mueve entre ubicaciones/almacenes (total constante) | Reacomodo |
| **AJUSTE** | ± por conteo físico | Inventario físico |

### 2.3 Reglas de negocio del inventario
- **RN-INV-01** Producto con `control_lote_caducidad=1` → obligatorio `numero_lote` y `fecha_caducidad` en cada entrada.
- **RN-INV-02** Producto sin control → lote `GENERICO` autocreado, caducidad nula; toda su existencia ahí.
- **RN-INV-03** Ninguna salida puede dejar existencia negativa.
- **RN-INV-04** Surtido sugiere lote por **FEFO** (caduca primero sale primero); FIFO si no hay caducidad.
- **RN-INV-05** La cantidad **nunca** se edita a mano: siempre vía un movimiento (auditoría).
- **RN-INV-06** Traspaso no altera la cantidad total, solo su ubicación.
- **RN-INV-07** Inventario físico genera un AJUSTE documentado (motivo + usuario).

### 2.4 Indicadores / alertas
- Valor de inventario = Σ(cantidad_actual × costo_unitario).
- Caducidad: semáforo 30 / 60 / 90 días + caducados.
- Stock bajo: cantidad ≤ `stock_minimo`.
- Rotación (Fase posterior).

---

## 3. ROL: Ingeniero Senior de Sistemas — diseño técnico

### 3.1 Cambios al esquema (MariaDB)

**`productos` (ALTER — extender):**
```sql
ALTER TABLE productos
  ADD COLUMN control_lote_caducidad TINYINT(1) NOT NULL DEFAULT 1,  -- bandera nueva
  -- Unidad base de inventario MIXTA POR PRODUCTO (decisión 2026-06-14):
  ADD COLUMN unidad_base    ENUM('pieza','empaque') NOT NULL DEFAULT 'pieza',
  ADD COLUMN factor_empaque DECIMAL(10,2) NOT NULL DEFAULT 1, -- piezas por empaque (CAJA C/100 → 100)
  -- Taxonomía por FK a tablas de apoyo (selects encadenados en el alta):
  ADD COLUMN familia_id      INT UNSIGNED NULL,
  ADD COLUMN categoria_id    INT UNSIGNED NULL,
  ADD COLUMN subcategoria_id INT UNSIGNED NULL,
  ADD COLUMN unidad_medida_id INT UNSIGNED NULL,  -- FK a unidades_medida (además del texto unidad_medida)
  ADD COLUMN precio_lista   DECIMAL(12,2) NULL,
  ADD COLUMN precio_publico DECIMAL(12,2) NULL,
  ADD COLUMN fabricante     VARCHAR(120) NULL,
  ADD COLUMN ean            VARCHAR(20)  NULL,
  ADD COLUMN ieps           DECIMAL(6,4) NULL,
  ADD COLUMN sustancia_activa VARCHAR(200) NULL,
  ADD COLUMN tamano   VARCHAR(60) NULL,
  ADD COLUMN calibre  VARCHAR(60) NULL,
  ADD COLUMN especificacion VARCHAR(300) NULL,
  ADD CONSTRAINT fk_prod_familia      FOREIGN KEY (familia_id)      REFERENCES familias(id),
  ADD CONSTRAINT fk_prod_categoria    FOREIGN KEY (categoria_id)    REFERENCES categorias_prod(id),
  ADD CONSTRAINT fk_prod_subcategoria FOREIGN KEY (subcategoria_id) REFERENCES subcategorias_prod(id),
  ADD CONSTRAINT fk_prod_unidad       FOREIGN KEY (unidad_medida_id) REFERENCES unidades_medida(id);
-- 'categoria' ENUM antiguo: se deja como columna legada o se descarta (sin uso productivo, productos=0 hoy).
-- 'sku_interno' = código INNOVACOM (INxxnnnnn). CONFIRMADO por el usuario como llave.
-- iva_exento ya existe (se llena desde la columna IVA del Excel: 0→exento=1, 0.16→exento=0).
```

**Tablas de apoyo — taxonomía jerárquica (NUEVAS).** Se precargan desde la hoja `CATEGORIAS` (10 familias → 72 categorías → 280 subcategorías; cada nivel cuelga del anterior). En el alta de producto se eligen con **3 selects encadenados** (al elegir familia se filtran sus categorías; al elegir categoría, sus subcategorías):
```sql
CREATE TABLE familias (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL UNIQUE,
  activo TINYINT(1) NOT NULL DEFAULT 1
);
CREATE TABLE categorias_prod (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  familia_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_fam_cat (familia_id, nombre),
  FOREIGN KEY (familia_id) REFERENCES familias(id) ON UPDATE CASCADE
);
CREATE TABLE subcategorias_prod (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  categoria_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_cat_sub (categoria_id, nombre),
  FOREIGN KEY (categoria_id) REFERENCES categorias_prod(id) ON UPDATE CASCADE
);
```

**Tabla de apoyo — unidades de medida (NUEVA).** Se precarga con los valores distintos de `UNIDAD_VENTA` (PIEZA, CAJA C/100, …). Usada como select en el alta y para deducir `factor_empaque`:
```sql
CREATE TABLE unidades_medida (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(40) NOT NULL UNIQUE,   -- "PIEZA", "CAJA C/100"
  factor_sugerido DECIMAL(10,2) NULL,   -- piezas deducidas del nombre (CAJA C/100→100)
  activo TINYINT(1) NOT NULL DEFAULT 1
);
```

**`almacenes` (NUEVA):**
```sql
CREATE TABLE almacenes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  direccion VARCHAR(300) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**`ubicaciones` (NUEVA):**
```sql
CREATE TABLE ubicaciones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  almacen_id INT UNSIGNED NOT NULL,
  codigo VARCHAR(40) NOT NULL,         -- "TARIMA-01", "ANAQUEL-1-P2"
  descripcion VARCHAR(150) NULL,
  tipo ENUM('zona','rack','tarima','anaquel','piso','otro') NOT NULL DEFAULT 'otro',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_almacen_codigo (almacen_id, codigo),
  FOREIGN KEY (almacen_id) REFERENCES almacenes(id) ON UPDATE CASCADE
);
```

**`inventario_lotes` (ALTER — se reutiliza la tabla existente, hoy vacía):**
```sql
ALTER TABLE inventario_lotes
  ADD COLUMN almacen_id   INT UNSIGNED NULL AFTER producto_id,
  ADD COLUMN ubicacion_id INT UNSIGNED NULL AFTER almacen_id,
  ADD COLUMN es_generico  TINYINT(1) NOT NULL DEFAULT 0,
  ADD CONSTRAINT fk_lote_almacen   FOREIGN KEY (almacen_id)   REFERENCES almacenes(id),
  ADD CONSTRAINT fk_lote_ubicacion FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id),
  ADD UNIQUE KEY uq_lote (producto_id, numero_lote, ubicacion_id);
-- Grano: producto × lote × ubicación = 1 fila con cantidad_actual.
```

**`inventario_movimientos` (NUEVA — Kardex):**
```sql
CREATE TABLE inventario_movimientos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  folio VARCHAR(20) NOT NULL,                       -- ENT/SAL/TRA/AJU-2026-0001
  tipo ENUM('entrada','salida','traspaso','ajuste') NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  lote_id INT UNSIGNED NULL,                         -- existencia afectada
  ubicacion_origen_id  INT UNSIGNED NULL,
  ubicacion_destino_id INT UNSIGNED NULL,            -- solo traspaso
  cantidad DECIMAL(10,2) NOT NULL,                   -- + entrada, − salida
  costo_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
  motivo VARCHAR(200) NULL,
  referencia VARCHAR(60) NULL,                       -- folio pedido/solicitud
  usuario_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mov_producto (producto_id),
  KEY idx_mov_tipo_fecha (tipo, created_at),
  FOREIGN KEY (producto_id) REFERENCES productos(id),
  FOREIGN KEY (lote_id) REFERENCES inventario_lotes(id)
);
```

**Vistas:**
- `v_existencias` — producto + sku + lote + caducidad + almacén + ubicación + cantidad + valor + semáforo de caducidad.
- `v_stock_producto` — Σ por producto (todas las ubicaciones/lotes), min caducidad, alertas.
- Se actualiza `v_inventario` existente.

**Folios:** se reusa `sp_generar_folio` con series `ENT`/`SAL`/`TRA`/`AJU`.

### 3.2 Backend — nuevo módulo `inventario`
```
modules/inventario/
  almacenes.controller.js   GET/POST/PUT  /api/almacenes  + /:id/ubicaciones
  inventario.controller.js  existencias, alertas, kardex
  movimientos.service.js    lógica transaccional (entrada/salida/traspaso/ajuste)
  import.catalogo.js        parser xlsx del CATALOGO  → preview + confirm
  import.existencias.js     parser xlsx Refinería     → preview + confirm
```
**Endpoints:**
```
GET  /api/almacenes                 POST /api/almacenes        PUT /api/almacenes/:id
GET  /api/almacenes/:id/ubicaciones POST .../ubicaciones       PUT .../ubicaciones/:uid
GET  /api/inventario/existencias    (filtros: producto, almacén, caducidad)
GET  /api/inventario/alertas        (caducidad + stock bajo)
GET  /api/inventario/movimientos    (kardex con filtros)
POST /api/inventario/entradas       (recepción de lote)
POST /api/inventario/salidas        (sugiere lote FEFO; valida no-negativo)
POST /api/inventario/traspasos
POST /api/inventario/ajustes        (inventario físico; rol admin)
POST /api/productos/import-catalogo (xlsx → tabla editable de validación)
POST /api/inventario/import-existencias (xlsx Refinería → preview → confirma)
```
> Lógica de stock en **servicio transaccional de app** (con `SELECT ... FOR UPDATE` para evitar carreras), no en stored procedures — coherente con el resto del código.

### 3.3 Frontend — nuevo ítem de menú "Inventario"
- **Sidebar:** nuevo ítem `Inventario` (ícono Boxes/Warehouse).
- **Páginas:**
  - `Inventario/Catalogo` — lista + edición + importar xlsx + toggle `control_lote_caducidad`.
  - `Inventario/Almacenes` — CRUD almacenes y sus ubicaciones.
  - `Inventario/Existencias` — stock por producto/lote/ubicación, filtros, semáforo de caducidad.
  - `Inventario/Movimientos` — formularios de entrada/salida/traspaso/ajuste + kardex.
  - Widgets en Dashboard: valor de inventario, próximos a caducar, stock bajo.

### 3.4 Estrategia de carga (importadores)
1. **Catálogo (1,597):** preview en tabla editable → confirma → inserta en `productos`. Mapea `IVA→iva_exento`, fija `control_lote_caducidad=1` por defecto. Resuelve duplicados.
2. **Existencias Refinería:** crea almacén "Bodega Refinería", ubicaciones desde `TARIMA`, lotes (genérico si `LOTE=0`) y un movimiento de **ENTRADA** por cada fila. Cruza `SKU` con catálogo.
- Ambos siguen el principio "IA/Sistema asiste, usuario valida en tabla editable".

---

## 4. ROL: Control de Calidad de Sistemas — revisión de la propuesta

| # | Riesgo / hueco detectado | Recomendación |
|---|---|---|
| QA-1 | **2 Id duplicados** (`INAP00236`, `PACI00102`) chocan con `UNIQUE sku_interno`. | Resolver en preview: conservar uno, renombrar o fusionar. Decisión tuya. |
| QA-2 | **EAN poco confiable** (mayoría 0). | Nunca usarlo como clave; permitir nulo/duplicado. |
| QA-3 | **`categoria` es ENUM(7)** y el catálogo trae 53. | Ampliar a VARCHAR(60) (incluido en el ALTER). |
| QA-4 | **Doble eje de SKU**: el sistema autogenera `DM-#####`; el catálogo usa `INxxnnnnn`. | ✅ **RESUELTO (2026-06-14): el código INNOVACOM `INxxnnnnn` ES el `sku_interno`** (confirmado por el usuario). `sp_generar_sku` (DM-) queda solo para altas manuales sin código IN. |
| QA-5 | **Lote genérico con caducidad nula.** | Alertas de caducidad deben ignorar nulos; FEFO trata nulo como "sin caducidad" (va al final). |
| QA-6 | **Concurrencia en salidas** (dos salidas simultáneas → stock negativo). | Transacción + `SELECT ... FOR UPDATE` sobre la existencia. |
| QA-7 | **Inmutabilidad del kardex.** | Prohibir editar cantidad directa; todo cambio = movimiento. Correcciones vía AJUSTE. |
| QA-8 | **Fechas de caducidad improbables** (ej. `1930-01-01` en el archivo). | Validar y marcar en el preview antes de confirmar. |
| QA-9 | **Unidad de stock ambigua**: `UNIDAD_VENTA="CAJA C/100"` vs conteo en piezas/cajas. | ✅ **RESUELTO (2026-06-14): MIXTO POR PRODUCTO.** Cada producto define `unidad_base` (pieza/empaque) y `factor_empaque` (piezas por empaque). El stock, lotes y movimientos se llevan en la unidad base del producto. El importador intentará deducir `factor_empaque` de la `UNIDAD_VENTA` (ej. "CAJA C/100"→100) para validación en el preview. |
| QA-10 | **Permisos**: ajustes e inventario físico son sensibles. | Restringir AJUSTE a rol admin; registrar `usuario_id` en todo movimiento. |
| QA-11 | **Integración con pedidos/cotizaciones** (¿descontar/reservar stock al aprobar?). | Fuera de alcance de esta entrega; dejar enganche para fase siguiente (concepto `reservado`). |
| QA-12 | **Migración productiva**: tablas hoy vacías ⇒ bajo riesgo, pero el ALTER de `categoria` ENUM→VARCHAR debe probarse. | Migración idempotente `migrate_v5.js` + respaldo previo. |

**Veredicto QA:** diseño viable y alineado con la arquitectura existente. **Bloqueantes a resolver antes de codificar:** QA-1 (duplicados), QA-4 (eje SKU) y QA-9 (unidad base de inventario).

---

## 5. Decisiones (estado)

**Tomadas (2026-06-14):**
- ✅ **Unidad base: MIXTA POR PRODUCTO** (`unidad_base` + `factor_empaque`).
- ✅ **Duplicados de Id: se marcan en el preview** para que el usuario decida.
- ✅ **Alcance: CATÁLOGO PRIMERO**, almacenes/existencias en una 2ª entrega.

- ✅ **SKU = código INNOVACOM** (`INxxnnnnn`).
- ✅ **Obligatorias finales:** Id, DESCRIPCION, UNIDAD_VENTA, FAMILIA, CATEGORIA, **SUBCATEGORIA**, IVA, **PRECIO_LISTA**, codigo_sat, unidad_sat + `control_lote_caducidad`.
- ✅ **Taxonomía** (familia/categoría/subcategoría) en **tablas de apoyo** precargadas desde la hoja `CATEGORIAS`, seleccionables con selects encadenados en el alta.

---

## 7. PANTALLAS Y TABLAS PROPUESTAS (consolidado para tu revisión)

### 7.1 Tablas de base de datos

| Tabla | Tipo | Rol |
|---|---|---|
| `productos` | **se extiende** | Catálogo. SKU = código IN. + bandera control, unidad base/factor, FKs de taxonomía, precios, atributos. |
| `familias` | **nueva (apoyo)** | 10 familias. Precarga desde hoja CATEGORIAS. |
| `categorias_prod` | **nueva (apoyo)** | 72 categorías, cuelgan de familia. |
| `subcategorias_prod` | **nueva (apoyo)** | 280 subcategorías, cuelgan de categoría. |
| `unidades_medida` | **nueva (apoyo)** | Unidades de venta (PIEZA, CAJA C/100…) + factor sugerido. |
| `almacenes` | **nueva** | Sitios físicos (ej. Bodega Refinería). |
| `ubicaciones` | **nueva** | Tarimas/anaqueles dentro de un almacén. |
| `inventario_lotes` | **se extiende** | Existencia por producto × lote × ubicación (cantidad, caducidad, costo, genérico). |
| `inventario_movimientos` | **nueva** | Kardex: entrada/salida/traspaso/ajuste con folio y usuario. |

Vistas: `v_existencias`, `v_stock_producto`, actualizar `v_inventario`.

### 7.2 Pantallas (frontend) — nuevo menú **Inventario**

| Pantalla | Entrega | Qué hace |
|---|---|---|
| **Catálogo de productos** | 1 | Lista, búsqueda/filtros por familia-categoría, alta/edición con **3 selects encadenados** (familia→categoría→subcategoría) + unidad + bandera `control_lote_caducidad` + unidad base/factor. **Importador xlsx** con preview (resalta duplicados, deduce factor de empaque). |
| **Catálogos de apoyo** | 1 | Mantenimiento de `familias`, `categorias_prod`, `subcategorias_prod` y `unidades_medida` (agregar/editar/desactivar). |
| **Almacenes y ubicaciones** | 2 | CRUD de almacenes y sus ubicaciones (tarima/anaquel…). |
| **Existencias** | 2 | Stock por producto/lote/ubicación, filtros, **semáforo de caducidad** (30/60/90 días) y stock bajo. Valor de inventario. |
| **Movimientos / Kardex** | 2 | Formularios de Entrada, Salida (sugiere lote FEFO), Traspaso y Ajuste; consulta del kardex con filtros. |
| **Importar existencias** | 2 | Carga del archivo de Refinería → crea almacén/ubicaciones/lotes + movimientos de entrada (preview editable). |
| **Widgets Dashboard** | 2 | Valor de inventario, próximos a caducar, stock bajo. |

> Menú principal: se agrega el ítem **Inventario** con subnavegación a estas pantallas.

---

## 8. Plan de implementación (Entrega 1 — Catálogo) — tras aprobación
1. `migrate_v5.js`: crear tablas de apoyo (`familias`, `categorias_prod`, `subcategorias_prod`, `unidades_medida`) + ALTER `productos` (bandera control, unidad base/factor, FKs de taxonomía, precios, atributos).
2. Precargar taxonomía desde la hoja `CATEGORIAS` (10/72/280) y unidades desde `UNIDAD_VENTA`.
3. Backend: extender módulo `productos` (campos + endpoints de catálogos de apoyo) + `import.catalogo.js` (parser xlsx + preview).
4. Frontend: ítem de menú **Inventario** → página **Catálogo** (lista, alta/edición con 3 selects encadenados, toggle control, unidad base/factor) + página **Catálogos de apoyo** + importador con preview (resalta duplicados, deduce `factor_empaque`).
5. Carga validada de los 1,597 productos.
6. *(Entrega 2)* almacenes, ubicaciones, lotes, movimientos e importación de existencias de Refinería.
