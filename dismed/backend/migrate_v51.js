/**
 * Migración v51 — node migrate_v51.js
 * Panel de Supervisor: pedidos pendientes de surtir, WhatsApp sin responder,
 * cierre de caja y resumen contable en una sola pantalla, más un job que
 * manda una alerta agrupada por WhatsApp cuando se rebasan umbrales
 * configurables (ver supervisor.cron.js).
 *
 * usuarios.telefono / recibe_alertas: quién recibe la alerta. Solo admins con
 * recibe_alertas=1 y telefono capturado la reciben (ver
 * supervisor.alertas.service#destinatarios).
 *
 * supervisor_umbrales: valor de cada umbral, global (sucursal_id = 0) o por
 * sucursal (override). PK compuesta (empresa_id, sucursal_id, clave) — se usa
 * 0 en vez de NULL porque MySQL/MariaDB no admite NULL en una PK. No se
 * reutiliza la tabla `configuracion` porque esa es key-value plana sin
 * empresa_id ni scope de sucursal.
 *
 * supervisor_alertas_log: última alerta enviada por empresa, identificada por
 * `firma` (hash de los ítems involucrados) para no reenviar la misma alerta
 * cada vez que corre el cron mientras nadie resuelve lo pendiente.
 *
 * Idempotente: CREATE TABLE / ADD COLUMN envueltos en run() (error -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('ALTER usuarios ADD telefono', `
    ALTER TABLE usuarios ADD COLUMN telefono VARCHAR(30) NULL AFTER email`);

  await run('ALTER usuarios ADD recibe_alertas', `
    ALTER TABLE usuarios ADD COLUMN recibe_alertas TINYINT(1) NOT NULL DEFAULT 0 AFTER telefono`);

  await run('CREATE supervisor_umbrales', `
    CREATE TABLE IF NOT EXISTS supervisor_umbrales (
      empresa_id  INT UNSIGNED NOT NULL,
      sucursal_id INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = valor global',
      clave       VARCHAR(60)  NOT NULL,
      valor       INT          NOT NULL,
      updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (empresa_id, sucursal_id, clave),
      CONSTRAINT fk_sup_umbral_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE supervisor_alertas_log', `
    CREATE TABLE IF NOT EXISTS supervisor_alertas_log (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id INT UNSIGNED NOT NULL,
      firma      VARCHAR(120) NOT NULL,
      resumen    VARCHAR(500) NULL,
      enviado_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_sup_alertas_empresa (empresa_id, enviado_en),
      CONSTRAINT fk_sup_alertas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v51 terminada.');
  process.exit(0);
})();
