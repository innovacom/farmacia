/**
 * supervisor.alertas.service.js — Evalúa los umbrales del Panel de Supervisor
 * y manda UNA alerta agrupada por WhatsApp a los admins que la reciben.
 * Deduplica por firma (hash de los ítems pendientes) contra
 * supervisor_alertas_log: mientras el conjunto de pendientes no cambie, no
 * se repite el aviso cada vez que corre el cron (ver supervisor.cron.js).
 *
 * Envío (dos mensajes por destinatario, no uno con fallback):
 *  1. Plantilla aprobada por Meta (WHATSAPP_TEMPLATE_ALERTA) SIN variables —
 *     la plantilla real de producción quedó aprobada con el cuerpo fijo, sin
 *     {{1}} (confirmado con Meta: "expected number of params (0)"), así que
 *     no puede llevar el detalle. Sirve para romper la ventana de 24h y
 *     avisar "hay algo pendiente" aunque el admin no le haya escrito al bot.
 *  2. Texto libre con el detalle real (whatsapp.service#enviarTexto) — solo
 *     entrega si el admin le escribió al número en las últimas 24h; es
 *     "best effort" (nunca lanza, deja rastro en whatsapp_eventos si falla).
 * Si la plantilla no está configurada o Meta la rechaza, igual se intenta el
 * texto libre.
 */
const crypto = require('crypto');
const { pool } = require('../../config/db');
const panelSvc = require('./supervisor.service');
const client = require('../whatsapp/whatsapp.client');
const waService = require('../whatsapp/whatsapp.service');
const { aE164 } = require('../whatsapp/whatsapp.util');

function firmar(alertas) {
  const claves = alertas.map((a) => `${a.tipo}:${a.cantidad || ''}:${a.sucursal || ''}`).sort();
  return crypto.createHash('sha1').update(claves.join('|')).digest('hex');
}

function armarMensaje(alertas) {
  return 'DISMED - Panel de Supervisor\n' + alertas.map((a) => `- ${a.mensaje}`).join('\n');
}

// telefono se captura a mano (Usuarios) y puede traer "+", espacios o
// guiones ("+52 55 1234 5678"); Meta espera el dígitos-solo E.164 sin "+"
// (mismo criterio que whatsapp.util#aE164, usado en todo el resto del
// módulo de WhatsApp) — normalizar aquí evita un envío que Meta rechaza.
async function destinatarios(empresaId) {
  const [rows] = await pool.query(
    `SELECT id, nombre, telefono FROM usuarios
     WHERE empresa_id = ? AND rol = 'admin' AND activo = 1 AND recibe_alertas = 1
       AND telefono IS NOT NULL AND telefono <> ''`,
    [empresaId]
  );
  return rows.map((r) => ({ ...r, telefono: aE164(r.telefono) })).filter((r) => r.telefono);
}

async function evaluar(empresaId) {
  const { alertas } = await panelSvc.panel(empresaId, {});
  return { alertas, firma: firmar(alertas) };
}

async function yaSeEnvio(empresaId, firma) {
  const [[ultima]] = await pool.query(
    'SELECT firma FROM supervisor_alertas_log WHERE empresa_id = ? ORDER BY id DESC LIMIT 1',
    [empresaId]
  );
  return ultima?.firma === firma;
}

async function registrar(empresaId, firma, resumen) {
  await pool.query(
    'INSERT INTO supervisor_alertas_log (empresa_id, firma, resumen) VALUES (?, ?, ?)',
    [empresaId, firma, resumen.slice(0, 500)]
  );
}

async function enviarAUno(empresaId, usuario, mensaje) {
  const templateName = process.env.WHATSAPP_TEMPLATE_ALERTA;
  let plantillaOk = false;
  if (templateName) {
    try {
      await client.enviarPlantillaGenerica({
        telefonoE164: usuario.telefono,
        templateName,
        templateLang: process.env.WHATSAPP_TEMPLATE_ALERTA_LANG || 'es_MX',
        componentes: [], // plantilla aprobada sin variables (ver cabecera del archivo)
      });
      plantillaOk = true;
    } catch (err) {
      // Plantilla no configurada en Meta, rechazada, o error de red: se
      // sigue intentando el texto libre de todas formas.
    }
  }
  await waService.enviarTexto(empresaId, usuario.telefono, mensaje);
  return { usuario_id: usuario.id, telefono: usuario.telefono, plantilla: plantillaOk, via: plantillaOk ? 'plantilla+texto_libre' : 'texto_libre' };
}

/** forzar:true ignora la deduplicación por firma (lo usa /alertas/probar). */
async function enviar(empresaId, { forzar = false } = {}) {
  const { alertas, firma } = await evaluar(empresaId);
  if (!alertas.length) return { enviado: false, motivo: 'sin_alertas', alertas };
  if (!forzar && (await yaSeEnvio(empresaId, firma))) {
    return { enviado: false, motivo: 'sin_cambios', alertas };
  }

  const destinos = await destinatarios(empresaId);
  if (!destinos.length) return { enviado: false, motivo: 'sin_destinatarios', alertas };

  const mensaje = armarMensaje(alertas);
  // Cada destinatario es un envío independiente (WhatsApp de otro admin) —
  // en paralelo en vez de esperar uno por uno.
  const resultados = await Promise.all(destinos.map((u) => enviarAUno(empresaId, u, mensaje)));

  await registrar(empresaId, firma, mensaje);
  return { enviado: true, alertas, destinatarios: resultados };
}

// Prueba real de canal: manda un mensaje fijo a los destinatarios configurados
// sin pasar por la evaluación de umbrales ni por el log de deduplicación —
// útil para confirmar plantilla/teléfono aunque no haya ninguna alerta activa
// en ese momento (a diferencia de enviar(), que no manda nada si no hay
// pendientes reales).
async function enviarPrueba(empresaId) {
  const destinos = await destinatarios(empresaId);
  if (!destinos.length) return { enviado: false, motivo: 'sin_destinatarios' };
  const mensaje = 'DISMED - Panel de Supervisor\nMensaje de prueba: si ves esto, las alertas por WhatsApp ya están funcionando.';
  const resultados = await Promise.all(destinos.map((u) => enviarAUno(empresaId, u, mensaje)));
  return { enviado: true, destinatarios: resultados };
}

module.exports = { evaluar, enviar, enviarPrueba };
