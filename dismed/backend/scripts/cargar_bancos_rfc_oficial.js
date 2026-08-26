/**
 * cargar_bancos_rfc_oficial.js — Carga el catálogo OFICIAL completo de bancos
 * que operan en México (RFC + clave SPEI/Banxico + razón social), entregado
 * por el usuario 2026-08-25 (fuente: Banco de México / catálogo de
 * instituciones participantes en SPEI). A diferencia del catálogo cargado en
 * migrate_v20 (solo nombre_corto/razón social, sin RFC ni clave completos),
 * este SÍ trae ambos — la `clave` es el identificador oficial del banco ante
 * Banxico usado en las claves de rastreo SPEI (el mismo que `bancos.clave_sat`
 * ya usaba para los pocos bancos que la tenían capturada).
 *
 * Por cada banco de scripts/bancos_rfc_oficial.json:
 *   - Si ya existe una fila en `bancos` con ese clave_sat → actualiza rfc y
 *     razon_social (conserva id, descripcion, cuenta_contable_codigo,
 *     predeterminado — datos que el usuario haya configurado a mano).
 *   - Si no existe → la inserta (nombre_corto=corto, activo=1).
 *
 *   node scripts/cargar_bancos_rfc_oficial.js
 *
 * Idempotente (UPDATE/INSERT por clave_sat, que es UNIQUE-friendly aunque no
 * tenga constraint UNIQUE formal — se usa como llave de negocio).
 */
require('dotenv').config();
const path = require('path');
const { pool } = require('../src/config/db');

(async () => {
  const bancos = require(path.resolve(__dirname, 'bancos_rfc_oficial.json'));
  let actualizados = 0, insertados = 0;

  for (const b of bancos) {
    // Primero por clave_sat (llave más confiable); si no hay match, por
    // nombre_corto (evita duplicar una fila que ya existía sin clave capturada
    // — chocaría con la UNIQUE de nombre_corto al insertar).
    let [existe] = await pool.query('SELECT id FROM bancos WHERE clave_sat=?', [b.clave]);
    if (!existe.length) {
      [existe] = await pool.query('SELECT id FROM bancos WHERE UPPER(TRIM(nombre_corto))=?', [b.corto.toUpperCase().trim()]);
    }
    if (existe.length) {
      await pool.query(
        'UPDATE bancos SET clave_sat=?, rfc=?, razon_social=? WHERE id=?',
        [b.clave, b.rfc, b.razon_social, existe[0].id]);
      actualizados++;
    } else {
      await pool.query(
        `INSERT INTO bancos (clave_sat, nombre_corto, razon_social, rfc, activo)
         VALUES (?,?,?,?,1)`,
        [b.clave, b.corto, b.razon_social, b.rfc]);
      insertados++;
    }
  }

  console.log(`Catálogo de bancos: ${actualizados} actualizados, ${insertados} insertados (de ${bancos.length} en el archivo).`);
  const [[total]] = await pool.query("SELECT COUNT(*) n, SUM(rfc IS NOT NULL AND rfc<>'') con_rfc FROM bancos");
  console.log(`Tabla bancos: ${total.n} filas totales, ${total.con_rfc} con RFC.`);
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
