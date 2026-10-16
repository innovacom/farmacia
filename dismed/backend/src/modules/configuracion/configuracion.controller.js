/**
 * configuracion.controller.js — Lectura/edición de parámetros del sistema.
 * Ventanas de vigencia de precios (catálogo y web) y radio de cobertura de
 * entrega a domicilio. Lectura: cualquier usuario autenticado. Edición: solo
 * admin (ver routes).
 */
const { pool } = require('../../config/db');
const precios = require('../../config/precios');
const cobertura = require('../../config/cobertura');
const cfdiPac = require('../../config/cfdiPac');
const facturaDigital = require('../ventas/cfdi.facturadigital');

// Parámetros editables y sus límites de validación. `decimales` habilita
// valores no enteros (radio_cobertura_km admite fracciones de km).
const META = {
  vigencia_catalogo_meses: { label: 'Vigencia de precios de catálogo (meses)', min: 1, max: 120 },
  vigencia_web_meses:      { label: 'Vigencia de precios de búsqueda web (meses)', min: 1, max: 120 },
  radio_cobertura_km:      { label: 'Radio de cobertura a domicilio (km)', min: 0.1, max: 50, decimales: true },
};

/** GET /configuracion → { vigencia_catalogo_meses, vigencia_web_meses, radio_cobertura_km } */
async function get(req, res, next) {
  try {
    const vigencias = await precios.getVigencias();
    const radio_cobertura_km = await cobertura.getRadioCoberturaKm();
    res.json({ ...vigencias, radio_cobertura_km });
  } catch (err) { next(err); }
}

/** PUT /configuracion (admin) → guarda los valores enviados y devuelve el estado final. */
async function update(req, res, next) {
  try {
    const updates = {};
    for (const clave of Object.keys(META)) {
      if (req.body[clave] === undefined || req.body[clave] === '') continue;
      const { label, min, max, decimales } = META[clave];
      const n = decimales ? parseFloat(req.body[clave]) : parseInt(req.body[clave], 10);
      const valido = decimales ? Number.isFinite(n) : Number.isInteger(n);
      if (!valido || n < min || n > max) {
        return res.status(400).json({ error: `${label}: debe ser un ${decimales ? 'número' : 'entero'} entre ${min} y ${max}` });
      }
      updates[clave] = n;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No se enviaron valores válidos para actualizar' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const [clave, valor] of Object.entries(updates)) {
        await conn.query(
          `INSERT INTO configuracion (clave, valor, descripcion)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
          [clave, String(valor), META[clave].label]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    precios.aplicar(updates); // refrescar la copia en memoria
    if (updates.radio_cobertura_km != null) cobertura.aplicar(updates.radio_cobertura_km);
    const vigencias = await precios.getVigencias();
    const radio_cobertura_km = await cobertura.getRadioCoberturaKm();
    res.json({ ...vigencias, radio_cobertura_km });
  } catch (err) { next(err); }
}

async function estadoCfdi() {
  const cfg = await cfdiPac.getCfdiConfig();
  return {
    ...cfg,
    facturama_configurado: !!(process.env.FACTURAMA_URL && process.env.FACTURAMA_TOKEN),
    facturadigital_sandbox_configurado: facturaDigital.claveConfigurada(false),
    facturadigital_produccion_configurado: facturaDigital.claveConfigurada(true),
  };
}

/** GET /configuracion/cfdi (admin) → PAC y ambiente activos + qué credenciales hay en el servidor. */
async function getCfdi(req, res, next) {
  try { res.json(await estadoCfdi()); } catch (err) { next(err); }
}

/** PUT /configuracion/cfdi (admin) { pac, ambiente } */
async function putCfdi(req, res, next) {
  try {
    const { pac, ambiente } = req.body;
    if (pac !== undefined && !cfdiPac.PACS.includes(pac)) {
      return res.status(400).json({ error: 'PAC inválido (facturama o facturadigital)' });
    }
    if (ambiente !== undefined && !cfdiPac.AMBIENTES.includes(ambiente)) {
      return res.status(400).json({ error: 'Ambiente inválido (sandbox o produccion)' });
    }
    if (pac === undefined && ambiente === undefined) {
      return res.status(400).json({ error: 'No se enviaron valores para actualizar' });
    }
    const actual = await cfdiPac.getCfdiConfig();
    const pacFinal = pac ?? actual.pac;
    const ambFinal = ambiente ?? actual.ambiente;
    if (pacFinal === 'facturadigital' && !facturaDigital.claveConfigurada(ambFinal === 'produccion')) {
      return res.status(400).json({
        error: `Falta ${ambFinal === 'produccion' ? 'FACTURADIGITAL_API_KEY' : 'FACTURADIGITAL_API_KEY_SANDBOX'} en el .env del servidor`,
      });
    }
    await cfdiPac.setCfdiConfig({ pac, ambiente });
    res.json(await estadoCfdi());
  } catch (err) { next(err); }
}

/** GET /configuracion/cfdi/saldo (admin) → créditos en Factura Digital (prueba de credenciales). */
async function saldoCfdi(req, res, next) {
  try {
    const r = await facturaDigital.saldo();
    res.json({ balance: r.balance, message: r.message });
  } catch (err) { next(err); }
}

module.exports = { get, update, getCfdi, putCfdi, saldoCfdi };
