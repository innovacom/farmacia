/**
 * cfdi.repo.js — Persistencia del repositorio fiscal CFDI.
 * Inserta encabezado + conceptos de forma idempotente (UNIQUE por uuid):
 * si el UUID ya existe, no duplica.
 */
const { pool } = require('../../config/db');

const COLS_COMP = [
  'uuid', 'tipo', 'tipo_comprobante', 'version', 'serie', 'folio', 'fecha', 'fecha_timbrado',
  'rfc_emisor', 'nombre_emisor', 'regimen_fiscal_emisor', 'rfc_receptor', 'nombre_receptor',
  'uso_cfdi', 'domicilio_fiscal_receptor', 'regimen_fiscal_receptor', 'lugar_expedicion',
  'metodo_pago', 'forma_pago', 'condiciones_pago', 'moneda', 'tipo_cambio', 'subtotal',
  'descuento', 'total', 'total_impuestos_trasladados', 'total_impuestos_retenidos',
  'tipo_relacion', 'cfdi_relacionados', 'no_certificado', 'no_certificado_sat', 'pac_rfc',
  'estatus', 'origen', 'xml_path',
];
const COLS_CONC = [
  'comprobante_id', 'linea', 'clave_prod_serv', 'no_identificacion', 'cantidad', 'clave_unidad',
  'unidad', 'descripcion', 'valor_unitario', 'importe', 'descuento', 'objeto_imp',
  'base_iva', 'tasa_iva', 'importe_iva', 'base_ieps', 'tasa_ieps', 'importe_ieps',
  'base_isr', 'tasa_isr', 'importe_isr', 'codigo_interno',
];

const pick = (obj, cols) => cols.map((c) => (obj[c] === undefined ? null : obj[c]));

/**
 * Guarda un CFDI (encabezado + conceptos). Idempotente por uuid.
 * @returns {Promise<{inserted:boolean, id:number}>}
 */
async function guardarComprobante({ comprobante, conceptos }, { origen, xmlPath, estatus } = {}) {
  if (!comprobante.uuid) throw new Error('Comprobante sin UUID, no se puede guardar');
  const comp = {
    ...comprobante,
    estatus: estatus || comprobante.estatus || 'vigente',
    origen: origen || comprobante.origen || 'sat',
    xml_path: xmlPath || comprobante.xml_path || null,
  };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ex] = await conn.query('SELECT id FROM cfdi_repositorio WHERE uuid = ? FOR UPDATE', [comp.uuid]);
    if (ex.length) { await conn.commit(); return { inserted: false, id: ex[0].id }; }

    const ph = COLS_COMP.map(() => '?').join(',');
    const [r] = await conn.query(
      `INSERT INTO cfdi_repositorio (${COLS_COMP.join(',')}) VALUES (${ph})`,
      pick(comp, COLS_COMP)
    );
    const id = r.insertId;

    if (conceptos && conceptos.length) {
      const rows = conceptos.map((cn) => pick({ ...cn, comprobante_id: id }, COLS_CONC));
      const phc = '(' + COLS_CONC.map(() => '?').join(',') + ')';
      await conn.query(
        `INSERT INTO cfdi_repositorio_conceptos (${COLS_CONC.join(',')}) VALUES ${rows.map(() => phc).join(',')}`,
        rows.flat()
      );
    }
    await conn.commit();
    return { inserted: true, id };
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') {
      const [ex2] = await pool.query('SELECT id FROM cfdi_repositorio WHERE uuid = ?', [comprobante.uuid]);
      return { inserted: false, id: ex2[0]?.id };
    }
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { guardarComprobante };
