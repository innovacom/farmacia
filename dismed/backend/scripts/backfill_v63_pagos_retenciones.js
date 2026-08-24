/**
 * backfill_v63_pagos_retenciones.js — Re-parsea el XML de los CFDI con origen='sat'
 * (descargados del SAT, XML real disponible) para rellenar lo que migrate_v63 agregó
 * y que no existía cuando esos CFDI se guardaron:
 *   - cfdi_repositorio_pagos_doctos (detalle por documento de los complementos de pago)
 *   - cfdi_repositorio_conceptos.base_iva_ret / tasa_iva_ret / importe_iva_ret
 *
 * Los CFDI con origen='legacy' (import del sistema anterior) NO tienen xml_path (no
 * hay XML real que re-parsear) — quedan tal cual, sin detalle de pago ni retención de
 * IVA desglosada; sus complementos de pago no generan póliza (el motor exige el
 * detalle por documento para no adivinar a qué cartera aplica).
 *
 *   node scripts/backfill_v63_pagos_retenciones.js [--dry-run]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');
const { parseCfdi } = require('../src/modules/cfdi/cfdi.parser');

const DRY = process.argv.includes('--dry-run');
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

async function main() {
  const [rows] = await pool.query(
    `SELECT id, uuid, tipo_comprobante, xml_path FROM cfdi_repositorio
      WHERE origen='sat' AND xml_path IS NOT NULL`);
  console.log(`CFDI con XML real (origen='sat'): ${rows.length}`);

  let pagosActualizados = 0, pagosSinCambio = 0, pagosSinXml = 0;
  let conceptosActualizados = 0;
  let errores = 0;

  for (const r of rows) {
    const full = path.join(UPLOAD_DIR, r.xml_path);
    let xml;
    try { xml = fs.readFileSync(full, 'utf8'); }
    catch { pagosSinXml++; continue; }

    let parsed;
    try { parsed = parseCfdi(xml); }
    catch (e) { errores++; console.error(`  ERROR parseando ${r.uuid}: ${e.message}`); continue; }

    if (r.tipo_comprobante === 'P') {
      const [existe] = await pool.query(
        'SELECT COUNT(*) n FROM cfdi_repositorio_pagos_doctos WHERE pago_id=?', [r.id]);
      if (existe[0].n > 0) { pagosSinCambio++; continue; }
      if (!parsed.pagos_doctos || !parsed.pagos_doctos.length) { pagosSinCambio++; continue; }
      if (!DRY) {
        const values = parsed.pagos_doctos.map((d) => [
          r.id, d.uuid_documento, d.moneda_dr, d.equivalencia_dr, d.num_parcialidad,
          d.imp_saldo_ant, d.imp_pagado, d.imp_saldo_insoluto, d.objeto_imp_dr, d.importe_iva_dr,
        ]);
        await pool.query(
          `INSERT INTO cfdi_repositorio_pagos_doctos
             (pago_id, uuid_documento, moneda_dr, equivalencia_dr, num_parcialidad,
              imp_saldo_ant, imp_pagado, imp_saldo_insoluto, objeto_imp_dr, importe_iva_dr)
           VALUES ?`, [values]);
      }
      pagosActualizados++;
    } else {
      // Actualiza retención de IVA por concepto (línea a línea, mismo orden que el parser).
      for (let i = 0; i < parsed.conceptos.length; i++) {
        const cn = parsed.conceptos[i];
        if (cn.importe_iva_ret == null) continue;
        if (!DRY) {
          await pool.query(
            `UPDATE cfdi_repositorio_conceptos SET base_iva_ret=?, tasa_iva_ret=?, importe_iva_ret=?
              WHERE comprobante_id=? AND linea=?`,
            [cn.base_iva_ret, cn.tasa_iva_ret, cn.importe_iva_ret, r.id, cn.linea]);
        }
        conceptosActualizados++;
      }
    }
  }

  console.log(`\n${DRY ? '[DRY RUN] ' : ''}Resumen:`);
  console.log(`  Pagos con detalle nuevo insertado: ${pagosActualizados}`);
  console.log(`  Pagos sin cambio (ya tenían detalle, o el XML no trae DoctoRelacionado): ${pagosSinCambio}`);
  console.log(`  CFDI con XML no encontrado en disco: ${pagosSinXml}`);
  console.log(`  Renglones de concepto con retención de IVA actualizados: ${conceptosActualizados}`);
  console.log(`  Errores de parseo: ${errores}`);
  process.exit(0);
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
