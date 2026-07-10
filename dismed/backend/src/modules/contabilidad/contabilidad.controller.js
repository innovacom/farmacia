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
 *   q       texto en código o nombre
 *   rubro   Activo|Pasivo|Capital|Ingresos|Costos|Gastos|...
 *   nivel   1 (mayor) | 2 (subcuenta)
 *   limit   máx. filas (def. 500, tope 2000)
 * Devuelve { total, rubros, rows }.
 */
async function catalogoCuentas(req, res, next) {
  try {
    const where = [];
    const vals = [];
    if (req.query.q && req.query.q.trim()) {
      const like = `%${req.query.q.trim()}%`;
      where.push('(codigo LIKE ? OR nombre LIKE ?)');
      vals.push(like, like);
    }
    if (req.query.rubro && req.query.rubro.trim()) {
      where.push('rubro = ?'); vals.push(req.query.rubro.trim());
    }
    if (req.query.nivel === '1' || req.query.nivel === '2') {
      where.push('nivel = ?'); vals.push(parseInt(req.query.nivel, 10));
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM sat_cuentas_agrupador ${w}`, vals
    );
    const [rows] = await pool.query(
      `SELECT codigo, nivel, naturaleza, padre, rubro, nombre
       FROM sat_cuentas_agrupador ${w}
       ORDER BY codigo LIMIT ?`,
      [...vals, limit]
    );
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

module.exports = { estadoResultados, balanceGeneral, balanza, catalogoCuentas, cfdiPorComprobante, cfdiResumenGeneral };
