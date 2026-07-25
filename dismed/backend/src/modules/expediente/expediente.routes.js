const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requirePermiso } = require('../../middleware/permisos');
const c = require('./expediente.controller');

// Datos de salud: deny-by-default también en el servidor, igual que el POS.
router.use(auth);
router.use(requirePermiso('expediente-medico'));

router.get('/pacientes',                  c.listPacientes);
router.get('/pacientes/:id',              c.getPaciente);
router.post('/pacientes',                 c.createPaciente);
router.put('/pacientes/:id',              c.updatePaciente);
router.delete('/pacientes/:id',           c.removePaciente);

router.put('/pacientes/:id/antecedentes', c.upsertAntecedentes);

router.get('/pacientes/:id/consultas',    c.listConsultas);
router.post('/pacientes/:id/consultas',   c.createConsulta);

router.get('/pacientes/:id/recetas',      c.listRecetas);
router.post('/pacientes/:id/recetas',     c.createReceta);
router.get('/recetas/:id',                c.getReceta);
router.post('/recetas/:id/generar-solicitud', c.generarSolicitud);

module.exports = router;
