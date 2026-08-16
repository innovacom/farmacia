/**
 * outputUrl.service.js — Firma HMAC de corta vigencia para los enlaces a
 * /outputs (PDFs de cotización/entrega, recetas médicas, TXT/XML de CFDI).
 *
 * /outputs se sirve sin sesión (el frontend abre estos enlaces con
 * window.open, sin header Authorization), así que en vez de dejarlo público
 * sin más, cada URL que un controller entrega al cliente se firma aquí con
 * expiración corta (ver signedOutputs.js, que verifica la firma al servir
 * el archivo). Un enlace filtrado (WhatsApp, correo, logs) deja de servir
 * pasados TTL_MS en vez de ser válido para siempre.
 */
const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000; // 15 minutos

function firma(pathname, exp) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`${pathname}.${exp}`)
    .digest('base64url');
}

/** Firma una ruta que ya empieza con /outputs. Devuelve la misma ruta + query. */
function firmar(pathname) {
  const exp = Date.now() + TTL_MS;
  return `${pathname}?exp=${exp}&sig=${firma(pathname, exp)}`;
}

/** Verifica exp/sig contra la ruta solicitada. */
function verificar(pathname, exp, sig) {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() > expNum) return false;
  const esperado = firma(pathname, expNum);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Firma una ruta relativa (/outputs/...) proveniente de la BD o de un
 * generador de PDF. `absoluta: true` la antepone con BASE_URL (mismo uso
 * que antes tenía `${process.env.BASE_URL}${relativePath}`).
 */
function urlFirmada(relativePath, { absoluta = false } = {}) {
  if (!relativePath) return relativePath;
  const firmado = firmar(relativePath);
  return absoluta ? `${process.env.BASE_URL}${firmado}` : firmado;
}

module.exports = { urlFirmada, verificar };
