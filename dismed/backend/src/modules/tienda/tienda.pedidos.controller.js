const svc = require('./tienda.pedidos.service');

// Mismo helper que whatsapp.util.js#wrapAsync — copiado en vez de importado
// entre módulos para no acoplar tienda/ con whatsapp/ por 3 líneas.
function wrapAsync(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const listar = wrapAsync(async (req, res) => {
  res.json(await svc.listar(req.empresaId, req.query));
});

const detalle = wrapAsync(async (req, res) => {
  res.json(await svc.detalle(req.empresaId, req.params.id));
});

const cambiarA = (estatus) => wrapAsync(async (req, res) => {
  res.json(await svc.cambiarEstatus(req.empresaId, req.params.id, estatus));
});
const preparar = cambiarA('preparando');
const listo = cambiarA('listo');
const reparto = cambiarA('en_reparto');

const entregar = wrapAsync(async (req, res) => {
  res.json(await svc.entregar(req.empresaId, req.params.id));
});

const cancelar = wrapAsync(async (req, res) => {
  res.json(await svc.cancelar(req.empresaId, req.params.id, { motivo: req.body?.motivo, usuario_id: req.user.id }));
});

module.exports = { listar, detalle, preparar, listo, reparto, entregar, cancelar };
