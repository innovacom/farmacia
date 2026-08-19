/**
 * Migración v61 — node migrate_v61.js
 * Historial de pedidos unificado por cliente (Entrega 1 del plan "cuentas de
 * cliente unificadas"). `pos_clientes_fidelidad` (migrate_v47) se convierte
 * en el registro maestro de cliente para los TRES canales de venta —
 * mostrador (pos_ventas, ya ligado), WhatsApp (pedidos_whatsapp, ligado vía
 * whatsapp_contacto_id, ya existente) y tienda web (pedidos_tienda, hasta
 * hoy de invitado puro, ver migrate_v59) — sin crear una tabla de "usuarios
 * de tienda" aparte.
 *
 * `pedidos_tienda.cliente_fidelidad_id` y
 * `tienda_checkout_sesiones.cliente_fidelidad_id` quedan listos desde ya
 * para que la Entrega 2 (cuenta web con login por código de WhatsApp) los
 * llene al confirmar el pago, sin otra migración.
 *
 * `pos_clientes_fidelidad` +direccion_entrega/telefono_verificado_en/
 * ultimo_acceso_web/origen_alta: también preparación para la Entrega 2, sin
 * uso todavía en Entrega 1 (quedan NULL/default).
 *
 * Backfill: liga los pedidos de invitado YA EXISTENTES en pedidos_tienda a
 * un cliente de fidelidad, comparando los últimos 10 dígitos del teléfono
 * (mismo criterio de dedupe que pos_clientes_fidelidad.telefono_normalizado
 * y whatsapp_contactos) DENTRO de la misma empresa. Es un one-shot: de aquí
 * en adelante lo llena el webhook de Stripe (Entrega 2).
 *
 * Idempotente: ADD COLUMN / backfill envueltos en run() (error -> INFO); el
 * backfill es un UPDATE con condición `cliente_fidelidad_id IS NULL`, así
 * que correrlo dos veces no repite trabajo ni pisa nada.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { const [r] = await pool.query(sql); console.log('OK  ' + label + (r.affectedRows !== undefined ? ` (${r.affectedRows} filas)` : '')); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('pos_clientes_fidelidad +direccion_entrega',
    `ALTER TABLE pos_clientes_fidelidad ADD COLUMN IF NOT EXISTS direccion_entrega VARCHAR(500) NULL
       COMMENT 'para autollenar el checkout de la tienda web (Entrega 2)' AFTER enfermedad_cronica`);
  await run('pos_clientes_fidelidad +telefono_verificado_en',
    `ALTER TABLE pos_clientes_fidelidad ADD COLUMN IF NOT EXISTS telefono_verificado_en DATETIME NULL
       COMMENT 'cuándo confirmó el código de acceso por WhatsApp (Entrega 2); NULL = nunca accedió por la web' AFTER direccion_entrega`);
  await run('pos_clientes_fidelidad +ultimo_acceso_web',
    `ALTER TABLE pos_clientes_fidelidad ADD COLUMN IF NOT EXISTS ultimo_acceso_web DATETIME NULL AFTER telefono_verificado_en`);
  await run('pos_clientes_fidelidad +origen_alta',
    `ALTER TABLE pos_clientes_fidelidad ADD COLUMN IF NOT EXISTS origen_alta ENUM('mostrador','web') NOT NULL DEFAULT 'mostrador'
       COMMENT 'mostrador = alta por un cajero; web = se autorregistró verificando su WhatsApp (Entrega 2)' AFTER ultimo_acceso_web`);

  await run('pedidos_tienda +cliente_fidelidad_id',
    `ALTER TABLE pedidos_tienda ADD COLUMN IF NOT EXISTS cliente_fidelidad_id INT UNSIGNED NULL
       COMMENT 'cliente de fidelidad ligado al pedido, si el comprador tiene registro (por sesión web o por match de teléfono en el backfill/webhook)' AFTER checkout_id`);
  await run('pedidos_tienda +fk_cliente_fidelidad',
    `ALTER TABLE pedidos_tienda ADD CONSTRAINT fk_pti_cliente_fidelidad FOREIGN KEY (cliente_fidelidad_id) REFERENCES pos_clientes_fidelidad(id)`);
  await run('pedidos_tienda +idx_cliente_fidelidad',
    `ALTER TABLE pedidos_tienda ADD KEY idx_pti_cliente_fidelidad (cliente_fidelidad_id)`);

  await run('tienda_checkout_sesiones +cliente_fidelidad_id',
    `ALTER TABLE tienda_checkout_sesiones ADD COLUMN IF NOT EXISTS cliente_fidelidad_id INT UNSIGNED NULL
       COMMENT 'sesión de cliente logueado (Entrega 2); el webhook lo copia a pedidos_tienda al confirmar el pago' AFTER sucursal_id`);
  await run('tienda_checkout_sesiones +fk_cliente_fidelidad',
    `ALTER TABLE tienda_checkout_sesiones ADD CONSTRAINT fk_tck_cliente_fidelidad FOREIGN KEY (cliente_fidelidad_id) REFERENCES pos_clientes_fidelidad(id)`);

  await run('Backfill pedidos_tienda.cliente_fidelidad_id por teléfono',
    `UPDATE pedidos_tienda pt
       JOIN pos_clientes_fidelidad cf
         ON cf.empresa_id = pt.empresa_id
        AND cf.telefono_normalizado = RIGHT(REGEXP_REPLACE(pt.telefono, '[^0-9]', ''), 10)
     SET pt.cliente_fidelidad_id = cf.id
     WHERE pt.cliente_fidelidad_id IS NULL`);

  console.log('\nMigración v61 terminada.');
  process.exit(0);
})();
