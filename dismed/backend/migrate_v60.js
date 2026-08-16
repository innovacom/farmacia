/**
 * Migración v60 — node migrate_v60.js
 * usuarios.debe_cambiar_password: fuerza el cambio de contraseña en el
 * primer login del admin sembrado por seed.js (Admin1234!, documentada en
 * el README/CLAUDE.md — cualquiera con el repo la conoce). Ver
 * auth.controller.js#cambiarPassword y seed.js.
 * Idempotente: columna con IF NOT EXISTS vía try/catch (MySQL 8 no soporta
 * ADD COLUMN IF NOT EXISTS en todas las versiones del conector).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('ALTER usuarios ADD debe_cambiar_password', `
    ALTER TABLE usuarios
      ADD COLUMN debe_cambiar_password TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'fuerza pantalla de cambio de password en el siguiente login'
      AFTER password_hash`);

  console.log('\nMigración v60 terminada.');
  process.exit(0);
})();
