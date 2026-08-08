const fs = require('fs');
const path = require('path');
const svc = require('./whatsapp.pedidos.service');
const { wrapAsync } = require('./whatsapp.util');

const listar = wrapAsync(async (req, res) => {
  res.json(await svc.listar(req.empresaId, req.query));
});

const detalle = wrapAsync(async (req, res) => {
  res.json(await svc.detalle(req.empresaId, req.params.id));
});

// Foto de receta: NUNCA estática (datos médicos del paciente) — se sirve
// autenticada y acotada por tenant, igual que cualquier otro endpoint.
const receta = wrapAsync(async (req, res) => {
  const ruta = await svc.rutaFotoReceta(req.empresaId, req.params.id);
  const absoluta = path.resolve(ruta);
  if (!fs.existsSync(absoluta)) return res.status(404).json({ error: 'La foto ya no está disponible' });
  res.sendFile(absoluta);
});

const validarReceta = wrapAsync(async (req, res) => {
  res.json(await svc.validarReceta(req.empresaId, req.params.id, { ...req.body, usuario_id: req.user.id }));
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

module.exports = { listar, detalle, receta, validarReceta, preparar, listo, reparto, entregar, cancelar };
