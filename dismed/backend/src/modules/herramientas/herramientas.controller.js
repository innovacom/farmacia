const fs = require('fs');
const svc = require('./herramientas.service');

const TIPOS = ['catalogo', 'equivalencias'];

function limpiar(file) {
  if (file && file.path) { try { fs.unlinkSync(file.path); } catch { /* ignore */ } }
}

/**
 * POST /herramientas/importar/:tipo   (multipart, campo "archivo")
 *   ?dry_run=1 → solo previsualiza (columnas detectadas + muestra + estadísticas).
 */
async function importar(req, res, next) {
  const { tipo } = req.params;
  try {
    if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const dryRun = req.query.dry_run === '1' || req.body.dry_run === '1' || req.body.dry_run === true;
    if (dryRun) {
      const preview = await svc.previsualizar(req.file.path, tipo);
      return res.json(preview);
    }

    const resultado = tipo === 'catalogo'
      ? await svc.importarCatalogo(req.file.path, { vigenciaDefault: req.body.vigencia || null })
      : await svc.importarEquivalencias(req.file.path);
    res.json({ ok: true, tipo, resultado });
  } catch (err) {
    next(err);
  } finally {
    limpiar(req.file);
  }
}

/** GET /herramientas/plantilla/:tipo → descarga xlsx con encabezados + ejemplos. */
function plantilla(req, res, next) {
  try {
    const { tipo } = req.params;
    if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
    const buf = svc.plantilla(tipo);
    enviarXlsx(res, buf, `plantilla_${tipo}.xlsx`);
  } catch (err) { next(err); }
}

/** GET /herramientas/exportar/:tipo?proveedor_id= → descarga xlsx en layout de import. */
async function exportar(req, res, next) {
  try {
    const { tipo } = req.params;
    if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
    const provId = req.query.proveedor_id ? parseInt(req.query.proveedor_id, 10) : null;
    const buf = tipo === 'catalogo'
      ? await svc.exportarCatalogo(provId)
      : await svc.exportarEquivalencias(provId);
    const sufijo = provId ? `_prov${provId}` : '_todos';
    enviarXlsx(res, buf, `${tipo}${sufijo}.xlsx`);
  } catch (err) { next(err); }
}

function enviarXlsx(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

module.exports = { importar, plantilla, exportar };
