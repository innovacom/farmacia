const service = require('./whatsapp.config.service');
const { wrapAsync } = require('./whatsapp.util');

const get = wrapAsync(async (req, res) => {
  res.json({ saludo_bienvenida: await service.obtenerSaludo(req.empresaId) });
});

const update = wrapAsync(async (req, res) => {
  res.json(await service.actualizarSaludo(req.empresaId, req.body.saludo_bienvenida));
});

module.exports = { get, update };
