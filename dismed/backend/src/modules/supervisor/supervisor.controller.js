const svc = require('./supervisor.service');
const umbralesSvc = require('./supervisor.umbrales.service');
const alertasSvc = require('./supervisor.alertas.service');

async function panel(req, res, next) {
  try { res.json(await svc.panel(req.empresaId, req.query)); }
  catch (err) { next(err); }
}

async function getUmbrales(req, res, next) {
  try { res.json(await umbralesSvc.getUmbrales(req.empresaId)); }
  catch (err) { next(err); }
}

async function putUmbrales(req, res, next) {
  try { res.json(await umbralesSvc.guardar(req.empresaId, req.body)); }
  catch (err) { next(err); }
}

// Dispara una evaluación + envío real (forzando el reenvío aunque no haya
// cambiado nada) para poder probar el flujo completo sin esperar al cron.
async function probarAlerta(req, res, next) {
  try { res.json(await alertasSvc.enviar(req.empresaId, { forzar: true })); }
  catch (err) { next(err); }
}

// Manda un WhatsApp de prueba a los destinatarios configurados, exista o no
// una alerta real pendiente (a diferencia de /alertas/probar).
async function pruebaWhatsapp(req, res, next) {
  try { res.json(await alertasSvc.enviarPrueba(req.empresaId)); }
  catch (err) { next(err); }
}

module.exports = { panel, getUmbrales, putUmbrales, probarAlerta, pruebaWhatsapp };
