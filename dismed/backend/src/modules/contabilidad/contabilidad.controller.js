/**
 * contabilidad.controller.js — Reportes contables derivados de los CFDI.
 *   GET /contabilidad/estado-resultados   Estado de Resultados
 *   GET /contabilidad/balance-general     Balance General (estimado)
 *   GET /contabilidad/balanza             Balanza de Comprobación (derivada)
 *
 * Filtros por query (los tres reportes los comparten):
 *   anio                año (obligatorio salvo desde/hasta)
 *   mes                 1-12 (opcional; sin mes = ejercicio anual acumulado)
 *   desde, hasta        rango 'YYYY-MM-DD' (alternativa a anio/mes)
 *   incluir_cancelados  '1'|'true' para sumar también los CFDI cancelados
 */
const svc = require('./contabilidad.reportes.service');
const aux = require('./cuentas.auxiliares');
const invPer = require('./inventario.periodo');
const { pool } = require('../../config/db');

// Toma los filtros comunes desde el query string.
const filtros = (req) => ({
  anio: req.query.anio,
  mes: req.query.mes,
  modo: req.query.modo,                 // 'mensual' | 'acumulado'
  solo_confirmadas: req.query.solo_confirmadas,
});

async function estadoResultados(req, res, next) {
  try { res.json(await svc.estadoResultados(filtros(req))); }
  catch (err) { next(err); }
}

async function balanceGeneral(req, res, next) {
  try { res.json(await svc.balanceGeneral(filtros(req))); }
  catch (err) { next(err); }
}

async function balanza(req, res, next) {
  try { res.json(await svc.balanza(filtros(req))); }
  catch (err) { next(err); }
}

/**
 * GET /contabilidad/catalogo-cuentas — Catálogo de cuentas (Código Agrupador SAT).
 *   q                   texto en código o nombre
 *   rubro               Activo|Pasivo|Capital|Ingresos|Costos|Gastos|...
 *   nivel               1 (mayor) | 2 (subcuenta) | 3 (auxiliar de detalle)
 *   incluir_auxiliares  '1' — además de mayor/subcuenta, incluye las cuentas
 *     auxiliares (nivel 3, tabla cuentas_auxiliares) activas. Opt-in: por
 *     defecto NO se incluyen porque este endpoint también lo usa
 *     CuentaContableSelect para asignar la cuenta POR DEFECTO de un
 *     proveedor/producto/cliente/banco, donde un auxiliar de un cliente en
 *     particular no tiene sentido como opción.
 *   limit               máx. filas (def. 500, tope 2000)
 * Devuelve { total, rubros, rows }.
 */
async function catalogoCuentas(req, res, next) {
  try {
    const incluirAux = req.query.incluir_auxiliares === '1' || req.query.incluir_auxiliares === 'true';
    const nivel = ['1', '2', '3'].includes(req.query.nivel) ? parseInt(req.query.nivel, 10) : null;
    const q = req.query.q && req.query.q.trim() ? req.query.q.trim() : null;
    const rubro = req.query.rubro && req.query.rubro.trim() ? req.query.rubro.trim() : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);

    // Rama del agrupador (nivel 1-2) — se omite por completo si piden nivel 3.
    const whereCat = [];
    const valsCat = [];
    if (nivel === 3) whereCat.push('1=0');
    else {
      if (q) { whereCat.push('(codigo LIKE ? OR nombre LIKE ?)'); valsCat.push(`%${q}%`, `%${q}%`); }
      if (rubro) { whereCat.push('rubro = ?'); valsCat.push(rubro); }
      if (nivel === 1 || nivel === 2) { whereCat.push('nivel = ?'); valsCat.push(nivel); }
    }
    const wCat = whereCat.length ? `WHERE ${whereCat.join(' AND ')}` : '';
    // COLLATE explícito en cada columna de texto: sin esto el UNION con la rama
    // de auxiliares truena con "Illegal mix of collations" (mismo problema ya
    // documentado entre sat_cuentas_agrupador y polizas_movimientos).
    const selectCat = `SELECT codigo COLLATE utf8mb4_general_ci codigo, nivel,
         naturaleza COLLATE utf8mb4_general_ci naturaleza, padre COLLATE utf8mb4_general_ci padre,
         rubro COLLATE utf8mb4_general_ci rubro, nombre COLLATE utf8mb4_general_ci nombre
       FROM sat_cuentas_agrupador ${wCat}`;

    // Rama de auxiliares (nivel 3) — solo si se pidió explícitamente.
    let selectAux = null, valsAux = [];
    if (incluirAux && nivel !== 1 && nivel !== 2) {
      const whereAux = ['a.activo = 1'];
      if (q) { whereAux.push('(a.codigo LIKE ? OR a.nombre LIKE ?)'); valsAux.push(`%${q}%`, `%${q}%`); }
      if (rubro) { whereAux.push('s.rubro = ?'); valsAux.push(rubro); }
      selectAux = `SELECT a.codigo COLLATE utf8mb4_general_ci codigo, 3 AS nivel,
           s.naturaleza COLLATE utf8mb4_general_ci naturaleza, a.cuenta_padre COLLATE utf8mb4_general_ci padre,
           s.rubro COLLATE utf8mb4_general_ci rubro, a.nombre COLLATE utf8mb4_general_ci nombre
         FROM cuentas_auxiliares a
         LEFT JOIN sat_cuentas_agrupador s ON s.codigo = a.cuenta_padre COLLATE utf8mb4_general_ci
        WHERE ${whereAux.join(' AND ')}`;
    }

    const union = selectAux ? `${selectCat} UNION ALL ${selectAux}` : selectCat;
    const unionVals = selectAux ? [...valsCat, ...valsAux] : valsCat;

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM (${union}) t`, unionVals);
    const [rows] = await pool.query(`${union} ORDER BY codigo LIMIT ?`, [...unionVals, limit]);
    const [rubros] = await pool.query(
      'SELECT rubro, COUNT(*) AS n FROM sat_cuentas_agrupador GROUP BY rubro ORDER BY MIN(codigo)'
    );
    res.json({ total, limit, rubros, rows });
  } catch (err) { next(err); }
}

const cfdiF = (req) => ({
  tipo:             req.query.tipo,
  tipo_comprobante: req.query.tipo_comprobante,
  desde:            req.query.desde,
  hasta:            req.query.hasta,
  estatus:          req.query.estatus,
});

async function cfdiPorComprobante(req, res, next) {
  try { res.json(await svc.cfdiPorComprobante(cfdiF(req))); }
  catch (err) { next(err); }
}

async function cfdiResumenGeneral(req, res, next) {
  try { res.json(await svc.cfdiResumenGeneral(cfdiF(req))); }
  catch (err) { next(err); }
}

/**
 * Cuentas auxiliares (nivel 3 del catálogo, el detalle donde reciben
 * movimientos las pólizas — ver cuentas.auxiliares.js). El alta automática la
 * hace el motor de pólizas; aquí solo el catálogo (listar/alta manual/editar).
 */
async function auxiliaresListar(req, res, next) {
  try {
    res.json(await aux.listar({
      q: req.query.q, cuenta_padre: req.query.cuenta_padre,
      entidad_tipo: req.query.entidad_tipo, activo: req.query.activo,
    }));
  } catch (err) { next(err); }
}

async function auxiliaresCrear(req, res, next) {
  try { res.status(201).json(await aux.crearManual(req.body || {})); }
  catch (err) { next(err); }
}

async function auxiliaresActualizar(req, res, next) {
  try { res.json(await aux.actualizarManual(req.params.id, req.body || {})); }
  catch (err) { next(err); }
}

// GET /contabilidad/estado-cuenta?cuenta_padre=105.01&anio=&mes=&modo=&solo_confirmadas=
// Estado de cuenta (saldos por auxiliar) de una subcuenta — el detalle por
// cliente/proveedor que la Balanza colapsa en una sola fila.
async function estadoCuenta(req, res, next) {
  try {
    res.json(await svc.estadoCuentaAuxiliar({ ...filtros(req), cuenta_padre: req.query.cuenta_padre }));
  } catch (err) { next(err); }
}

// ── Método de costeo del ejercicio + inventario final por periodo ───────────
// GET /contabilidad/ejercicio?anio=2026 → { anio, metodo_inventario }
async function ejercicioGet(req, res, next) {
  try {
    const anio = parseInt(req.query.anio, 10);
    if (!anio) return res.status(400).json({ error: 'anio es obligatorio' });
    res.json({ anio, metodo_inventario: await invPer.metodoEjercicio(anio) });
  } catch (err) { next(err); }
}

// PUT /contabilidad/ejercicio  { anio, metodo_inventario }  (admin)
async function ejercicioPut(req, res, next) {
  try {
    res.json(await invPer.guardarMetodo(req.body.anio, req.body.metodo_inventario, req.user && req.user.id));
  } catch (err) { next(err); }
}

// GET /contabilidad/inventario-periodo?anio=2026&mes=8 → valor guardado o sugerencia del kardex
async function inventarioPeriodoGet(req, res, next) {
  try {
    const anio = parseInt(req.query.anio, 10);
    const mes = parseInt(req.query.mes, 10);
    if (!anio || !(mes >= 1 && mes <= 13)) {
      return res.status(400).json({ error: 'anio y mes (1..13) son obligatorios' });
    }
    res.json(await invPer.obtenerInventarioFinal(anio, mes));
  } catch (err) { next(err); }
}

// PUT /contabilidad/inventario-periodo  { anio, mes, inventario_final, notas }  (admin)
async function inventarioPeriodoPut(req, res, next) {
  try {
    res.json(await invPer.guardarInventarioFinal(req.body || {}, req.user && req.user.id));
  } catch (err) { next(err); }
}

module.exports = {
  estadoResultados, balanceGeneral, balanza, catalogoCuentas, cfdiPorComprobante, cfdiResumenGeneral,
  auxiliaresListar, auxiliaresCrear, auxiliaresActualizar, estadoCuenta,
  ejercicioGet, ejercicioPut, inventarioPeriodoGet, inventarioPeriodoPut,
};
