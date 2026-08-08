/**
 * Migración v47 — node migrate_v47.js
 * Sistema de fidelidad del mostrador: alta de cliente con solo nombre +
 * teléfono (correo, fecha de nacimiento y enfermedad crónica opcionales),
 * más dos casillas (tarjeta de descuento para adultos mayores, asociado a
 * un programa de lealtad de la farmacia). Dos usos:
 *  1. Descuentos PERMANENTES por línea de producto/producto — se resuelve
 *     reusando el motor de promociones ya existente (migrate_v46): se le
 *     agrega una dimensión "requiere_cliente" a pos_promociones, en vez de
 *     construir un sistema de descuentos paralelo.
 *  2. Envíos masivos de WhatsApp de promociones — NO se crea ninguna tabla
 *     nueva de contactos ni lógica de envío: cada cliente de fidelidad se
 *     sincroniza automáticamente a whatsapp_contactos (ya existente,
 *     migrate_v42) con las etiquetas "fidelidad"/"adulto-mayor", que el
 *     selector de segmento de Envío masivo ya sabe filtrar sin cambios.
 *
 * `pos_clientes_fidelidad` es DISTINTA de `clientes` (esa es B2B: razón
 * social, RFC, hospital/clínica/laboratorio — no aplica a un paciente de
 * mostrador dado de alta solo con nombre y teléfono).
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
  await run('CREATE pos_clientes_fidelidad', `
    CREATE TABLE IF NOT EXISTS pos_clientes_fidelidad (
      id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id            INT UNSIGNED NOT NULL,
      nombre                VARCHAR(150) NOT NULL,
      telefono              VARCHAR(20)  NOT NULL,
      telefono_normalizado  CHAR(10)     NOT NULL COMMENT 'últimos 10 dígitos, mismo criterio de dedupe que whatsapp_contactos',
      correo                VARCHAR(150) NULL,
      fecha_nacimiento      DATE NULL,
      enfermedad_cronica    VARCHAR(255) NULL,
      tarjeta_adulto_mayor  TINYINT(1) NOT NULL DEFAULT 0,
      programa_lealtad      TINYINT(1) NOT NULL DEFAULT 0,
      whatsapp_contacto_id  INT UNSIGNED NULL COMMENT 'liga al contacto sincronizado en whatsapp_contactos',
      activo                TINYINT(1) NOT NULL DEFAULT 1,
      creado_por            INT UNSIGNED NULL,
      created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_fidelidad_empresa_tel (empresa_id, telefono_normalizado),
      KEY idx_fidelidad_wa (whatsapp_contacto_id),
      CONSTRAINT fk_fidelidad_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_fidelidad_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id),
      CONSTRAINT fk_fidelidad_wa_contacto FOREIGN KEY (whatsapp_contacto_id) REFERENCES whatsapp_contactos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('ADD pos_promociones.requiere_cliente', `
    ALTER TABLE pos_promociones
      ADD COLUMN requiere_cliente ENUM('nadie','adulto_mayor','programa_lealtad') NOT NULL DEFAULT 'nadie'
        COMMENT 'si no es nadie, la promoción solo aplica si la venta liga a un cliente de fidelidad con esa marca'
      AFTER tipo_alcance`);

  await run('ADD pos_ventas.cliente_fidelidad_id', `
    ALTER TABLE pos_ventas
      ADD COLUMN cliente_fidelidad_id INT UNSIGNED NULL
        COMMENT 'cliente de fidelidad ligado a la venta (para descuentos permanentes); distinto de cliente_id (B2B)'
      AFTER cliente_id`);

  await run('ADD FK pos_ventas.cliente_fidelidad_id', `
    ALTER TABLE pos_ventas
      ADD CONSTRAINT fk_venta_cliente_fidelidad FOREIGN KEY (cliente_fidelidad_id) REFERENCES pos_clientes_fidelidad(id)`);

  console.log('\nMigración v47 terminada.');
  process.exit(0);
})();
