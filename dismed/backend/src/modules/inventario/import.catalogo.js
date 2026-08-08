const XLSX = require('xlsx');

/**
 * Parser del CATALOGO MAESTRO (hoja "CATALOGO").
 * Mapea columnas por NOMBRE de encabezado (robusto al orden) y normaliza cada fila
 * a la forma que usa el catálogo de productos del sistema.
 *
 * Encabezados esperados (fila 1):
 *   EAN, Id, DESCRIPCION, FAMILIA, CATEGORIA, SUBCATEGORIA, UNIDAD_VENTA,
 *   PRECIO_PUBLICO, PRECIO_LISTA, PRECIO_COSTO, IVA, IEPS, codigo_sat, unidad_sat,
 *   SUSTANCIA ACTIVA, TAMAÑO, LARGO, ANCHO, CALIBRE, ESPECIFICACION, LABORATORIO
 *
 * PRECIO_COSTO es opcional (columna nueva); si no viene en el archivo, precio_costo
 * queda NULL y el margen no se calcula hasta que se capture manualmente.
 */

const norm = (s) => (s == null ? '' : String(s).trim());
const up   = (s) => norm(s).toUpperCase().replace(/\s+/g, ' ');
// Convierte a número o null (evita NaN, que mysql2 serializa como literal inválido)
const numOrNull = (v) => {
  if (v == null || norm(v) === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

// Deduce piezas por empaque desde la unidad de venta ("CAJA C/100" → 100)
function deducirFactor(unidad) {
  const u = norm(unidad);
  const m = u.match(/C\s*\/\s*(\d+)/i) || u.match(/\b(\d+)\s*(PARES|PIEZAS|PZAS|UDS)\b/i);
  if (m) return Number(m[1]);
  if (/^(PIEZA|PZA|UNIDAD|UDS?)$/i.test(u)) return 1;
  return null;
}

function parseCatalogo(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  // Hoja "CATALOGO" si existe, si no la primera
  const sheetName = wb.SheetNames.find((n) => up(n) === 'CATALOGO') || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (!rows.length) return { columnas: [], productos: [], resumen: { total: 0 } };

  // Mapa de encabezado → índice de columna
  const headers = rows[0].map((h) => up(h));
  const col = (name) => headers.indexOf(up(name));
  const idx = {
    ean:           col('EAN'),
    sku:           col('Id'),
    descripcion:   col('DESCRIPCION'),
    familia:       col('FAMILIA'),
    categoria:     col('CATEGORIA'),
    subcategoria:  col('SUBCATEGORIA'),
    unidad:        col('UNIDAD_VENTA'),
    precio_publico:col('PRECIO_PUBLICO'),
    precio_lista:  col('PRECIO_LISTA'),
    precio_costo:  col('PRECIO_COSTO'),
    iva:           col('IVA'),
    ieps:          col('IEPS'),
    codigo_sat:    col('codigo_sat'),
    unidad_sat:    col('unidad_sat'),
    sustancia:     col('SUSTANCIA ACTIVA'),
    tamano:        col('TAMAÑO') >= 0 ? col('TAMAÑO') : col('TAMANO'),
    largo:         col('LARGO'),
    ancho:         col('ANCHO'),
    calibre:       col('CALIBRE'),
    especificacion:col('ESPECIFICACION'),
    laboratorio:   col('LABORATORIO'),
  };

  // Qué columnas trae el archivo (para el modo de actualización parcial: solo se
  // tocan en BD los campos cuya columna vino en el archivo; el resto se conserva).
  const columnasPresentes = {
    descripcion:      idx.descripcion >= 0,
    familia:           idx.familia >= 0,
    categoria:         idx.categoria >= 0,
    subcategoria:      idx.subcategoria >= 0,
    unidad_medida:     idx.unidad >= 0,
    precio_lista:      idx.precio_lista >= 0,
    precio_publico:    idx.precio_publico >= 0,
    precio_costo:      idx.precio_costo >= 0,
    iva_exento:        idx.iva >= 0,
    ieps:              idx.ieps >= 0,
    clave_sat:         idx.codigo_sat >= 0,
    clave_unidad_sat:  idx.unidad_sat >= 0,
    sustancia_activa:  idx.sustancia >= 0,
    tamano:            idx.tamano >= 0,
    calibre:           idx.calibre >= 0,
    especificacion:    idx.especificacion >= 0,
    fabricante:        idx.laboratorio >= 0,
    ean:               idx.ean >= 0,
  };

  const val = (r, i) => (i >= 0 ? r[i] : null);
  const productos = [];
  const skuCount = {};

  rows.slice(1).forEach((r) => {
    if (!r || !r.some((c) => c != null && norm(c) !== '')) return; // fila vacía
    const sku = norm(val(r, idx.sku));
    const descripcion = norm(val(r, idx.descripcion));
    if (!sku && !descripcion) return;
    skuCount[sku] = (skuCount[sku] || 0) + 1;

    const eanRaw = val(r, idx.ean);
    const ean = (eanRaw == null || Number(eanRaw) === 0) ? null : norm(eanRaw);
    const unidad = norm(val(r, idx.unidad));
    const ivaNum = parseFloat(val(r, idx.iva));

    productos.push({
      sku_interno:    sku,
      descripcion,
      ean,
      familia:        norm(val(r, idx.familia)) || null,
      categoria:      norm(val(r, idx.categoria)) || null,
      subcategoria:   norm(val(r, idx.subcategoria)) || null,
      unidad_medida:  unidad || null,
      factor_empaque: deducirFactor(unidad),
      unidad_base:    'pieza',
      precio_lista:   numOrNull(val(r, idx.precio_lista)),
      precio_publico: numOrNull(val(r, idx.precio_publico)),
      precio_costo:   numOrNull(val(r, idx.precio_costo)),
      iva_exento:     ivaNum > 0 ? 0 : 1,                  // IVA 0.16 → no exento; 0 → exento
      _ivaCeldaProvista: val(r, idx.iva) != null && norm(val(r, idx.iva)) !== '',
      ieps:           numOrNull(val(r, idx.ieps)),
      clave_sat:      norm(val(r, idx.codigo_sat)) || null,
      clave_unidad_sat: norm(val(r, idx.unidad_sat)) || null,
      sustancia_activa: norm(val(r, idx.sustancia)) || null,
      tamano:         norm(val(r, idx.tamano)) || null,
      calibre:        norm(val(r, idx.calibre)) || null,
      especificacion: norm(val(r, idx.especificacion)) || null,
      fabricante:     norm(val(r, idx.laboratorio)) || null,
      control_lote_caducidad: 1,                           // default: SÍ controla
    });
  });

  // Duplicados dentro del mismo archivo (esto sí es independiente del modo de
  // importación). La validación de campos obligatorios se hace en el controlador,
  // porque depende de si el producto ya existe en BD y del modo (completo/parcial).
  productos.forEach((p) => {
    p._duplicado = !!(p.sku_interno && skuCount[p.sku_interno] > 1);
  });

  const resumen = {
    total: productos.length,
    duplicados: productos.filter((p) => p._duplicado).length,
    skus_duplicados: [...new Set(productos.filter((p) => p._duplicado).map((p) => p.sku_interno))],
    hoja: sheetName,
  };

  return { columnas: rows[0], columnasPresentes, productos, resumen };
}

module.exports = { parseCatalogo, deducirFactor, norm, up, numOrNull };
