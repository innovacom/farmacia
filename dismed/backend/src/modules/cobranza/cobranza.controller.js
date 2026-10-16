const { pool } = require('../../config/db');
const svc = require('./cobranza.service');

const { r2 } = svc;
const FORMAS = ['transferencia', 'cheque', 'efectivo', 'tarjeta', 'otro'];

/** GET /cobranza/resumen → clientes con saldo pendiente (consolidado). */
async function resumen(req, res, next) {
  try {
    const abiertas = await svc.facturas(pool, { soloConSaldo: true });
    const porCliente = new Map();
    for (const f of abiertas) {
      const x = porCliente.get(f.cliente_id) || { cliente_id: f.cliente_id, saldo: 0, vencido: 0, facturas: 0 };
      x.saldo = r2(x.saldo + f.saldo);
      if (f.dias_vencida > 0) x.vencido = r2(x.vencido + f.saldo);
      x.facturas += 1;
      porCliente.set(f.cliente_id, x);
    }
    const ids = [...porCliente.keys()];
    let clientes = [];
    if (ids.length) {
      [clientes] = await pool.query(
        `SELECT c.id, c.razon_social, c.rfc, c.limite_credito,
                (SELECT COUNT(*) FROM clientes_sucursales s WHERE s.cliente_id = c.id AND s.activo = 1) AS num_sucursales
           FROM clientes c WHERE c.id IN (?)`, [ids]);
    }
    const rows = clientes.map((c) => {
      const x = porCliente.get(c.id);
      const limite = Number(c.limite_credito) || 0;
      return { ...c, limite_credito: limite, ...x,
               excede: limite > 0 && x.saldo > limite + 0.005 };
    }).sort((a, b) => b.saldo - a.saldo);
    const modo = await svc.getModo();
    res.json({ credito_modo: modo, clientes: rows,
               totales: { saldo: r2(rows.reduce((s, r) => s + r.saldo, 0)), vencido: r2(rows.reduce((s, r) => s + r.vencido, 0)) } });
  } catch (err) { next(err); }
}

/** GET /cobranza/clientes/:id → saldos por sucursal, facturas abiertas y últimos cobros. */
async function detalleCliente(req, res, next) {
  try {
    const saldos = await svc.saldosCliente(pool, req.params.id);
    if (!saldos) return res.status(404).json({ error: 'Cliente no encontrado' });
    const facturas = await svc.facturas(pool, { clienteId: req.params.id, soloConSaldo: true });
    const [cobros] = await pool.query(
      `SELECT co.id, co.fecha, co.monto, co.forma_pago, co.referencia, co.estatus, co.sucursal_id,
              su.nombre AS sucursal,
              COALESCE((SELECT SUM(a.monto) FROM cobros_aplicaciones a WHERE a.cobro_id = co.id), 0) AS aplicado
         FROM cobros co LEFT JOIN clientes_sucursales su ON su.id = co.sucursal_id
        WHERE co.cliente_id = ? ORDER BY co.fecha DESC, co.id DESC LIMIT 30`, [req.params.id]);
    res.json({ ...saldos, facturas, cobros });
  } catch (err) { next(err); }
}

/**
 * POST /cobranza/cobros
 * { cliente_id, sucursal_id?, fecha, monto, forma_pago, referencia?, notas?,
 *   aplicaciones: [{ entrega_id, monto }] }
 */
async function crearCobro(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { cliente_id, sucursal_id, fecha, forma_pago, referencia, notas } = req.body;
    const monto = r2(req.body.monto);
    const aplicaciones = (Array.isArray(req.body.aplicaciones) ? req.body.aplicaciones : [])
      .map((a) => ({ entrega_id: Number(a.entrega_id), monto: r2(a.monto) }))
      .filter((a) => a.entrega_id && a.monto > 0);

    if (!cliente_id || !(monto > 0)) return res.status(400).json({ error: 'cliente_id y monto > 0 son requeridos' });
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'fecha inválida (AAAA-MM-DD)' });
    if (forma_pago && !FORMAS.includes(forma_pago)) return res.status(400).json({ error: 'forma_pago inválida' });
    const totalAplicado = r2(aplicaciones.reduce((s, a) => s + a.monto, 0));
    if (totalAplicado > monto + 0.005) {
      return res.status(400).json({ error: `Lo aplicado (${totalAplicado}) excede el monto del cobro (${monto})` });
    }
    if (new Set(aplicaciones.map((a) => a.entrega_id)).size !== aplicaciones.length) {
      return res.status(400).json({ error: 'Una factura aparece repetida en las aplicaciones' });
    }

    await conn.beginTransaction();

    if (sucursal_id) {
      const [[s]] = await conn.query('SELECT id FROM clientes_sucursales WHERE id = ? AND cliente_id = ?', [sucursal_id, cliente_id]);
      if (!s) { await conn.rollback(); return res.status(400).json({ error: 'La sucursal no pertenece al cliente' }); }
    }

    // Bloquear las facturas a aplicar y validar contra el saldo vigente
    if (aplicaciones.length) {
      await conn.query('SELECT id FROM entregas WHERE id IN (?) FOR UPDATE', [aplicaciones.map((a) => a.entrega_id)]);
      const abiertas = await svc.facturas(conn, { clienteId: cliente_id });
      const porId = new Map(abiertas.map((f) => [f.id, f]));
      for (const a of aplicaciones) {
        const f = porId.get(a.entrega_id);
        if (!f) { await conn.rollback(); return res.status(400).json({ error: `La factura #${a.entrega_id} no existe, está cancelada o es de otro cliente` }); }
        if (a.monto > f.saldo + 0.005) {
          await conn.rollback();
          return res.status(400).json({ error: `La factura ${f.folio} tiene saldo ${f.saldo}; no se pueden aplicar ${a.monto}` });
        }
      }
    }

    const [r] = await conn.query(
      `INSERT INTO cobros (cliente_id, sucursal_id, fecha, monto, forma_pago, referencia, notas, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cliente_id, sucursal_id || null, fecha, monto, forma_pago || 'transferencia',
       referencia || null, notas || null, req.user?.id || null]);
    if (aplicaciones.length) {
      await conn.query('INSERT INTO cobros_aplicaciones (cobro_id, entrega_id, monto) VALUES ?',
        [aplicaciones.map((a) => [r.insertId, a.entrega_id, a.monto])]);
    }
    await conn.commit();
    res.status(201).json({ id: r.insertId, aplicado: totalAplicado, sin_aplicar: r2(monto - totalAplicado) });
  } catch (err) { await conn.rollback(); next(err); } finally { conn.release(); }
}

/** POST /cobranza/cobros/:id/cancelar → las facturas recuperan su saldo. */
async function cancelarCobro(req, res, next) {
  try {
    const [r] = await pool.query(
      `UPDATE cobros SET estatus = 'cancelado', cancelado_at = NOW(), cancelado_por = ?
        WHERE id = ? AND estatus = 'activo'`, [req.user?.id || null, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Cobro no encontrado o ya cancelado' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function putConfig(req, res, next) {
  try {
    if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo admin' });
    const modo = req.body.credito_modo;
    if (!['aviso', 'bloqueo'].includes(modo)) return res.status(400).json({ error: 'credito_modo inválido' });
    await pool.query(
      `INSERT INTO configuracion (clave, valor, descripcion) VALUES ('credito_modo', ?, 'Modo de control de crédito en pedidos')
       ON DUPLICATE KEY UPDATE valor = VALUES(valor)`, [modo]);
    res.json({ credito_modo: modo });
  } catch (err) { next(err); }
}

module.exports = { resumen, detalleCliente, crearCobro, cancelarCobro, putConfig };
