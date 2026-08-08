/**
 * Migración v46 — node migrate_v46.js
 * Promociones automáticas del mostrador (pos.promociones.service.js): el
 * admin configura reglas de % de descuento por alcance (todos los productos,
 * familia, categoría, subcategoría, o un conjunto de productos elegidos a
 * mano) con vigencia por día de la semana y/o rango de fechas. Se aplican
 * SOLAS en el carrito (el cajero no hace nada) — ver
 * pos.ventas.service.js#crearVenta, que llama a
 * pos.promociones.service.js#descuentosPara.
 *
 * Reglas duras del resolver (decididas con el usuario, no configurables):
 * una promoción de alcance 'todos' nunca toca la familia MEDICO (el médico
 * se sigue quedando con su costo completo, ver repartoMedicoFarmacia en
 * pos.turnos.service.js); ningún producto que requiera receta
 * (clasificacion_cofepris fuera de libre/venta_farmacia) recibe descuento
 * automático nunca, sin importar el alcance.
 *
 * `promocion_id` en pos_ventas_partidas es mutuamente excluyente con
 * motivo_cambio_precio (migrate_v45): si el cajero edita el precio a mano,
 * esa línea no recibe además un descuento automático.
 *
 * Idempotente: cada sentencia envuelta en run() (error -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('CREATE pos_promociones', `
    CREATE TABLE IF NOT EXISTS pos_promociones (
      id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id      INT UNSIGNED NOT NULL,
      nombre          VARCHAR(120) NOT NULL,
      porcentaje      DECIMAL(5,2) NOT NULL COMMENT '0 < pct <= 100, validado también en el service',
      tipo_alcance    ENUM('todos','familia','categoria','subcategoria','productos') NOT NULL,
      alcance_id      INT UNSIGNED NULL COMMENT 'familia_id/categoria_id/subcategoria_id según tipo_alcance; NULL si todos/productos',
      dias_semana     TINYINT UNSIGNED NOT NULL DEFAULT 0
        COMMENT 'bitmask 1=lunes(bit0)..7=domingo(bit6), misma convención que sucursal_horarios.dia_semana (v43); 0 = todos los días',
      vigencia_desde  DATE NULL,
      vigencia_hasta  DATE NULL,
      activo          TINYINT(1) NOT NULL DEFAULT 1,
      creado_por      INT UNSIGNED NULL,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_promo_vigente (empresa_id, activo, vigencia_desde, vigencia_hasta),
      CONSTRAINT fk_promo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_promo_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE pos_promocion_productos', `
    CREATE TABLE IF NOT EXISTS pos_promocion_productos (
      empresa_id   INT UNSIGNED NOT NULL,
      promocion_id INT UNSIGNED NOT NULL,
      producto_id  INT UNSIGNED NOT NULL,
      PRIMARY KEY (promocion_id, producto_id),
      KEY idx_promo_prod (producto_id),
      CONSTRAINT fk_pp_promocion FOREIGN KEY (promocion_id) REFERENCES pos_promociones(id),
      CONSTRAINT fk_pp_producto  FOREIGN KEY (producto_id)  REFERENCES productos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('ADD pos_ventas_partidas.promocion_id', `
    ALTER TABLE pos_ventas_partidas
      ADD COLUMN promocion_id INT UNSIGNED NULL
        COMMENT 'NULL si no hubo promoción o si la línea se editó a mano (mutuamente excluyente con motivo_cambio_precio)'
      AFTER motivo_cambio_precio`);

  await run('ADD FK pos_ventas_partidas.promocion_id', `
    ALTER TABLE pos_ventas_partidas
      ADD CONSTRAINT fk_partida_promocion FOREIGN KEY (promocion_id) REFERENCES pos_promociones(id)`);

  console.log('\nMigración v46 terminada.');
  process.exit(0);
})();
