const XLSX = require('xlsx');

/**
 * Parser para el Excel de cotización de INNOVACOM.
 *
 * Estructura fija del archivo:
 *   Fila 1: etiquetas encabezado (CLIENTE, COC, ELABORO, AUTORIZO...)
 *   Fila 2: valores (nombre cliente, elaborador, autorizador)
 *   Fila 3: COC en col B
 *   Fila 4: FACTOR GANANCIA en col E/F + nombres de proveedores desde col Q
 *   Fila 5: encabezados reales de la tabla de partidas
 *   Fila 6+: datos de partidas
 *
 * Reglas de negocio:
 *   RN-001: El número de partida (col A) se respeta tal cual, sin auto-generar.
 *   RN-002: Si todos los precios de proveedores son 0 o vacíos, observaciones = "NO COTIZO".
 */
function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);

  const get = (r, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    return cell ? cell.v : null;
  };
  const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const num = (v) => { const n = parseFloat(str(v)); return isNaN(n) ? 0 : n; };

  // ── 1. Metadatos (filas 1-4, índices 0-3) ────────────────────────────────
  const meta = {
    cliente_nombre:  str(get(1, 1)),   // F2-B
    coc:             str(get(2, 1)),   // F3-B (número de pedido del cliente)
    atencion:        str(get(1, 2)) || str(get(2, 2)),  // F2-C / F3-C (DIRIGIR A)
    concepto:        str(get(1, 6)) || str(get(2, 6)),  // F2-G / F3-G (DESCRIPCION)
    elaboro_nombre:  str(get(1, 4)),   // F2-E (solo referencia; en el sistema viene de BD)
    autorizo_nombre: str(get(1, 5)),   // F2-F (solo referencia; en el sistema viene de BD)
    factor_ganancia: num(get(3, 5)),   // F4-F (ej: 0.15 = 15%)
  };

  // ── 2. Proveedores desde fila 4 (índice 3), columna Q (16) en adelante ──
  const proveedores = [];
  for (let c = 16; c <= range.e.c - 1; c += 2) {
    const nombre = str(get(3, c));
    if (nombre) {
      proveedores.push({ nombre, col_precio: c, col_comentario: c + 1 });
    }
  }

  // ── 3. Encabezados reales en fila 5 (índice 4) ───────────────────────────
  const colMap = {};
  for (let c = 0; c <= range.e.c; c++) {
    const val = str(get(4, c));
    if (val) colMap[normalizar(val)] = c;
  }

  // Índices de columnas con fallback a posiciones conocidas del formato fijo
  const COL_PARTIDA  = colMap['partida']             ?? 0;
  const COL_CODIGO   = colMap['codigo']              ?? 1;
  const COL_COD_GOB  = colMap['codigogobierno']      ?? 2;
  const COL_CANT     = colMap['cantidad']             ?? 3;
  const COL_UM       = colMap['unidad']               ?? 4;
  const COL_DESC     = colMap['descripcion']          ?? 5;
  const COL_PROV_MEJ = colMap['proveedor']            ?? 9;
  const COL_OBS      = colMap['observacioninnovacom'] ?? 14;
  // Columna "IVA" = col M (índice 12) en el formato fijo; con fallback por nombre
  // de encabezado por si el archivo trae variantes ("monto de iva", "importe iva").
  const COL_IVA      = colMap['iva'] ?? colMap['montodeiva']
                     ?? colMap['montoiva'] ?? colMap['importeiva'] ?? 12;

  // ── 4. Partidas desde fila 6 (índice 5) ──────────────────────────────────
  const partidas = [];

  for (let r = 5; r <= range.e.r; r++) {
    const desc = str(get(r, COL_DESC));
    if (!desc) continue;

    const partidaRaw = get(r, COL_PARTIDA);
    const lineaNum   = parseFloat(str(partidaRaw));

    // Saltar filas cuya col A no sea numérica (notas, subtotales, encabezados extra)
    if (isNaN(lineaNum)) continue;

    // ── Precios de proveedores ───────────────────────────────────────────────
    const precios_proveedores = {};
    let algunPrecio = false;

    for (const prov of proveedores) {
      const precio     = num(get(r, prov.col_precio));
      const comentario = str(get(r, prov.col_comentario));
      if (precio > 0 || comentario) {
        precios_proveedores[prov.nombre] = { precio, comentario };
        if (precio > 0) algunPrecio = true;
      }
    }

    // RN-002: si ningún proveedor cotizó precio, marcar "NO COTIZO"
    const obsOriginal = str(get(r, COL_OBS));
    const observaciones = !algunPrecio && !obsOriginal ? 'NO COTIZO' : obsOriginal;

    // Si la columna IVA (col M) trae 0 explícito, la partida no causa IVA:
    // se marca iva_exento para que no se calcule el 16% después. Celda vacía
    // no se interpreta como exenta (queda editable/manual en la tabla).
    const ivaCelda = str(get(r, COL_IVA));
    const iva_exento = ivaCelda !== '' ? (num(get(r, COL_IVA)) === 0 ? 1 : 0) : undefined;

    partidas.push({
      linea:                lineaNum,                          // RN-001: número original
      codigo_cliente:       str(get(r, COL_CODIGO)),
      codigo_gobierno:      str(get(r, COL_COD_GOB)),
      descripcion_original: desc,
      cantidad:             parseCantidad(get(r, COL_CANT)),
      unidad_medida:        str(get(r, COL_UM)) || 'pza',
      proveedor_sugerido:   str(get(r, COL_PROV_MEJ)),
      observaciones,
      ...(iva_exento !== undefined ? { iva_exento } : {}),
      precios_proveedores,  // para pre-cargar el comparador en el futuro
    });
  }

  if (!partidas.length) throw new Error('No se encontraron partidas con descripción');

  return { meta, proveedores, partidas };
}

function normalizar(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseCantidad(val) {
  const n = parseFloat(String(val ?? '').replace(/[^\d.]/g, ''));
  return isNaN(n) || n <= 0 ? 1 : n;
}

module.exports = { parseExcel };
