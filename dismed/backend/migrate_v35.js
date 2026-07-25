/**
 * Migración v35 — node migrate_v35.js
 * Corrige la orientación del módulo Expediente Médico (v34): el paciente NO
 * pertenece a un cliente de la distribuidora (clientes = hospitales/clínicas
 * que compran insumos al mayoreo, un negocio totalmente distinto). El
 * expediente médico es parte del negocio de FARMACIA CON CONSULTORIO, que ya
 * tiene su propia infraestructura desde migrate_v28 (POS Farmacia):
 * `empresas` (tenant), `medicos`, `sucursales` 1:1 con `almacenes`.
 *
 * Cambios:
 * - pacientes: fuera cliente_id -> dentro empresa_id (tenant) + medico_id
 *   (médico que da de alta, catálogo `medicos` ya existente).
 * - expediente_turnos: "apertura de caja" pero para el consultorio — el
 *   médico (o quien opera el sistema por él) abre turno eligiendo en qué
 *   sucursal/almacén está atendiendo. Sin arqueo (aquí no hay efectivo);
 *   mismo candado de "un turno abierto a la vez" que pos_turnos, aquí por
 *   médico en vez de por caja.
 * - consultas_medicas / recetas_medicas: +empresa_id, +medico_id (FK
 *   catálogo, reemplaza el texto libre/usuario logueado de v34), +turno_id
 *   (de qué turno salió — ahí vive la sucursal para acotar existencias).
 * - recetas_medicas: se quita solicitud_id/FK (el cierre de ciclo hacia
 *   `solicitudes` de la distribuidora no aplica en este negocio; se retira
 *   sin reemplazo por ahora, ver conversación 2026-07-25).
 *
 * Idempotente: cada ALTER/CREATE envuelto en run() (error -> INFO, no falla).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  // ── pacientes: cliente_id (distribuidora) -> empresa_id + medico_id ────
  await run('pacientes +empresa_id', `
    ALTER TABLE pacientes ADD COLUMN empresa_id INT UNSIGNED NULL AFTER id`);
  await run('backfill pacientes.empresa_id = 1',
    `UPDATE pacientes SET empresa_id = 1 WHERE empresa_id IS NULL`);
  await run('pacientes +medico_id', `
    ALTER TABLE pacientes ADD COLUMN medico_id INT UNSIGNED NULL
      COMMENT 'Médico que da de alta / médico de cabecera' AFTER empresa_id`);
  await run('pacientes DROP FK cliente', `ALTER TABLE pacientes DROP FOREIGN KEY fk_pac_cliente`);
  await run('pacientes DROP COLUMN cliente_id', `ALTER TABLE pacientes DROP COLUMN cliente_id`);
  await run('FK pacientes.empresa_id', `
    ALTER TABLE pacientes ADD CONSTRAINT fk_pac_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)`);
  await run('FK pacientes.medico_id', `
    ALTER TABLE pacientes ADD CONSTRAINT fk_pac_medico FOREIGN KEY (medico_id) REFERENCES medicos(id)`);
  await run('idx pacientes.empresa_id', `ALTER TABLE pacientes ADD KEY idx_pac_empresa (empresa_id)`);
  await run('idx pacientes.medico_id', `ALTER TABLE pacientes ADD KEY idx_pac_medico (medico_id)`);

  // ── expediente_turnos: apertura de turno de consultorio ────────────────
  await run('expediente_turnos', `
    CREATE TABLE IF NOT EXISTS expediente_turnos (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id  INT UNSIGNED NOT NULL,
      medico_id   INT UNSIGNED NOT NULL,
      sucursal_id INT UNSIGNED NOT NULL,
      usuario_id  INT UNSIGNED NOT NULL COMMENT 'quien abre el turno (recepción/enfermería/el propio médico)',
      estatus     ENUM('abierto','cerrado') NOT NULL DEFAULT 'abierto',
      abierto_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cerrado_en  DATETIME NULL,
      abierto_unico TINYINT AS (IF(estatus = 'abierto', 1, NULL)) STORED,
      PRIMARY KEY (id),
      UNIQUE KEY uq_expturno_abierto (medico_id, abierto_unico),
      KEY idx_expturno_sucursal (sucursal_id),
      CONSTRAINT fk_expturno_empresa  FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_expturno_medico   FOREIGN KEY (medico_id) REFERENCES medicos(id),
      CONSTRAINT fk_expturno_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
      CONSTRAINT fk_expturno_usuario  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Turno de consultorio: médico + sucursal activos (sin arqueo, aquí no hay efectivo)'`);

  // ── consultas_medicas: +empresa_id, +medico_id (catálogo), +turno_id ───
  await run('consultas_medicas +empresa_id', `
    ALTER TABLE consultas_medicas ADD COLUMN empresa_id INT UNSIGNED NULL AFTER id`);
  await run('backfill consultas_medicas.empresa_id = 1',
    `UPDATE consultas_medicas SET empresa_id = 1 WHERE empresa_id IS NULL`);
  await run('consultas_medicas +medico_id', `
    ALTER TABLE consultas_medicas ADD COLUMN medico_id INT UNSIGNED NULL AFTER medico_usuario_id`);
  await run('consultas_medicas +turno_id', `
    ALTER TABLE consultas_medicas ADD COLUMN turno_id INT UNSIGNED NULL AFTER paciente_id`);
  await run('FK consultas_medicas.empresa_id', `
    ALTER TABLE consultas_medicas ADD CONSTRAINT fk_cm_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)`);
  await run('FK consultas_medicas.medico_id', `
    ALTER TABLE consultas_medicas ADD CONSTRAINT fk_cm_medico2 FOREIGN KEY (medico_id) REFERENCES medicos(id)`);
  await run('FK consultas_medicas.turno_id', `
    ALTER TABLE consultas_medicas ADD CONSTRAINT fk_cm_turno FOREIGN KEY (turno_id) REFERENCES expediente_turnos(id)`);

  // ── recetas_medicas: +empresa_id, +medico_id (catálogo), +turno_id ─────
  //    fuera solicitud_id (el cierre de ciclo hacia `solicitudes` de la
  //    distribuidora no aplica en este negocio).
  await run('recetas_medicas +empresa_id', `
    ALTER TABLE recetas_medicas ADD COLUMN empresa_id INT UNSIGNED NULL AFTER id`);
  await run('backfill recetas_medicas.empresa_id = 1',
    `UPDATE recetas_medicas SET empresa_id = 1 WHERE empresa_id IS NULL`);
  await run('recetas_medicas +medico_id', `
    ALTER TABLE recetas_medicas ADD COLUMN medico_id INT UNSIGNED NULL AFTER medico_usuario_id`);
  await run('recetas_medicas +turno_id', `
    ALTER TABLE recetas_medicas ADD COLUMN turno_id INT UNSIGNED NULL AFTER paciente_id`);
  await run('FK recetas_medicas.empresa_id', `
    ALTER TABLE recetas_medicas ADD CONSTRAINT fk_rm_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)`);
  await run('FK recetas_medicas.medico_id', `
    ALTER TABLE recetas_medicas ADD CONSTRAINT fk_rm_medico2 FOREIGN KEY (medico_id) REFERENCES medicos(id)`);
  await run('FK recetas_medicas.turno_id', `
    ALTER TABLE recetas_medicas ADD CONSTRAINT fk_rm_turno FOREIGN KEY (turno_id) REFERENCES expediente_turnos(id)`);
  await run('recetas_medicas DROP FK solicitud', `ALTER TABLE recetas_medicas DROP FOREIGN KEY fk_rm_solicitud`);
  await run('recetas_medicas DROP COLUMN solicitud_id', `ALTER TABLE recetas_medicas DROP COLUMN solicitud_id`);

  console.log('\nMigración v35 terminada.');
  process.exit(0);
})();
