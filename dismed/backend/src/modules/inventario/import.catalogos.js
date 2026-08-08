const XLSX = require('xlsx');
const { norm, up, numOrNull } = require('./import.catalogo');

/**
 * Parser del Excel de catálogos de apoyo (familias/categorías/subcategorías + unidades).
 *   · Hoja de taxonomía: columnas FAMILIA, CATEGORIA, SUBCATEGORIA. Las tres que
 *     vengan en el mismo renglón se toman como relacionadas entre sí.
 *   · Hoja de unidades: columnas UNIDAD, FACTOR — separada de la taxonomía.
 * Se detectan por encabezado, sin importar el nombre ni el orden de las hojas.
 */

function hojaConColumna(wb, columna) {
  for (const n of wb.SheetNames) {
    const hdr = (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null })[0] || []).map(up);
    if (hdr.includes(up(columna))) return n;
  }
  return null;
}

function parseCatalogosApoyo(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false });

  // ── Taxonomía: familia / categoría / subcategoría ──────────────────────────
  const hojaTax = hojaConColumna(wb, 'FAMILIA');
  const taxonomia = [];
  if (hojaTax) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[hojaTax], { header: 1, defval: null, raw: true });
    const headers = (rows[0] || []).map(up);
    const col = (n) => headers.indexOf(up(n));
    const idx = { familia: col('FAMILIA'), categoria: col('CATEGORIA'), subcategoria: col('SUBCATEGORIA') };
    const v = (r, i) => (i >= 0 ? r[i] : null);
    rows.slice(1).forEach((r) => {
      if (!r || !r.some((c) => c != null && norm(c) !== '')) return;
      const familia = norm(v(r, idx.familia));
      if (!familia) return;
      const categoria = norm(v(r, idx.categoria)) || null;
      const subcategoria = norm(v(r, idx.subcategoria)) || null;
      const ok = !(subcategoria && !categoria);
      taxonomia.push({
        familia, categoria, subcategoria,
        _ok: ok,
        _error: ok ? null : 'Subcategoría sin categoría',
      });
    });
  }

  // ── Unidades de medida (formato separado: solo unidad + factor) ────────────
  const hojaUni = hojaConColumna(wb, 'UNIDAD');
  const unidades = [];
  if (hojaUni) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[hojaUni], { header: 1, defval: null, raw: true });
    const headers = (rows[0] || []).map(up);
    const col = (n) => headers.indexOf(up(n));
    const idx = { unidad: col('UNIDAD'), factor: col('FACTOR') };
    const v = (r, i) => (i >= 0 ? r[i] : null);
    rows.slice(1).forEach((r) => {
      if (!r || !r.some((c) => c != null && norm(c) !== '')) return;
      const unidad = norm(v(r, idx.unidad));
      if (!unidad) return;
      unidades.push({ unidad, factor: numOrNull(v(r, idx.factor)) });
    });
  }

  const familiasSet = new Set(taxonomia.map((t) => t.familia));
  const categoriasSet = new Set(taxonomia.filter((t) => t.categoria).map((t) => `${t.familia}|${t.categoria}`));
  const subcategoriasSet = new Set(taxonomia.filter((t) => t.categoria && t.subcategoria).map((t) => `${t.familia}|${t.categoria}|${t.subcategoria}`));

  const resumen = {
    total_taxonomia: taxonomia.length,
    con_error: taxonomia.filter((t) => !t._ok).length,
    familias: familiasSet.size,
    categorias: categoriasSet.size,
    subcategorias: subcategoriasSet.size,
    total_unidades: unidades.length,
    hoja_taxonomia: hojaTax,
    hoja_unidades: hojaUni,
  };

  return { taxonomia, unidades, resumen };
}

module.exports = { parseCatalogosApoyo };
