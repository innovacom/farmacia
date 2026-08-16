/**
 * rateLimit.js — Límites de tasa para las pocas rutas sin JWT que reciben
 * tráfico anónimo: login (fuerza bruta / credential stuffing), el catálogo
 * público de la tienda (scraping / abuso de checkout) y el handshake GET del
 * webhook de WhatsApp. No se aplica a rutas autenticadas (ya filtradas por
 * JWT) ni a los webhooks POST de terceros (Stripe, WhatsApp) — esos ya
 * validan firma y bloquearlos por IP arriesga perder reintentos legítimos
 * del proveedor.
 *
 * Nota: PM2 corre en modo cluster (varios procesos Node) y el store de
 * express-rate-limit es en memoria por proceso, así que el límite real
 * efectivo es ~N× lo configurado (N = instancias). Suficiente para frenar
 * abuso; para un conteo exacto haría falta un store compartido (Redis).
 */
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // solo cuentan los intentos fallidos — un login correcto no gasta el cupo de sus compañeros de IP
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos.' },
});

// Lecturas públicas (catálogo de la tienda, handshake de webhooks).
const publicoLecturaLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' },
});

// Acciones públicas que escriben o disparan efectos externos (checkout con
// Stripe, alta de suscriptor) — límite más estricto.
const publicoEscrituraLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' },
});

module.exports = { loginLimiter, publicoLecturaLimiter, publicoEscrituraLimiter };
