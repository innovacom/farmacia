/**
 * inventario.periodo.js — Método de costeo del ejercicio + inventario final por periodo.
 *
 * Tres métodos (contabilidad_ejercicio.metodo_inventario, ver migrate_v68):
 *   - perpetuo  → el motor de pólizas suma las salidas del kardex (comportamiento actual).
 *   - periodico → Costo de ventas = Inventario inicial + Compras − Inventario final.
 *                 Como las compras G01 ya se cargan a 115.01, el saldo de 115 antes de
 *                 ajustar YA es (II + Compras); basta bajarlo al inventario final.
 *   - compras   → Costo = Compras netas del periodo (caso IF ≡ II del método periódico).
 *
 * El "inventario final" se autollena desde el kardex reconstruyendo hacia atrás desde el
 * valor actual (inventario_movimientos no tiene fecha de negocio ni almacén; solo created_at),
 * y es editable a mano — en el mes 13 (cierre) se espera el conteo físico capturado.
 */
const { pool } = require('../../config/db');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const METODOS = ['perpetuo', 'periodico', 'compras'];

// Prefijo de la cuenta de inventario (mercancía). El motor usa 115.01 y aplicarNivelDetalle
// lo baja a 115.01.00 — ambos casos caen bajo este prefijo.
const PREFIJO_INV = '115.01';
const condInv = "(m.cuenta_codigo = '115.01' OR m.cuenta_codigo LIKE '115.01.%')";

// Fin del periodo como timestamp, para el back-out del kardex. Meses 1..12 → último día
// del mes; mes 13 (cierre) → 31 de diciembre del ejercicio.
function finDePeriodo(anio, mes) {
  const a = Number(anio), m = Number(mes);
  if (m === 13) return `${a}-12-31 23:59:59`;
  const ultimo = new Date(a, m, 0).getDate();
  return `${a}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')} 23:59:59`;
}

async function metodoEjercicio(anio) {
  try {
    const [[row]] = await pool.query(
      'SELECT metodo_inventario FROM contabilidad_ejercicio WHERE anio = ?', [Number(anio)]);
    return (row && METODOS.includes(row.metodo_inventario)) ? row.metodo_inventario : 'perpetuo';
  } catch {
    return 'perpetuo'; // tabla aún no migrada
  }
}

async function guardarMetodo(anio, metodo, usuarioId = null) {
  const a = parseInt(anio, 10);
  if (!a) { const e = new Error('anio es obligatorio'); e.status = 400; throw e; }
  if (!METODOS.includes(metodo)) {
    const e = new Error(`metodo inválido (usa: ${METODOS.join(', ')})`); e.status = 400; throw e;
  }
  await pool.query(
    `INSERT INTO contabilidad_ejercicio (anio, metodo_inventario, usuario_id)
     VALUES (?,?,?) ON DUPLICATE KEY UPDATE metodo_inventario = VALUES(metodo_inventario),
       usuario_id = VALUES(usuario_id)`,
    [a, metodo, usuarioId]);
  return { anio: a, metodo_inventario: metodo };
}

// Valor del inventario valuado al corte, reconstruido hacia atrás desde el saldo actual
// del kardex: valor_hoy − Σ(cantidad × costo_unitario) de movimientos posteriores al corte,
// excluyendo traspasos (registrarTraspaso escribe un renglón positivo que no netea a cero).
// registrarSalida guarda `cantidad` en negativo, así que la resta directa es correcta.
async function valorKardexAlCorte(anio, mes) {
  const hasta = finDePeriodo(anio, mes);
  try {
    const [[row]] = await pool.query(
      `SELECT
         (SELECT COALESCE(SUM(cantidad_actual * costo_unitario),0) FROM inventario_lotes)
       - (SELECT COALESCE(SUM(cantidad * costo_unitario),0) FROM inventario_movimientos
            WHERE tipo <> 'traspaso' AND created_at > ?) AS valor`,
      [hasta]);
    // Una valuación no puede ser negativa: si la reconstrucción hacia atrás da < 0
    // (movimientos sin costo, o carga inicial que no generó movimientos) se usa 0
    // como piso — es solo una sugerencia editable, marcada como tal.
    return Math.max(0, r2(row && row.valor));
  } catch {
    return 0;
  }
}

// Saldo de 115.01* ANTES del periodo. La apertura se guarda con el periodo_mes de su
// fecha de corte (apertura.controller.js) — puede caer en cualquier mes del ejercicio —,
// así que siempre se trata como previa por su `origen`, nunca por el mes.
async function saldoInventarioPrevio(anio, mesDesde) {
  const a = Number(anio), m = Number(mesDesde);
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(m.cargo - m.abono),0) AS saldo
       FROM polizas_movimientos m JOIN polizas p ON p.id = m.poliza_id
      WHERE ${condInv}
        AND ( p.periodo_anio < ?
           OR (p.periodo_anio = ? AND p.origen = 'apertura')
           OR (p.periodo_anio = ? AND p.origen <> 'apertura' AND p.periodo_mes < ?) )`,
    [a, a, a, m]);
  return r2(row && row.saldo);
}

// Fila guardada del inventario final, o la sugerencia del kardex si no se ha capturado.
async function obtenerInventarioFinal(anio, mes) {
  const a = Number(anio), m = Number(mes);
  let guardada = null;
  try {
    const [[row]] = await pool.query(
      `SELECT inventario_final, origen, notas, updated_at
         FROM contabilidad_inventario_periodo WHERE periodo_anio = ? AND periodo_mes = ?`, [a, m]);
    guardada = row || null;
  } catch { /* tabla aún no migrada */ }

  if (guardada) {
    return {
      anio: a, mes: m, inventario_final: r2(guardada.inventario_final),
      origen: guardada.origen, notas: guardada.notas || null,
      sugerido: false, updated_at: guardada.updated_at,
      kardex: await valorKardexAlCorte(a, m),
    };
  }
  const kardex = await valorKardexAlCorte(a, m);
  return { anio: a, mes: m, inventario_final: kardex, origen: 'kardex', notas: null, sugerido: true, kardex };
}

async function guardarInventarioFinal({ anio, mes, inventario_final, notas }, usuarioId = null) {
  const a = parseInt(anio, 10);
  const m = parseInt(mes, 10);
  if (!a) { const e = new Error('anio es obligatorio'); e.status = 400; throw e; }
  if (!(m >= 1 && m <= 13)) { const e = new Error('mes debe estar entre 1 y 13 (13 = cierre)'); e.status = 400; throw e; }
  const val = r2(inventario_final);
  if (!(val >= 0)) { const e = new Error('inventario_final debe ser un número ≥ 0'); e.status = 400; throw e; }
  await pool.query(
    `INSERT INTO contabilidad_inventario_periodo
       (periodo_anio, periodo_mes, inventario_final, origen, notas, usuario_id)
     VALUES (?,?,?,'manual',?,?)
     ON DUPLICATE KEY UPDATE inventario_final = VALUES(inventario_final), origen = 'manual',
       notas = VALUES(notas), usuario_id = VALUES(usuario_id)`,
    [a, m, val, notas ? String(notas).slice(0, 255) : null, usuarioId]);
  return { anio: a, mes: m, inventario_final: val, origen: 'manual' };
}

// Desglose "Inventario inicial + Compras − Devoluciones − Inventario final = Costo" del
// periodo, para el Estado de Resultados. Una sola consulta sobre 115.01*; el abono de
// cierre (póliza origen='inventario', ref COSTO/CIERRE) se separa de las devoluciones
// sobre compras para que el bloque cuadre a la vista.
async function desgloseCostoVentas(periodo) {
  const { anio, mesDesde, mesHasta } = periodo;
  const esCosto = "(p.origen = 'inventario' AND p.referencia IN ('COSTO','CIERRE'))";
  const previo = `( p.periodo_anio < ?
                 OR (p.periodo_anio = ? AND p.origen = 'apertura')
                 OR (p.periodo_anio = ? AND p.origen <> 'apertura' AND p.periodo_mes < ?) )`;
  const enPeriodo = `(p.periodo_anio = ? AND p.origen <> 'apertura' AND p.periodo_mes BETWEEN ? AND ?)`;
  const [[row]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN ${previo}    THEN m.cargo - m.abono ELSE 0 END),0) AS inv_inicial,
       COALESCE(SUM(CASE WHEN ${enPeriodo} THEN m.cargo ELSE 0 END),0)           AS compras,
       COALESCE(SUM(CASE WHEN ${enPeriodo} AND ${esCosto}     THEN m.abono ELSE 0 END),0) AS costo_posteado,
       COALESCE(SUM(CASE WHEN ${enPeriodo} AND NOT ${esCosto} THEN m.abono ELSE 0 END),0) AS devoluciones
     FROM polizas_movimientos m JOIN polizas p ON p.id = m.poliza_id
     WHERE ${condInv}`,
    [
      anio, anio, anio, mesDesde,        // previo
      anio, mesDesde, mesHasta,          // enPeriodo (compras)
      anio, mesDesde, mesHasta,          // enPeriodo (costo_posteado)
      anio, mesDesde, mesHasta,          // enPeriodo (devoluciones)
    ]);
  const inv_inicial = r2(row.inv_inicial);
  const compras = r2(row.compras);
  const devoluciones = r2(row.devoluciones);
  const costo_posteado = r2(row.costo_posteado);
  const inventario_final = r2(inv_inicial + compras - devoluciones - costo_posteado);
  return { inventario_inicial: inv_inicial, compras, devoluciones, inventario_final, costo: costo_posteado };
}

module.exports = {
  METODOS, PREFIJO_INV,
  metodoEjercicio, guardarMetodo,
  valorKardexAlCorte, saldoInventarioPrevio,
  obtenerInventarioFinal, guardarInventarioFinal,
  desgloseCostoVentas,
};
