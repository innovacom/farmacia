const service = require('./pos.clientesfidelidad.service');

async function listar(req, res, next) {
  try {
    res.json(await service.listar(req.empresaId, req.query));
  } catch (err) { next(err); }
}

async function buscar(req, res, next) {
  try {
    res.json(await service.buscar(req.empresaId, req.query.q));
  } catch (err) { next(err); }
}

async function crear(req, res, next) {
  try {
    res.status(201).json(await service.crear(req.empresaId, req.body, req.user.id));
  } catch (err) { next(err); }
}

async function actualizar(req, res, next) {
  try {
    res.json(await service.actualizar(req.empresaId, req.params.id, req.body));
  } catch (err) { next(err); }
}

async function eliminar(req, res, next) {
  try {
    res.json(await service.eliminar(req.empresaId, req.params.id));
  } catch (err) { next(err); }
}

module.exports = { listar, buscar, crear, actualizar, eliminar };
