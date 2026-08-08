/**
 * supervisor.service.js — Datos del Panel de Supervisor: pedidos de WhatsApp
 * pendientes de surtir, mensajes de WhatsApp sin responder, cierre de caja
 * por sucursal y resumen contable (venta/costo/ganancia). Reusa las mismas
 * fuentes que ya alimentan sus pantallas de origen — no duplica cálculo:
 *   - WhatsApp sin responder: whatsapp.mensajeria.service#pendientesResponder
 *   - Venta/costo/ganancia: pos.reportes.service#ganancias (mismo costo de
 *     inventario que usa el POS, no el de CFDI/Contabilidad).
 */
const { pool } = require('../../config/db');
const mensajeria = require('../whatsapp/whatsapp.mensajeria.service');
const reportes = require('../pos/pos.reportes.service');
const umbralesSvc = require('./supervisor.umbrales.service');

async function listarSucursales(empresaId) {
  const [rows] = await pool.query(
    'SELECT id, nombre FROM sucursales WHERE empresa_id = ? AND activo = 1 ORDER BY nombre',
    [empresaId]
  );
  return rows;
}

async function pedidosPendientes(empresaId, sucursalId, estado) {
  const params = [empresaId];
  let where = `p.empresa_id = ? AND p.estatus IN ('pendiente','preparando','listo','en_reparto')`;
  if (sucursalId) { where += ' AND p.sucursal_id = ?'; params.push(sucursalId); }
  const [rows] = await pool.query(
    `SELECT p.id, p.folio, p.estatus, p.sucursal_id, s.nombre AS sucursal,
            c.nombre AS cliente, p.created_at,
            TIMESTAMPDIFF(MINUTE, p.created_at, NOW()) AS minutos_espera
     FROM pedidos_whatsapp p
     JOIN sucursales s ON s.id = p.sucursal_id
     JOIN whatsapp_contactos c ON c.id = p.contacto_id
     WHERE ${where}
     ORDER BY p.created_at ASC`,
    params
  );
  return rows.map((r) => {
    const umbral = umbralesSvc.resolverValor(estado, r.sucursal_id, 'pedido_sin_surtir_min');
    return { ...r, umbral_min: umbral, atrasado: r.minutos_espera > umbral };
  });
}

async function whatsappPendientes(empresaId, estado) {
  const rows = await mensajeria.pendientesResponder(empresaId);
  const umbral = umbralesSvc.resolverValor(estado, null, 'whatsapp_sin_responder_min');
  return rows.map((r) => {
    const minutos_espera = Math.max(0, Math.floor((Date.now() - new Date(r.ultimo_en).getTime()) / 60000));
    return { ...r, minutos_espera, umbral_min: umbral, atrasado: minutos_espera > umbral };
  });
}

// Un renglón por sucursal: el turno abierto si hay uno, si no el último
// cerrado hoy. efectivo_esperado solo tiene sentido exponerlo aquí porque
// este módulo entero es admin-only (mismo candado que pos.controller.js
// aplica al front para el corte con arqueo ciego).
async function cierresCaja(empresaId, sucursalId, estado) {
  const params = [empresaId];
  let whereSuc = '';
  if (sucursalId) { whereSuc = ' AND s.id = ?'; params.push(sucursalId); }
  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT t.id AS turno_id, t.estatus, t.abierto_en, t.cerrado_en,
              t.efectivo_esperado, t.efectivo_contado, t.diferencia,
              s.id AS sucursal_id, s.nombre AS sucursal, cx.nombre AS caja, u.nombre AS cajero,
              ROW_NUMBER() OVER (
                PARTITION BY s.id
                ORDER BY (t.estatus = 'abierto') DESC, COALESCE(t.cerrado_en, t.abierto_en) DESC
              ) AS rn
       FROM pos_turnos t
       JOIN pos_cajas cx ON cx.id = t.caja_id
       JOIN sucursales s ON s.id = cx.sucursal_id
       JOIN usuarios u ON u.id = t.usuario_id
       WHERE t.empresa_id = ?
         AND (t.estatus = 'abierto' OR DATE(COALESCE(t.cerrado_en, t.abierto_en)) = CURDATE())
         ${whereSuc}
     ) x WHERE rn = 1 ORDER BY sucursal`,
    params
  );
  return rows.map((r) => {
    const diferencia = r.diferencia != null ? Number(r.diferencia) : null;
    const umbral = umbralesSvc.resolverValor(estado, r.sucursal_id, 'diferencia_caja_pesos');
    return {
      turno_id: r.turno_id,
      sucursal_id: r.sucursal_id,
      sucursal: r.sucursal,
      caja: r.caja,
      cajero: r.cajero,
      estatus: r.estatus,
      abierto_en: r.abierto_en,
      cerrado_en: r.cerrado_en,
      efectivo_esperado: r.efectivo_esperado != null ? Number(r.efectivo_esperado) : null,
      efectivo_contado: r.efectivo_contado != null ? Number(r.efectivo_contado) : null,
      diferencia,
      umbral_pesos: umbral,
      alerta_diferencia: diferencia != null && Math.abs(diferencia) > umbral,
    };
  });
}

function rangoPeriodo(periodo) {
  const hoy = new Date();
  const hastaISO = hoy.toISOString().slice(0, 10);
  if (periodo === 'semana') {
    return { desde: new Date(hoy.getTime() - 6 * 24 * 3600 * 1000).toISOString().slice(0, 10), hasta: hastaISO };
  }
  if (periodo === 'mes') {
    return { desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10), hasta: hastaISO };
  }
  return { desde: hastaISO, hasta: hastaISO }; // 'hoy'
}

async function contable(empresaId, sucursalId, periodo) {
  const { desde, hasta } = rangoPeriodo(periodo);
  const r = await reportes.ganancias(empresaId, { desde, hasta, sucursal_id: sucursalId || undefined });
  return { ...r.kpi, periodo: periodo || 'hoy', desde, hasta };
}

function construirAlertas({ pedidos, whatsapp, cajas }) {
  const alertas = [];
  const pedidosAtrasados = pedidos.filter((p) => p.atrasado);
  if (pedidosAtrasados.length) {
    alertas.push({
      tipo: 'pedidos', nivel: 'crit', cantidad: pedidosAtrasados.length,
      mensaje: `${pedidosAtrasados.length} pedido(s) con más de ${pedidosAtrasados[0].umbral_min} min sin surtir`,
    });
  }
  const waAtrasados = whatsapp.filter((w) => w.atrasado);
  if (waAtrasados.length) {
    alertas.push({
      tipo: 'whatsapp', nivel: 'crit', cantidad: waAtrasados.length,
      mensaje: `${waAtrasados.length} mensaje(s) de WhatsApp sin responder`,
    });
  }
  for (const c of cajas.filter((c) => c.alerta_diferencia)) {
    alertas.push({
      tipo: 'caja', nivel: 'warn', sucursal: c.sucursal,
      mensaje: `${c.sucursal} cerró turno con diferencia de $${Math.abs(c.diferencia).toFixed(2)}`,
    });
  }
  return alertas;
}

async function panel(empresaId, { sucursal_id, periodo } = {}) {
  const sucursalId = sucursal_id ? Number(sucursal_id) : null;
  const estado = await umbralesSvc.getUmbrales(empresaId);

  const [pedidos, whatsapp, cajas, contableKpi, sucursales] = await Promise.all([
    pedidosPendientes(empresaId, sucursalId, estado),
    whatsappPendientes(empresaId, estado),
    cierresCaja(empresaId, sucursalId, estado),
    contable(empresaId, sucursalId, periodo),
    listarSucursales(empresaId),
  ]);

  return { pedidos, whatsapp, cajas, contable: contableKpi, sucursales, alertas: construirAlertas({ pedidos, whatsapp, cajas }) };
}

module.exports = { panel, pedidosPendientes, whatsappPendientes, cierresCaja, contable, construirAlertas };
