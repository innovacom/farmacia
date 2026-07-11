/**
 * STUB — El módulo original `modules/cfdi/` (consulta CFDI del SAT + descarga
 * masiva + sat.cron) no está en el repositorio: app.js lo requiere pero el
 * directorio no se versionó, lo que impedía arrancar el backend desde esta
 * copia. Restaurar el módulo completo desde la copia de producción/OneDrive
 * y eliminar este archivo.
 */
const router = require('express').Router();
const auth = require('../../middleware/auth');

router.use(auth);
router.all('*', (req, res) => {
  res.status(501).json({
    error: 'Módulo CFDI no incluido en esta copia del código (restaurar modules/cfdi desde producción)',
  });
});

module.exports = router;
