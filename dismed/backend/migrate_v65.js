/**
 * Migración v65 — node migrate_v65.js
 * Contabilidad: identidad por RFC en cuentas auxiliares (nivel 3).
 *
 * Diagnóstico en producción (2026-08-25, tras regenerar pólizas ene-jul 2026):
 * de 5 RFC de clientes distintos que facturaron en el periodo, solo 2 tenían
 * fila correspondiente en `clientes` con ese RFC — los otros 3 (Distribuidora
 * Pharma Pax, Casa Terra Pax, Comercializadora ERAC) no están dados de alta en
 * el catálogo de clientes, así que nunca generaban auxiliar (se quedaban en el
 * bote genérico de la subcuenta). Mismo problema en proveedores: de ~conteo,
 * la enorme mayoría de las cuentas por pagar no matchean ningún RFC de
 * `proveedores` (943 proveedores en catálogo, solo 2 con RFC capturado).
 *
 * Fix: el auxiliar ya NO depende de que la entidad esté dada de alta en el
 * catálogo de clientes/proveedores — se identifica por el RFC del CFDI
 * (siempre presente, es un campo obligatorio del comprobante). Si además hay
 * un cliente/proveedor con ese RFC en el catálogo, se guarda su id como dato
 * de referencia (para futuro enlace desde la UI), pero deja de ser la llave.
 *
 * También corrige un caso real: Petróleos Mexicanos tiene 9 filas distintas en
 * `clientes` (una por hospital/plantel) que comparten el MISMO RFC
 * PME380607P35 — correctamente deben caer en UN solo auxiliar (misma persona
 * moral ante el SAT). Con la llave anterior (entidad_tipo+entidad_id+padre) el
 * id "ganador" dependía del orden no garantizado de la consulta SELECT (sin
 * ORDER BY) y podía cambiar entre corridas, arriesgando duplicar el auxiliar
 * de Pemex si el id cambiaba. Con RFC como llave esto no puede pasar.
 *
 * cuentas_auxiliares.rfc VARCHAR(13) NULL (NULL solo en altas manuales, que no
 * representan una entidad con RFC). Nueva UNIQUE (entidad_tipo, rfc,
 * cuenta_padre). Se retira la UNIQUE anterior sobre entidad_id (ix_entidad NO
 * únique se deja para lookups). Backfill: a los 3 auxiliares ya creados
 * (2 clientes + 1 proveedor) se les asigna el RFC de la entidad que tienen
 * ligada por entidad_id.
 *
 * Idempotente: ADD COLUMN/INDEX IF NOT EXISTS (MariaDB), backfill solo llena
 * NULLs.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('cuentas_auxiliares.rfc',
    "ALTER TABLE cuentas_auxiliares ADD COLUMN IF NOT EXISTS rfc VARCHAR(13) NULL " +
    "COMMENT 'RFC de la entidad (identidad real ante el SAT); NULL solo en altas manuales' " +
    "AFTER entidad_id");

  await run('cuentas_auxiliares: backfill rfc desde clientes', `
    UPDATE cuentas_auxiliares a
      JOIN clientes c ON c.id = a.entidad_id
       SET a.rfc = UPPER(TRIM(c.rfc))
     WHERE a.entidad_tipo='cliente' AND a.rfc IS NULL AND c.rfc IS NOT NULL AND c.rfc<>''
  `);
  await run('cuentas_auxiliares: backfill rfc desde proveedores', `
    UPDATE cuentas_auxiliares a
      JOIN proveedores p ON p.id = a.entidad_id
       SET a.rfc = UPPER(TRIM(p.rfc))
     WHERE a.entidad_tipo='proveedor' AND a.rfc IS NULL AND p.rfc IS NOT NULL AND p.rfc<>''
  `);

  // Quita la unicidad vieja (el id de catálogo ya no es la llave de identidad)
  // y agrega la nueva sobre RFC. DROP INDEX no tiene forma "IF EXISTS" portable
  // en MariaDB < 10.6 para índices con nombre — se ignora el error si ya no existe.
  await run('cuentas_auxiliares: quitar UNIQUE vieja (entidad_id)',
    'ALTER TABLE cuentas_auxiliares DROP INDEX uq_entidad_padre');
  await run('cuentas_auxiliares: UNIQUE (entidad_tipo, rfc, cuenta_padre)',
    'ALTER TABLE cuentas_auxiliares ADD UNIQUE KEY uq_rfc_padre (entidad_tipo, rfc, cuenta_padre)');

  const [[r]] = await pool.query(
    'SELECT COUNT(*) n, SUM(rfc IS NOT NULL) con_rfc FROM cuentas_auxiliares');
  console.log(`INFO cuentas_auxiliares: ${r.n} filas, ${r.con_rfc} con rfc`);

  console.log('\nMigración v65 terminada.');
  process.exit(0);
})();
