/**
 * validarIdNumerico — Para rutas donde req.params.id se usa para construir
 * una ruta de disco (nombre de carpeta/archivo en multer.diskStorage), no
 * solo en una query parametrizada. Ahí un id no numérico (`..%2f`, etc.)
 * llega ANTES de cualquier validación de negocio, directo al filesystem.
 */
function validarIdNumerico(req, res, next) {
  if (!/^\d+$/.test(String(req.params.id))) {
    return res.status(400).json({ error: 'id inválido' });
  }
  next();
}

module.exports = validarIdNumerico;
