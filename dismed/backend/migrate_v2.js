/**
 * Migración v2 — Ejecutar UNA SOLA VEZ en el servidor:
 *   node migrate_v2.js
 *
 * Cambios:
 *   · usuarios           → ADD puesto, jefe_id
 *   · cotizaciones_cliente → ADD concepto, contacto_id, elaborado_por_id
 *   · cotizaciones_cliente_partidas → ADD iva_exento
 *   · productos          → ADD iva_exento
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

const steps = [
  {
    name: 'usuarios — ADD puesto',
    sql: `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS
          puesto VARCHAR(100) NULL AFTER nombre`,
  },
  {
    name: 'usuarios — ADD jefe_id',
    sql: `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS
          jefe_id INT UNSIGNED NULL AFTER rol`,
  },
  {
    name: 'usuarios — FK jefe_id',
    sql: `ALTER TABLE usuarios ADD CONSTRAINT fk_usuario_jefe
          FOREIGN KEY (jefe_id) REFERENCES usuarios(id) ON UPDATE CASCADE`,
  },
  {
    name: 'cotizaciones_cliente — ADD concepto',
    sql: `ALTER TABLE cotizaciones_cliente ADD COLUMN IF NOT EXISTS
          concepto VARCHAR(200) NULL AFTER folio`,
  },
  {
    name: 'cotizaciones_cliente — ADD contacto_id',
    sql: `ALTER TABLE cotizaciones_cliente ADD COLUMN IF NOT EXISTS
          contacto_id INT UNSIGNED NULL AFTER cliente_id`,
  },
  {
    name: 'cotizaciones_cliente — ADD elaborado_por_id',
    sql: `ALTER TABLE cotizaciones_cliente ADD COLUMN IF NOT EXISTS
          elaborado_por_id INT UNSIGNED NULL AFTER contacto_id`,
  },
  {
    name: 'cotizaciones_cliente — FK contacto_id',
    sql: `ALTER TABLE cotizaciones_cliente ADD CONSTRAINT fk_cotcli_contacto
          FOREIGN KEY (contacto_id) REFERENCES clientes_contactos(id) ON UPDATE CASCADE`,
  },
  {
    name: 'cotizaciones_cliente — FK elaborado_por_id',
    sql: `ALTER TABLE cotizaciones_cliente ADD CONSTRAINT fk_cotcli_elaborado
          FOREIGN KEY (elaborado_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE`,
  },
  {
    name: 'cotizaciones_cliente_partidas — ADD iva_exento',
    sql: `ALTER TABLE cotizaciones_cliente_partidas ADD COLUMN IF NOT EXISTS
          iva_exento TINYINT(1) NOT NULL DEFAULT 0 AFTER observaciones`,
  },
  {
    name: 'productos — ADD iva_exento',
    sql: `ALTER TABLE productos ADD COLUMN IF NOT EXISTS
          iva_exento TINYINT(1) NOT NULL DEFAULT 0 AFTER stock_minimo`,
  },
];

(async () => {
  console.log('Iniciando migración v2...\n');
  for (const step of steps) {
    try {
      await pool.query(step.sql);
      console.log(`  ✓ ${step.name}`);
    } catch (err) {
      // Ignorar duplicados de FK (ya existe la constraint)
      if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_FK_DUP_NAME' ||
          err.message.includes('Duplicate key name') ||
          err.message.includes('already exists')) {
        console.log(`  ~ ${step.name} (ya existía)`);
      } else {
        console.error(`  ✗ ${step.name}: ${err.message}`);
      }
    }
  }
  console.log('\nMigración completada.');
  process.exit(0);
})();
