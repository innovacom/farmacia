/**
 * Ejecutar UNA SOLA VEZ para crear la tabla usuarios y el admin inicial:
 *   node src/modules/auth/seed.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');

async function seed() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      nombre        VARCHAR(100)  NOT NULL,
      puesto        VARCHAR(100)  NULL,
      email         VARCHAR(150)  NOT NULL,
      password_hash VARCHAR(255)  NOT NULL,
      rol           ENUM('admin','operador') NOT NULL DEFAULT 'operador',
      jefe_id       INT UNSIGNED  NULL,
      activo        TINYINT(1)    NOT NULL DEFAULT 1,
      created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_email (email),
      CONSTRAINT fk_usuario_jefe FOREIGN KEY (jefe_id)
        REFERENCES usuarios(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const hash = await bcrypt.hash('Admin1234!', 10);
  await pool.query(
    `INSERT IGNORE INTO usuarios (nombre, puesto, email, password_hash, rol)
     VALUES ('Administrador', 'Administrador del Sistema', 'admin@dismed.mx', ?, 'admin')`,
    [hash]
  );

  console.log('✅ Tabla usuarios lista. Usuario inicial: admin@dismed.mx / Admin1234!');
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
