/**
 * Migración v32 — node migrate_v32.js
 * Arqueo de caja ciego: el cajero deja de ver "efectivo esperado" al cerrar
 * turno (evita que copie la cifra sin contar). Si el conteo no cuadra se le
 * pide recontar hasta 3 veces; al tercer error se requiere una clave de
 * supervisor (solo usuarios rol=admin, clave DISTINTA a su password de
 * login) que entonces sí revela el esperado para que el cajero lo capture.
 *
 * - usuarios.clave_supervisor_hash: PIN de arqueo, solo aplica a rol=admin.
 * - pos_turnos.intentos_cierre: contador de conteos fallidos del turno abierto.
 * - pos_turnos.autorizado_por/autorizado_en: qué admin liberó el cierre tras
 *   3 fallos (auditoría; una vez liberado el cierre procede aunque no cuadre).
 *
 * Idempotente: ADD COLUMN IF NOT EXISTS.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('usuarios.clave_supervisor_hash',
    `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS clave_supervisor_hash VARCHAR(255) NULL
       COMMENT 'PIN de autorización de arqueos de caja (solo rol=admin), distinto del password de login' AFTER password_hash`);

  await run('pos_turnos.intentos_cierre',
    `ALTER TABLE pos_turnos ADD COLUMN IF NOT EXISTS intentos_cierre TINYINT UNSIGNED NOT NULL DEFAULT 0
       COMMENT 'conteos fallidos del arqueo en el turno abierto' AFTER notas_cierre`);
  await run('pos_turnos.autorizado_por',
    `ALTER TABLE pos_turnos ADD COLUMN IF NOT EXISTS autorizado_por INT UNSIGNED NULL
       COMMENT 'admin que liberó el cierre con clave de supervisor tras 3 fallos' AFTER intentos_cierre`);
  await run('pos_turnos.autorizado_en',
    `ALTER TABLE pos_turnos ADD COLUMN IF NOT EXISTS autorizado_en DATETIME NULL AFTER autorizado_por`);
  await run('fk_turno_autorizado_por',
    `ALTER TABLE pos_turnos ADD CONSTRAINT fk_turno_autorizado_por FOREIGN KEY (autorizado_por) REFERENCES usuarios(id)`);

  console.log('\nMigración v32 terminada.');
  process.exit(0);
})();
