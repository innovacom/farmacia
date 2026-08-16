/**
 * signedOutputs.js — Reemplazo de express.static para /outputs.
 * Antes se servía todo el directorio de outputs (PDFs de cotización,
 * recetas médicas, TXT/XML de CFDI) sin ningún control de acceso: cualquiera
 * con la URL la descargaba para siempre. Ahora exige el par ?exp&sig emitido
 * por outputUrl.service.js al generar cada enlace; sin firma válida y vigente
 * (15 min), 403.
 */
const path = require('path');
const { verificar } = require('../services/outputUrl.service');

function servirOutputsFirmados(rootDir) {
  const root = path.resolve(rootDir);

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();

    const pathname = `/outputs${req.path}`;
    if (!verificar(pathname, req.query.exp, req.query.sig)) {
      return res.status(403).json({ error: 'Enlace inválido o expirado' });
    }

    const target = path.join(root, decodeURIComponent(req.path));
    if (target !== root && !target.startsWith(root + path.sep)) {
      return res.status(400).json({ error: 'Ruta inválida' });
    }

    res.sendFile(target, (err) => {
      if (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Archivo no encontrado' });
        next(err);
      }
    });
  };
}

module.exports = servirOutputsFirmados;
