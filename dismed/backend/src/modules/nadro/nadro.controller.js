const pedidoSvc = require('./nadro.pedido.service');
const cronSvc = require('./nadro.cron');
const configSvc = require('./nadro.config.service');

// GET /nadro/config → { activo }. PUT /nadro/config { activo } → prende/apaga
// el cron de las 21:00 sin tocar el .env ni reiniciar el backend.
async function getConfig(req, res, next) {
  try { res.json({ activo: await configSvc.activo() }); }
  catch (e) { next(e); }
}

async function putConfig(req, res, next) {
  try { res.json(await configSvc.setActivo(!!req.body.activo)); }
  catch (e) { next(e); }
}

// Solo muestra qué se pediría hoy (EAN/cantidad ya filtrado por proveedor
// Nadro confirmado) — no toca el portal de Nadro, es de solo lectura.
async function preview(req, res, next) {
  try {
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
    const r = await pedidoSvc.pedidoDelDia(req.empresaId, fecha);
    res.json({ fecha, ...r });
  } catch (e) { next(e); }
}

// Corre el mismo flujo que el cron nocturno (arma pedido + lo coloca en
// Nadro si hay ítems) para probar bajo supervisión sin esperar a la hora
// programada. Respeta la deduplicación por día (nadro_pedidos_log): si ya
// corrió hoy, no vuelve a comprar.
async function ejecutar(req, res, next) {
  try {
    await cronSvc.correrParaEmpresa(req.empresaId);
    res.json({ ok: true, mensaje: 'Corrida disparada; revisa el resultado en el historial o por WhatsApp.' });
  } catch (e) { next(e); }
}

module.exports = { preview, ejecutar, getConfig, putConfig };
