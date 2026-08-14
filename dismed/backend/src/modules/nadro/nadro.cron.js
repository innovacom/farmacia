/**
 * nadro.cron.js — Corre una vez al día (default 21:00, hora CDMX) y arma +
 * coloca el pedido de reposición a Nadro con lo vendido en el día (ver
 * nadro.pedido.service#pedidoDelDia y nadro.automation.service#colocarPedido).
 * Se activa con NADRO_AUTOPEDIDO_ENABLED=true (mismo criterio que
 * SAT_CRON_ENABLED / SUPERVISOR_ALERTAS_ENABLED: solo en el VPS de
 * producción, nunca corre en local sin querer).
 *
 * nadro_pedidos_log (UNIQUE empresa_id+fecha) evita correr dos veces el
 * mismo día si el proceso se reinicia o el cron se dispara de más. Cada
 * corrida — exitosa, sin ítems, o con error — manda un resumen por WhatsApp
 * a los admins con recibe_alertas=1 (mismos destinatarios que las alertas
 * del Panel de Supervisor) para que quede visible sin tener que entrar a
 * revisar el portal de Nadro cada noche.
 */
const cron = require('node-cron');
const { pool } = require('../../config/db');
const pedidoSvc = require('./nadro.pedido.service');
const automationSvc = require('./nadro.automation.service');
const configSvc = require('./nadro.config.service');
const waService = require('../whatsapp/whatsapp.service');
const { aE164 } = require('../whatsapp/whatsapp.util');

const TZ = 'America/Mexico_City';

async function destinatarios(empresaId) {
  const [rows] = await pool.query(
    `SELECT id, telefono FROM usuarios
     WHERE empresa_id = ? AND rol = 'admin' AND activo = 1 AND recibe_alertas = 1
       AND telefono IS NOT NULL AND telefono <> ''`,
    [empresaId]
  );
  return rows.map((r) => aE164(r.telefono)).filter(Boolean);
}

async function avisar(empresaId, mensaje) {
  const telefonos = await destinatarios(empresaId);
  await Promise.all(telefonos.map((tel) =>
    waService.enviarTexto(empresaId, tel, mensaje).catch((e) =>
      console.error(`[nadro] no se pudo avisar a ${tel}:`, e.message))
  ));
}

async function yaCorrioHoy(empresaId, fecha) {
  const [[row]] = await pool.query(
    'SELECT id FROM nadro_pedidos_log WHERE empresa_id = ? AND fecha = ?',
    [empresaId, fecha]
  );
  return !!row;
}

async function registrar(empresaId, fecha, { estado, itemsJson, total, ordenReferencia, mensaje }) {
  await pool.query(
    `INSERT INTO nadro_pedidos_log (empresa_id, fecha, estado, items_json, total, orden_referencia, mensaje)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, fecha, estado, JSON.stringify(itemsJson || null), total ?? null, ordenReferencia || null, (mensaje || '').slice(0, 500)]
  );
}

function refDePedido(ordenUrl) {
  try { return new URL(ordenUrl).searchParams.get('og') || null; }
  catch { return null; }
}

async function correrParaEmpresa(empresaId) {
  const fecha = new Date().toISOString().slice(0, 10);
  if (await yaCorrioHoy(empresaId, fecha)) return;

  const { items, excluidos } = await pedidoSvc.pedidoDelDia(empresaId, fecha);
  if (!items.length) {
    await registrar(empresaId, fecha, { estado: 'sin_items', mensaje: 'Sin ventas de productos con proveedor Nadro confirmado en el día' });
    return;
  }

  const resumenExcluidos = excluidos.length
    ? `\n\nSin EAN (no se pudieron pedir): ${excluidos.map((e) => e.descripcion).join(', ')}`
    : '';

  try {
    const r = await automationSvc.colocarPedido(items);
    if (!r.ok) {
      await registrar(empresaId, fecha, { estado: 'error', itemsJson: items, mensaje: `Ningún EAN válido en Nadro (${items.length} enviados)` });
      await avisar(empresaId, `DISMED - Pedido Nadro\nNo se pudo colocar: ningún producto fue válido en el portal (${items.length} EAN enviados).${resumenExcluidos}`);
      return;
    }
    await registrar(empresaId, fecha, {
      estado: 'ok', itemsJson: items, total: r.total, ordenReferencia: refDePedido(r.ordenUrl),
      mensaje: `${r.validos} de ${items.length} línea(s) pedidas, total $${r.total ?? '?'}`,
    });
    const rechazo = r.rechazados ? `\n${r.rechazados} línea(s) rechazadas por Nadro (sin existencia u otro motivo).` : '';
    await avisar(empresaId, `DISMED - Pedido Nadro colocado\n${r.validos} producto(s), total $${r.total ?? '?'}.${rechazo}${resumenExcluidos}`);
  } catch (e) {
    await registrar(empresaId, fecha, { estado: 'error', itemsJson: items, mensaje: e.message });
    await avisar(empresaId, `DISMED - Pedido Nadro FALLÓ\n${e.message}\nRevisar manualmente en i22.nadro.mx.${resumenExcluidos}`);
  }
}

function initNadroCron() {
  if (String(process.env.NADRO_AUTOPEDIDO_ENABLED).toLowerCase() !== 'true') {
    console.log('[nadro] cron de pedido automático deshabilitado (NADRO_AUTOPEDIDO_ENABLED!=true)');
    return;
  }
  const hora = Number(process.env.NADRO_AUTOPEDIDO_HORA) || 21;

  cron.schedule(`0 ${hora} * * *`, async () => {
    try {
      if (!(await configSvc.activo())) {
        console.log('[nadro] pedido automático apagado desde Configuración, se omite la corrida de hoy');
        return;
      }
      const [empresas] = await pool.query('SELECT id FROM empresas');
      for (const { id: empresaId } of empresas) {
        await correrParaEmpresa(empresaId).catch((e) =>
          console.error(`[nadro] error en empresa ${empresaId}:`, e.message));
      }
    } catch (e) {
      console.error('[nadro] error general del cron:', e.message);
    }
  }, { timezone: TZ });

  console.log(`[nadro] cron de pedido automático activo (${hora}:00 diario, TZ ${TZ})`);
}

module.exports = { initNadroCron, correrParaEmpresa };
