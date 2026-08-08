const service = require('./whatsapp.mensajeria.service');
const { wrapAsync } = require('./whatsapp.util');

const listarConversaciones = wrapAsync(async (req, res) => {
  res.json(await service.listarConversaciones(req.empresaId, req.query));
});

const listarMensajes = wrapAsync(async (req, res) => {
  res.json(await service.listarMensajes(req.empresaId, req.params.contactoId));
});

const pendientesResponder = wrapAsync(async (req, res) => {
  res.json(await service.pendientesResponder(req.empresaId));
});

const marcarLeido = wrapAsync(async (req, res) => {
  res.json(await service.marcarLeido(req.empresaId, req.params.contactoId));
});

const enviar = wrapAsync(async (req, res) => {
  res.json(await service.enviarMensajeTexto(req.empresaId, req.params.contactoId, req.body.texto, req.user.id));
});

module.exports = { listarConversaciones, listarMensajes, pendientesResponder, marcarLeido, enviar };
