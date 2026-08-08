/**
 * whatsapp.util.js — helpers de formato de teléfono compartidos entre el
 * flujo de citas (whatsapp.service.js) y la bandeja general
 * (whatsapp.contactos.service.js / whatsapp.mensajeria.service.js).
 */

// Números guardados a 10 dígitos (celular MX) → anteponer lada país 52.
function aE164(telefono) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (!digitos) return null;
  return digitos.length === 10 ? `52${digitos}` : digitos;
}

// Últimos 10 dígitos: llave real de dedupe. Meta manda los wa_id de celulares
// mexicanos con un "1" extra después del 52 (5215525201610) que aE164() no
// agrega al enviar (525525201610) — mismo celular, distinta cantidad de
// dígitos, por eso NUNCA comparar el string completo.
function ultimos10(telefono) {
  return String(telefono || '').replace(/\D/g, '').slice(-10);
}

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

// Colapsa el try/catch/next repetido en cada handler de los controllers de
// este módulo: el handler solo hace `res.json(...)` / `res.status(x).json(...)`,
// wrapAsync se encarga de mandar cualquier rechazo a next(err).
function wrapAsync(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

module.exports = { aE164, ultimos10, badRequest, wrapAsync };
