const router = require('express').Router();
const auth = require('../../middleware/auth');
const tenant = require('../../middleware/tenant');
const { requirePermiso } = require('../../middleware/permisos');
const c = require('./expediente.controller');

// Datos de salud: deny-by-default también en el servidor, igual que el POS.
// tenant resuelve req.empresaId (el expediente es del negocio de farmacia
// con consultorio, no de la distribuidora — ver migrate_v35).
router.use(auth, tenant);
router.use(requirePermiso('expediente-medico'));

// Turnos de consultorio (médico + sucursal/almacén activos)
router.get('/turnos',            c.listTurnosAbiertos);
router.post('/turnos/abrir',     c.abrirTurno);
router.post('/turnos/:id/cerrar', c.cerrarTurno);

// Medicamentos disponibles en la sucursal del turno (existencias reales)
router.get('/medicamentos/buscar', c.buscarMedicamentos);

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

module.exports = router;
