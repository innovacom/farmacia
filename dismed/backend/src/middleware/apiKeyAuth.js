/**
 * Autenticación por API key para endpoints llamados por servicios externos (n8n),
 * no por un usuario con sesión. Separado de middleware/auth.js (JWT) a propósito:
 * un webhook de ingesta no tiene req.user.
 */
function apiKeyAuth(req, res, next) {
  const expected = process.env.INGESTION_API_KEY;
  if (!expected) {
    return res.status(500).json({ error: 'INGESTION_API_KEY no está configurada en el servidor' });
  }
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'API key inválida o faltante' });
  }
  next();
}

module.exports = apiKeyAuth;
