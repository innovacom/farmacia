const service = require('./tienda.cuenta.service');
const { resolverEmpresaUnica } = require('../../config/empresa');

async function empresaOFallar(res) {
  const empresaId = await resolverEmpresaUnica();
  if (!empresaId) { res.status(503).json({ error: 'Servicio no disponible' }); return null; }
  return empresaId;
}

async function solicitarCodigo(req, res, next) {
  try {
    const empresaId = await empresaOFallar(res);
    if (!empresaId) return;
    await service.solicitarCodigo(empresaId, req.body?.telefono, req.ip);
    // Mensaje siempre igual, exista o no el teléfono — ver docblock del service.
    res.json({ ok: true, mensaje: 'Si el número es válido, te enviamos un código por WhatsApp.' });
  } catch (err) { next(err); }
}

async function verificarCodigo(req, res, next) {
  try {
    const empresaId = await empresaOFallar(res);
    if (!empresaId) return;
    const resultado = await service.verificarCodigo(empresaId, req.body || {}, req.ip);
    res.json(resultado);
  } catch (err) { next(err); }
}

async function perfil(req, res, next) {
  try { res.json(await service.perfil(req.cliente.empresa_id, req.cliente.id)); }
  catch (err) { next(err); }
}

async function actualizarPerfil(req, res, next) {
  try { res.json(await service.actualizarPerfil(req.cliente.empresa_id, req.cliente.id, req.body || {})); }
  catch (err) { next(err); }
}

async function pedidos(req, res, next) {
  try { res.json(await service.pedidos(req.cliente.empresa_id, req.cliente.id)); }
  catch (err) { next(err); }
}

async function detallePedido(req, res, next) {
  try {
    res.json(await service.detallePedido(req.cliente.empresa_id, req.cliente.id, req.params.origen, req.params.id));
  } catch (err) { next(err); }
}

module.exports = { solicitarCodigo, verificarCodigo, perfil, actualizarPerfil, pedidos, detallePedido };
