const XLSX = require('xlsx');

/**
 * Parser del archivo de existencias (INVENTARIO REFINERIA BODEGA).
 * Mapea por nombre de encabezado. Columnas relevantes:
 *   SKU, DESCRIPCION, PRECIO, LOTE (0 = genérico), CADUCIDAD, INVENTARIO (cantidad), TARIMA (ubicación)
 */
const norm = (s) => (s == null ? '' : String(s).trim());
const up   = (s) => norm(s).toUpperCase().replace(/\s+/g, ' ');
const numOrNull = (v) => { if (v == null || norm(v) === '') return null; const n = parseFloat(v); return isNaN(n) ? null : n; };

function fechaISO(v) {
  if (v == null || norm(v) === '') return null;
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 2000 || y > 2100) return null; // descarta fechas improbables (ej. 1930)
  return d.toISOString().slice(0, 10);
}

function parseExistencias(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  // Primera hoja que tenga columna SKU e INVENTARIO
  let sheetName = wb.SheetNames[0];
  for (const n of wb.SheetNames) {
    const hdr = (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null })[0] || []).map(up);
    if (hdr.includes('SKU') && hdr.includes('INVENTARIO')) { sheetName = n; break; }
  }
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (!rows.length) return { renglones: [], resumen: { total: 0 }, hoja: sheetName };

  const headers = rows[0].map(up);
  const col = (n) => headers.indexOf(up(n));
  const idx = {
    sku: col('SKU'), descripcion: col('DESCRIPCION'), precio: col('PRECIO'),
    lote: col('LOTE'), caducidad: col('CADUCIDAD'), inventario: col('INVENTARIO'),
    tarima: col('TARIMA'),
  };
  const v = (r, i) => (i >= 0 ? r[i] : null);

  const renglones = [];
  rows.slice(1).forEach((r) => {
    if (!r || !r.some((c) => c != null && norm(c) !== '')) return;
    const sku = norm(v(r, idx.sku));
    if (!sku) return;
    const loteRaw = norm(v(r, idx.lote));
    const esGenerico = !loteRaw || loteRaw === '0';
    renglones.push({
      sku_interno: sku,
      descripcion: norm(v(r, idx.descripcion)),
      cantidad: numOrNull(v(r, idx.inventario)) ?? 0,
      costo_unitario: numOrNull(v(r, idx.precio)) ?? 0,
      numero_lote: esGenerico ? null : loteRaw,
      es_generico_archivo: esGenerico,
      fecha_caducidad: fechaISO(v(r, idx.caducidad)),
      ubicacion: norm(v(r, idx.tarima)) || 'SIN UBICACION',
    });
  });

  const resumen = {
    total: renglones.length,
    con_existencia: renglones.filter((x) => x.cantidad > 0).length,
    genericos: renglones.filter((x) => x.es_generico_archivo).length,
    ubicaciones: [...new Set(renglones.map((x) => x.ubicacion))],
    hoja: sheetName,
  };
  return { renglones, resumen };
}

module.exports = { parseExistencias };
