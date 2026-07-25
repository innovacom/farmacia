/**
 * Migración v34 — node migrate_v34.js
 * Módulo "Expediente Médico" (Fase 1): expediente clínico por paciente para los
 * clientes (hospitales/clínicas) de DISMED, con las funcionalidades más comunes
 * entre los sistemas mexicanos de expediente clínico electrónico (SaludTotal,
 * Nubimed, Doctoralia, Medisoft, iClinic): datos generales del paciente,
 * antecedentes (NOM-004-SSA3-2012), notas de evolución por consulta y receta
 * electrónica. Las recetas pueden ligar sus partidas al catálogo de productos
 * de DISMED, cerrando el ciclo hacia una solicitud de cotización.
 *
 * Tablas:
 * - pacientes: datos generales, propiedad de un cliente (hospital/clínica).
 * - expedientes_clinicos: antecedentes heredofamiliares y personales (1:1 con
 *   paciente) — sección exigida por la NOM-004.
 * - consultas_medicas: notas de evolución. Registro INMUTABLE por diseño (sin
 *   updated_at ni endpoint de edición): la trazabilidad/integridad de la
 *   NOM-004 se cumple no permitiendo alterar una nota ya guardada; cualquier
 *   corrección se captura como una nueva consulta.
 * - recetas_medicas / recetas_medicas_partidas: receta electrónica; cada
 *   partida puede opcionalmente apuntar a productos.id del catálogo DISMED.
 *
 * Idempotente: cada CREATE TABLE usa IF NOT EXISTS.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('pacientes', `
    CREATE TABLE IF NOT EXISTS pacientes (
      id                           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      cliente_id                   INT UNSIGNED  NOT NULL COMMENT 'Hospital/clínica dueño del expediente',
      nombre                       VARCHAR(100)  NOT NULL,
      apellido_paterno             VARCHAR(100)  NULL,
      apellido_materno             VARCHAR(100)  NULL,
      fecha_nacimiento             DATE          NULL,
      sexo                         ENUM('M','F','X') NOT NULL DEFAULT 'X',
      curp                         VARCHAR(18)   NULL,
      telefono                     VARCHAR(20)   NULL,
      email                        VARCHAR(150)  NULL,
      direccion                    TEXT          NULL,
      tipo_sangre                  VARCHAR(5)    NULL,
      alergias                     TEXT          NULL,
      contacto_emergencia_nombre   VARCHAR(150)  NULL,
      contacto_emergencia_telefono VARCHAR(20)   NULL,
      activo                       TINYINT(1)    NOT NULL DEFAULT 1,
      created_at                  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_pac_cliente (cliente_id),
      KEY idx_pac_curp (curp),
      KEY idx_pac_activo (activo),
      CONSTRAINT fk_pac_cliente FOREIGN KEY (cliente_id)
        REFERENCES clientes(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Pacientes del expediente médico, agrupados por cliente (hospital/clínica)'`);

  await run('expedientes_clinicos', `
    CREATE TABLE IF NOT EXISTS expedientes_clinicos (
      id                                      INT UNSIGNED NOT NULL AUTO_INCREMENT,
      paciente_id                             INT UNSIGNED NOT NULL,
      antecedentes_heredofamiliares           TEXT         NULL,
      antecedentes_personales_no_patologicos  TEXT         NULL,
      antecedentes_personales_patologicos     TEXT         NULL,
      created_by                              INT UNSIGNED NULL,
      updated_by                              INT UNSIGNED NULL,
      created_at                              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_exp_paciente (paciente_id),
      CONSTRAINT fk_exp_paciente FOREIGN KEY (paciente_id)
        REFERENCES pacientes(id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_exp_creador FOREIGN KEY (created_by) REFERENCES usuarios(id),
      CONSTRAINT fk_exp_editor  FOREIGN KEY (updated_by) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Antecedentes del paciente (NOM-004-SSA3-2012), 1:1 con pacientes'`);

  await run('consultas_medicas', `
    CREATE TABLE IF NOT EXISTS consultas_medicas (
      id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
      paciente_id           INT UNSIGNED NOT NULL,
      fecha_hora            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      motivo_consulta       VARCHAR(300) NULL,
      padecimiento_actual   TEXT         NULL,
      exploracion_fisica    TEXT         NULL,
      signos_vitales        JSON         NULL COMMENT 'TA, FC, FR, temperatura, peso, talla, SpO2',
      diagnostico           TEXT         NULL,
      plan_tratamiento      TEXT         NULL,
      pronostico            VARCHAR(100) NULL,
      medico_usuario_id     INT UNSIGNED NULL COMMENT 'Usuario del sistema que captura, si aplica',
      medico_nombre         VARCHAR(150) NULL COMMENT 'Nombre del médico tratante (no siempre es usuario del sistema)',
      medico_cedula         VARCHAR(20)  NULL,
      created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
        COMMENT 'Sin updated_at a propósito: nota inmutable (trazabilidad/integridad NOM-004); correcciones = nueva consulta',
      PRIMARY KEY (id),
      KEY idx_cm_paciente (paciente_id),
      KEY idx_cm_fecha (fecha_hora),
      CONSTRAINT fk_cm_paciente FOREIGN KEY (paciente_id)
        REFERENCES pacientes(id) ON UPDATE CASCADE,
      CONSTRAINT fk_cm_medico FOREIGN KEY (medico_usuario_id) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Notas de evolución por consulta, registro inmutable'`);

  await run('recetas_medicas', `
    CREATE TABLE IF NOT EXISTS recetas_medicas (
      id                      INT UNSIGNED NOT NULL AUTO_INCREMENT,
      folio                   VARCHAR(20)  NOT NULL COMMENT 'REC-2026-0001',
      paciente_id             INT UNSIGNED NOT NULL,
      consulta_id             INT UNSIGNED NULL,
      fecha                   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      medico_usuario_id       INT UNSIGNED NULL,
      medico_nombre           VARCHAR(150) NULL,
      medico_cedula           VARCHAR(20)  NULL,
      indicaciones_generales  TEXT         NULL,
      vigencia_dias           SMALLINT UNSIGNED NOT NULL DEFAULT 30,
      solicitud_id            INT UNSIGNED NULL COMMENT 'Solicitud de cotización DISMED generada a partir de esta receta',
      created_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_receta_folio (folio),
      KEY idx_rm_paciente (paciente_id),
      KEY idx_rm_consulta (consulta_id),
      KEY idx_rm_solicitud (solicitud_id),
      CONSTRAINT fk_rm_paciente FOREIGN KEY (paciente_id)
        REFERENCES pacientes(id) ON UPDATE CASCADE,
      CONSTRAINT fk_rm_consulta FOREIGN KEY (consulta_id)
        REFERENCES consultas_medicas(id) ON UPDATE CASCADE,
      CONSTRAINT fk_rm_medico FOREIGN KEY (medico_usuario_id) REFERENCES usuarios(id),
      CONSTRAINT fk_rm_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Receta electrónica'`);

  await run('recetas_medicas_partidas', `
    CREATE TABLE IF NOT EXISTS recetas_medicas_partidas (
      id                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      receta_id           INT UNSIGNED  NOT NULL,
      linea               SMALLINT UNSIGNED NOT NULL DEFAULT 1,
      producto_id         INT UNSIGNED  NULL COMMENT 'Vínculo opcional al catálogo DISMED',
      medicamento_nombre  VARCHAR(200)  NOT NULL,
      presentacion        VARCHAR(100)  NULL,
      dosis               VARCHAR(100)  NULL,
      via_administracion  VARCHAR(50)   NULL,
      frecuencia          VARCHAR(100)  NULL,
      duracion            VARCHAR(100)  NULL,
      cantidad            DECIMAL(10,2) NOT NULL DEFAULT 1,
      indicaciones        TEXT          NULL,
      PRIMARY KEY (id),
      KEY idx_rmp_receta (receta_id),
      KEY idx_rmp_producto (producto_id),
      CONSTRAINT fk_rmp_receta FOREIGN KEY (receta_id)
        REFERENCES recetas_medicas(id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_rmp_producto FOREIGN KEY (producto_id)
        REFERENCES productos(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Partidas de la receta electrónica'`);

  console.log('\nMigración v34 terminada.');
  process.exit(0);
})();
