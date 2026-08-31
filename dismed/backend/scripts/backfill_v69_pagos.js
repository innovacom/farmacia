/**
 * backfill_v69_pagos.js — Rellena lo que migrate_v69 agregó para los complementos de
 * pago (CFDI tipo P) ya guardados con XML real (origen='sat'):
 *   - cfdi_repositorio_pagos: un renglón por nodo <Pago> (FechaPago, Monto, forma, etc.)
 *   - cfdi_repositorio_pagos_doctos.pago_detalle_id (liga cada DoctoRelacionado a su <Pago>)
 *   - cfdi_repositorio_pagos_doctos.ret_isr_dr / ret_iva_dr / imp_ieps_dr (RetencionesDR / IEPS)
 *
 * Hasta que esto corra, generarPeriodo periodiza esos complementos por la fecha de
 * EMISIÓN (polizaPagoLegacy) y los marca "por revisar". Después de correrlo hay que
 * REGENERAR los periodos afectados (los de la FechaPago real) para que las pólizas se
 * reconstruyan con la fecha correcta.
 *
 * Los complementos con origen='legacy' (sin xml_path) no se pueden re-parsear y quedan
 * en el camino legacy.
 *
 *   node scripts/backfill_v69_pagos.js [--dry-run]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');
const { parseCfdi } = require('../src/modules/cfdi/cfdi.parser');

const DRY = process.argv.includes('--dry-run');
const OUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

// xml_path se guardó relativo a OUTPUT_DIR (sat.descarga.service#procesarPaquetesXml);
// algunos imports viejos pueden haberlo dejado relativo a UPLOAD_DIR — se prueban ambos.
function leerXml(xmlPath) {
  for (const base of [OUT_DIR, UPLOAD_DIR]) {
    try { return fs.readFileSync(path.join(base, xmlPath), 'utf8'); } catch { /* siguiente */ }
  }
  return null;
}

async function main() {
  const [rows] = await pool.query(
    `SELECT id, uuid, serie, folio, xml_path FROM cfdi_repositorio
      WHERE tipo_comprobante='P' AND origen='sat' AND xml_path IS NOT NULL
      ORDER BY id`);
  console.log(`Complementos de pago con XML real: ${rows.length}`);

  const periodosAfectados = new Set();
  let backfilled = 0, yaTenian = 0, sinXml = 0, sinPagos = 0, errores = 0;

  for (const r of rows) {
    const [[ya]] = await pool.query(
      'SELECT COUNT(*) n FROM cfdi_repositorio_pagos WHERE pago_id=?', [r.id]);
    if (ya.n > 0) { yaTenian++; continue; }

    const xml = leerXml(r.xml_path);
    if (!xml) { sinXml++; continue; }

    let parsed;
    try { parsed = parseCfdi(xml); }
    catch (e) { errores++; console.error(`  ERROR ${r.uuid}: ${e.message}`); continue; }

    if (!parsed.pagos || !parsed.pagos.length) { sinPagos++; continue; }

    for (const pg of parsed.pagos) {
      if (pg.fecha_pago) periodosAfectados.add(String(pg.fecha_pago).slice(0, 7));
    }

    if (!DRY) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM cfdi_repositorio_pagos_doctos WHERE pago_id=?', [r.id]);
        await conn.query('DELETE FROM cfdi_repositorio_pagos WHERE pago_id=?', [r.id]);

        const lineaAId = new Map();
        for (const pg of parsed.pagos) {
          const [pr] = await conn.query(
            `INSERT INTO cfdi_repositorio_pagos
               (pago_id, linea, fecha_pago, forma_pago, moneda, tipo_cambio, monto, num_operacion)
             VALUES (?,?,?,?,?,?,?,?)`,
            [r.id, pg.linea, pg.fecha_pago, pg.forma_pago, pg.moneda, pg.tipo_cambio, pg.monto, pg.num_operacion]);
          lineaAId.set(pg.linea, pr.insertId);
        }
        if (parsed.pagos_doctos && parsed.pagos_doctos.length) {
          const values = parsed.pagos_doctos.map((d) => [
            r.id, lineaAId.get(d.pago_linea) || null, d.uuid_documento, d.moneda_dr, d.equivalencia_dr,
            d.num_parcialidad, d.imp_saldo_ant, d.imp_pagado, d.imp_saldo_insoluto, d.objeto_imp_dr,
            d.importe_iva_dr, d.ret_isr_dr, d.ret_iva_dr, d.imp_ieps_dr,
          ]);
          await conn.query(
            `INSERT INTO cfdi_repositorio_pagos_doctos
               (pago_id, pago_detalle_id, uuid_documento, moneda_dr, equivalencia_dr, num_parcialidad,
                imp_saldo_ant, imp_pagado, imp_saldo_insoluto, objeto_imp_dr, importe_iva_dr,
                ret_isr_dr, ret_iva_dr, imp_ieps_dr)
             VALUES ?`, [values]);
        }
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        errores++;
        console.error(`  ERROR guardando ${r.uuid}: ${e.message}`);
        conn.release();
        continue;
      }
      conn.release();
    }
    backfilled++;
  }

  console.log(`\n${DRY ? '[DRY RUN] ' : ''}Resumen:`);
  console.log(`  Complementos con nodos <Pago> insertados: ${backfilled}`);
  console.log(`  Ya tenían el desglose (sin cambio): ${yaTenian}`);
  console.log(`  XML no encontrado en disco: ${sinXml}`);
  console.log(`  XML sin nodos <Pago>: ${sinPagos}`);
  console.log(`  Errores: ${errores}`);
  if (periodosAfectados.size) {
    console.log(`\n  Regenera estos periodos (por FechaPago) desde Contabilidad → Pólizas → Generar:`);
    console.log(`  ${[...periodosAfectados].sort().join(', ')}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
