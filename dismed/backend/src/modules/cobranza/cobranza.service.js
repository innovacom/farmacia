/**
 * cobranza.service.js — Cuentas por cobrar por cliente y por sucursal.
 *
 * Cuenta por cobrar = entregas tipo 'factura' no canceladas. El saldo de una factura es
 * total − cobros ACTIVOS aplicados. Vencimiento = fecha de la factura + días de crédito
 * (los de la sucursal si tiene propios, si no los del cliente).
 *
 * Límite de crédito: el del cliente es el consolidado de todas sus sucursales; la
 * sucursal puede tener además uno propio. Un límite 0/NULL significa "sin límite definido"
 * y no se hace cumplir (todos los clientes existentes parten con 0).
 */
const { pool } = require('../../config/db');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Facturas con su cobrado/saldo/vencimiento. Filtros opcionales por cliente/sucursal.
 * `db` puede ser el pool o una conexión (para leer dentro de una transacción).
 */
async function facturas(db, { clienteId, sucursalId, soloConSaldo = false } = {}) {
  const where = ["e.tipo = 'factura'", "e.estatus = 'confirmada'", "(e.estatus_cfdi IS NULL OR e.estatus_cfdi <> 'cancelado')"];
  const params = [];
  if (clienteId) { where.push('e.cliente_id = ?'); params.push(clienteId); }
  if (sucursalId) { where.push('e.sucursal_id = ?'); params.push(sucursalId); }

  const [rows] = await db.query(
    `SELECT e.id, e.folio, e.cliente_id, e.sucursal_id, e.total, e.created_at,
            su.nombre AS sucursal,
            COALESCE(ap.cobrado, 0) AS cobrado,
            COALESCE(su.dias_credito, c.dias_credito, 0) AS dias_credito,
            DATE_ADD(DATE(e.created_at), INTERVAL COALESCE(su.dias_credito, c.dias_credito, 0) DAY) AS vence
       FROM entregas e
       JOIN clientes c ON c.id = e.cliente_id
       LEFT JOIN clientes_sucursales su ON su.id = e.sucursal_id
       LEFT JOIN (SELECT a.entrega_id, SUM(a.monto) AS cobrado
                    FROM cobros_aplicaciones a
                    JOIN cobros co ON co.id = a.cobro_id AND co.estatus = 'activo'
                   GROUP BY a.entrega_id) ap ON ap.entrega_id = e.id
      WHERE ${where.join(' AND ')}
      ORDER BY e.created_at, e.id`,
    params
  );

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const out = rows.map((f) => {
    const saldo = r2(f.total - f.cobrado);
    const vence = f.vence ? new Date(f.vence) : null;
    const diasVencida = vence ? Math.floor((hoy - vence) / 86400000) : 0;
    return { ...f, total: r2(f.total), cobrado: r2(f.cobrado), saldo,
             dias_vencida: saldo > 0.005 && diasVencida > 0 ? diasVencida : 0 };
  });
  return soloConSaldo ? out.filter((f) => f.saldo > 0.005) : out;
}

/** Totales por sucursal y consolidado de un cliente. */
async function saldosCliente(db, clienteId) {
  const [[cliente]] = await db.query(
    'SELECT id, razon_social, rfc, limite_credito, dias_credito FROM clientes WHERE id = ?', [clienteId]);
  if (!cliente) return null;
  const [sucursales] = await db.query(
    'SELECT id, nombre, es_matriz, activo, limite_credito, dias_credito FROM clientes_sucursales WHERE cliente_id = ? ORDER BY es_matriz DESC, nombre',
    [clienteId]);
  const todas = await facturas(db, { clienteId });

  const resumen = (lista) => ({
    facturado: r2(lista.reduce((s, f) => s + f.total, 0)),
    cobrado: r2(lista.reduce((s, f) => s + f.cobrado, 0)),
    saldo: r2(lista.reduce((s, f) => s + f.saldo, 0)),
    vencido: r2(lista.filter((f) => f.dias_vencida > 0).reduce((s, f) => s + f.saldo, 0)),
  });

  const porSucursal = sucursales.map((s) => {
    const t = resumen(todas.filter((f) => f.sucursal_id === s.id));
    const limite = s.limite_credito != null ? Number(s.limite_credito) : null;
    return { ...s, ...t, limite_credito: limite,
             disponible: limite != null && limite > 0 ? r2(limite - t.saldo) : null };
  });
  const sinSucursal = todas.filter((f) => !f.sucursal_id);
  const total = resumen(todas);
  const limiteCliente = Number(cliente.limite_credito) || 0;

  const [[{ sin_aplicar }]] = await db.query(
    `SELECT COALESCE(SUM(co.monto - COALESCE(ap.aplicado, 0)), 0) AS sin_aplicar
       FROM cobros co
       LEFT JOIN (SELECT cobro_id, SUM(monto) AS aplicado FROM cobros_aplicaciones GROUP BY cobro_id) ap
              ON ap.cobro_id = co.id
      WHERE co.cliente_id = ? AND co.estatus = 'activo'`, [clienteId]);

  return {
    cliente: { ...cliente, limite_credito: limiteCliente },
    consolidado: { ...total, limite_credito: limiteCliente,
                   disponible: limiteCliente > 0 ? r2(limiteCliente - total.saldo) : null,
                   sin_aplicar: r2(sin_aplicar) },
    sucursales: porSucursal,
    sin_sucursal: sinSucursal.length ? resumen(sinSucursal) : null,
  };
}

/**
 * ¿Un monto nuevo rebasa el límite de la sucursal o el consolidado del cliente?
 * Devuelve { excede, avisos[] } — el llamador decide si avisa o bloquea.
 */
async function verificarCredito(db, clienteId, sucursalId, montoNuevo) {
  const s = await saldosCliente(db, clienteId);
  if (!s) return { excede: false, avisos: [] };
  const avisos = [];
  let excede = false;
  const mxn = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  const lc = s.consolidado.limite_credito;
  if (lc > 0 && s.consolidado.saldo + montoNuevo > lc + 0.005) {
    excede = true;
    avisos.push(`Rebasa el límite de crédito de ${s.cliente.razon_social}: saldo ${mxn(s.consolidado.saldo)} + pedido ${mxn(montoNuevo)} > límite ${mxn(lc)}.`);
  }
  const suc = sucursalId ? s.sucursales.find((x) => x.id === Number(sucursalId)) : null;
  if (suc && suc.limite_credito > 0 && suc.saldo + montoNuevo > suc.limite_credito + 0.005) {
    excede = true;
    avisos.push(`Rebasa el límite de la sucursal ${suc.nombre}: saldo ${mxn(suc.saldo)} + pedido ${mxn(montoNuevo)} > límite ${mxn(suc.limite_credito)}.`);
  }
  if (s.consolidado.vencido > 0.005) {
    avisos.push(`Atención: el cliente tiene ${mxn(s.consolidado.vencido)} en facturas vencidas.`);
  }
  return { excede, avisos };
}

async function getModo(db = pool) {
  const [[r]] = await db.query("SELECT valor FROM configuracion WHERE clave = 'credito_modo'");
  return r && r.valor === 'bloqueo' ? 'bloqueo' : 'aviso';
}

module.exports = { facturas, saldosCliente, verificarCredito, getModo, r2 };
