/**
 * Migración v38 — node migrate_v38.js
 * La pantalla de alta de citas no mostraba qué servicio se agendaba, así que
 * no se podía ver el costo. Se agrega el servicio (producto de la familia
 * "médico" del catálogo) a la cita, con snapshot de descripción/precio al
 * momento de agendar (igual que pos_ventas_partidas: si el precio cambia
 * después, la cita ya agendada conserva el costo que se mostró).
 *
 * Idempotente: ADD COLUMN envuelto en run() (columna ya existente -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('pos_citas +producto_id', `
    ALTER TABLE pos_citas ADD COLUMN producto_id INT UNSIGNED NULL
      COMMENT 'servicio agendado, producto de la familia médico' AFTER paciente_nombre`);
  await run('pos_citas +servicio_descripcion', `
    ALTER TABLE pos_citas ADD COLUMN servicio_descripcion VARCHAR(300) NULL
      COMMENT 'snapshot de productos.descripcion al agendar' AFTER producto_id`);
  await run('pos_citas +servicio_precio', `
    ALTER TABLE pos_citas ADD COLUMN servicio_precio DECIMAL(12,2) NULL
      COMMENT 'snapshot de productos.precio_lista al agendar' AFTER servicio_descripcion`);
  await run('fk_cita_producto', `
    ALTER TABLE pos_citas
      ADD CONSTRAINT fk_cita_producto FOREIGN KEY (producto_id) REFERENCES productos(id)`);

  console.log('\nMigración v38 terminada.');
  process.exit(0);
})();
