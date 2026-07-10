/**
 * Migración v15 — node migrate_v15.js
 * Permisos de acceso por item de menú para usuarios operadores.
 * - Crea usuarios_permisos (usuario_id, menu_key).
 * - Siembra a los operadores EXISTENTES todos los items operables (conservan
 *   su acceso actual); los nuevos arrancan sin permisos hasta que el admin
 *   los otorgue desde Configuración. La siembra NO pisa a operadores que ya
 *   tengan permisos configurados (re-ejecutar es seguro).
 * Idempotente.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');
const { PERMISSIONABLE_KEYS } = require('./src/modules/usuarios/menu.keys');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  // usuario_id debe coincidir EXACTAMENTE con usuarios.id (INT UNSIGNED) o el FK falla.
  await run('usuarios_permisos (tabla)', `
    CREATE TABLE IF NOT EXISTS usuarios_permisos (
      usuario_id INT UNSIGNED NOT NULL,
      menu_key   VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (usuario_id, menu_key),
      CONSTRAINT fk_uperm_usuario FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Siembra: cada operador existente sin permisos aún recibe todos los operables.
  const values = PERMISSIONABLE_KEYS.map(() => 'SELECT ? AS menu_key').join(' UNION ALL ');
  await run('siembra permisos operadores existentes', `
    INSERT IGNORE INTO usuarios_permisos (usuario_id, menu_key)
    SELECT u.id, k.menu_key
      FROM usuarios u
      CROSS JOIN ( ${values} ) k
     WHERE u.rol = 'operador'
       AND NOT EXISTS (SELECT 1 FROM usuarios_permisos p WHERE p.usuario_id = u.id)`,
    PERMISSIONABLE_KEYS);

  // Verificación dura: si la tabla no quedó creada, fallar ruidosamente
  // (el helper run() captura errores; sin esto un fallo pasaría inadvertido).
  try {
    await pool.query('SELECT 1 FROM usuarios_permisos LIMIT 0');
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM usuarios_permisos');
    console.log(`\nMigración v15 terminada. usuarios_permisos OK (${n} filas).`);
    process.exit(0);
  } catch (e) {
    console.error('\nERROR: usuarios_permisos NO existe tras la migración:', e.message);
    process.exit(1);
  }
})();
