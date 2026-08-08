/**
 * supervisor.umbrales.service.js — Umbrales de alerta del Panel de Supervisor:
 * un valor GLOBAL (aplica a todas las sucursales) más un override opcional
 * por sucursal para los que tienen sentido por sucursal (pedido sin surtir,
 * diferencia de caja). El de WhatsApp sin responder y la franja horaria de
 * envío son forzosamente globales — whatsapp_mensajes no tiene sucursal_id.
 *
 * Se guardan en `supervisor_umbrales` (empresa_id, sucursal_id, clave) con
 * sucursal_id=0 para el global (MySQL/MariaDB no admite NULL en una PK). No
 * se reutiliza la tabla `configuracion`: esa es key-value plana sin
 * empresa_id ni scope de sucursal (ver src/config/precios.js).
 *
 * Cachea en memoria por empresa, igual que precios.js: carga perezosa,
 * refresco tras guardar, defaults si la tabla aún no está migrada.
 */
const { pool } = require('../../config/db');

const META = {
  pedido_sin_surtir_min:      { label: 'Pedido sin surtir',            min: 1, max: 240,    unidad: 'minutos', porSucursal: true,  default: 30 },
  whatsapp_sin_responder_min: { label: 'WhatsApp sin responder',       min: 1, max: 240,    unidad: 'minutos', porSucursal: false, default: 20 },
  diferencia_caja_pesos:      { label: 'Diferencia de caja al cierre', min: 0, max: 100000, unidad: 'pesos',   porSucursal: true,  default: 100 },
  alertas_hora_inicio:        { label: 'Alertas desde',                min: 0, max: 23,     unidad: 'hora',    porSucursal: false, default: 8 },
  alertas_hora_fin:           { label: 'Alertas hasta',                min: 0, max: 23,     unidad: 'hora',    porSucursal: false, default: 21 },
};
const CLAVES = Object.keys(META);

const cachePorEmpresa = new Map(); // empresaId -> { global, porSucursal }

async function cargar(empresaId) {
  const global = Object.fromEntries(CLAVES.map((c) => [c, META[c].default]));
  const porSucursal = {};
  try {
    const [rows] = await pool.query(
      'SELECT sucursal_id, clave, valor FROM supervisor_umbrales WHERE empresa_id = ?',
      [empresaId]
    );
    for (const r of rows) {
      if (!CLAVES.includes(r.clave)) continue;
      if (r.sucursal_id === 0) {
        global[r.clave] = r.valor;
      } else {
        porSucursal[r.sucursal_id] = porSucursal[r.sucursal_id] || {};
        porSucursal[r.sucursal_id][r.clave] = r.valor;
      }
    }
  } catch (e) {
    // Tabla aún no migrada u otro problema: se mantienen los defaults.
  }
  const estado = { global, porSucursal };
  cachePorEmpresa.set(empresaId, estado);
  return estado;
}

async function getUmbrales(empresaId) {
  if (!cachePorEmpresa.has(empresaId)) return cargar(empresaId);
  return cachePorEmpresa.get(empresaId);
}

/** Valor efectivo de una clave dado un estado ya cargado (getUmbrales). */
function resolverValor(estado, sucursalId, clave) {
  const meta = META[clave];
  if (!meta) return undefined;
  const override = sucursalId && meta.porSucursal ? estado.porSucursal[sucursalId]?.[clave] : undefined;
  return override != null ? override : estado.global[clave];
}

/** Igual que resolverValor pero cargando el estado (para usos puntuales). */
async function resolver(empresaId, sucursalId, clave) {
  const estado = await getUmbrales(empresaId);
  return resolverValor(estado, sucursalId, clave);
}

function validar(clave, valorRaw) {
  const meta = META[clave];
  const n = parseInt(valorRaw, 10);
  if (!Number.isInteger(n) || n < meta.min || n > meta.max) {
    const err = new Error(`${meta.label}: debe ser un entero entre ${meta.min} y ${meta.max}`);
    err.status = 400;
    throw err;
  }
  return n;
}

/**
 * Guarda cambios. `global` es { clave: valor }. `porSucursal` es
 * { [sucursalId]: { clave: valor|null } } — valor null/'' borra el override
 * de esa sucursal (vuelve a heredar el global). Solo se aceptan claves
 * marcadas porSucursal:true en el segundo caso.
 */
async function guardar(empresaId, { global = {}, porSucursal = {} } = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const [clave, valorRaw] of Object.entries(global)) {
      if (!META[clave]) continue;
      const valor = validar(clave, valorRaw);
      await conn.query(
        `INSERT INTO supervisor_umbrales (empresa_id, sucursal_id, clave, valor)
         VALUES (?, 0, ?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
        [empresaId, clave, valor]
      );
    }

    for (const [sucursalIdRaw, claves] of Object.entries(porSucursal)) {
      const sucursalId = Number(sucursalIdRaw);
      if (!sucursalId) continue;
      for (const [clave, valorRaw] of Object.entries(claves)) {
        const meta = META[clave];
        if (!meta || !meta.porSucursal) continue;
        if (valorRaw === null || valorRaw === '') {
          await conn.query(
            'DELETE FROM supervisor_umbrales WHERE empresa_id = ? AND sucursal_id = ? AND clave = ?',
            [empresaId, sucursalId, clave]
          );
        } else {
          const valor = validar(clave, valorRaw);
          await conn.query(
            `INSERT INTO supervisor_umbrales (empresa_id, sucursal_id, clave, valor)
             VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
            [empresaId, sucursalId, clave, valor]
          );
        }
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  cachePorEmpresa.delete(empresaId);
  return getUmbrales(empresaId);
}

module.exports = { META, CLAVES, getUmbrales, resolverValor, resolver, guardar };
