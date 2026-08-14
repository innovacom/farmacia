/**
 * Migración v59 — node migrate_v59.js
 * Cobro en línea con tarjeta en el catálogo público /tienda (última fase del
 * plan de tienda web). Stripe Checkout HOSPEDADO: el cliente arma el carrito
 * en el navegador, se le redirige a checkout.stripe.com y el pedido en firme
 * SOLO nace cuando el webhook confirma que el cobro se hizo — nunca antes.
 *
 * tienda_checkout_sesiones: mesa de armado, mismo papel que whatsapp_carritos
 * frente a pedidos_whatsapp (migrate_v50). Guarda el carrito YA RE-PRECIADO
 * en el servidor y los datos del invitado mientras el cliente está fuera, en
 * checkout.stripe.com. Que exista esta tabla es lo que permite: (a) no tener
 * que releer las partidas desde la API de Stripe dentro del webhook —una
 * llamada de red de más en el camino que más tiene que aguantar—, y (b) no
 * meter pedidos "pendiente de pago" en la lista que ve el mostrador. Un
 * checkout abandonado se queda aquí en 'iniciado' y nunca ensucia
 * pedidos_tienda.
 *
 * pedidos_tienda / pedidos_tienda_partidas: clon de pedidos_whatsapp SIN
 * contacto_id (el comprador es un invitado sin cuenta: nombre/teléfono/correo
 * van como snapshot en el encabezado, igual que nombre_recibe/telefono allá)
 * y SIN forma_pago (esta tabla sólo guarda pedidos ya cobrados con tarjeta en
 * línea). `lotes_json` por partida permite el reingreso EXACTO al cancelar,
 * mismo patrón que pedidos_whatsapp y pos_ventas.
 *
 * stripe_session_id UNIQUE es la llave de idempotencia del webhook: Stripe
 * entrega cada evento AL MENOS una vez y reintenta ante cualquier respuesta
 * que no sea 2xx, así que una segunda entrega del mismo
 * checkout.session.completed choca contra este índice y no descuenta
 * inventario dos veces (mismo papel exacto que pos_ventas.client_uuid,
 * migrate_v28). El INSERT del encabezado es la SEGUNDA sentencia de la
 * transacción, antes del FEFO, para que la entrega duplicada muera sin haber
 * tomado un solo lock de inventario_lotes.
 *
 * stripe_payment_intent_id: es lo que se necesita para reembolsar al cancelar
 * (stripe.refunds.create) y es el identificador con el que el personal cruza
 * un pedido contra el panel de Stripe.
 *
 * Productos con receta: NUNCA entran aquí. La tienda sólo deja pagar en línea
 * clasificacion_cofepris IN ('libre','venta_farmacia'); lo controlado se
 * sigue pidiendo por WhatsApp, como hasta hoy.
 *
 * Folio serie 'WEB' vía sp_generar_folio (la serie se auto-crea en el primer
 * uso, ver movimientos.service#genFolio) — no hay nada que sembrar.
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS envuelto en run() (error -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('CREATE tienda_checkout_sesiones', `
    CREATE TABLE IF NOT EXISTS tienda_checkout_sesiones (
      id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id         INT UNSIGNED NOT NULL,
      sucursal_id        INT UNSIGNED NOT NULL,
      stripe_session_id  VARCHAR(255) NULL COMMENT 'se llena justo despues de crear la sesion en Stripe',
      estatus            ENUM('iniciado','pagado','cancelado','expirado') NOT NULL DEFAULT 'iniciado',
      nombre_recibe      VARCHAR(150) NOT NULL,
      telefono           VARCHAR(30)  NOT NULL,
      correo             VARCHAR(150) NOT NULL,
      forma_entrega      ENUM('pickup','domicilio') NOT NULL,
      direccion_entrega  VARCHAR(500) NULL,
      costo_envio        DECIMAL(10,2) NOT NULL DEFAULT 0,
      subtotal           DECIMAL(10,2) NOT NULL DEFAULT 0,
      iva                DECIMAL(10,2) NOT NULL DEFAULT 0,
      total              DECIMAL(10,2) NOT NULL DEFAULT 0,
      items_json         JSON NOT NULL COMMENT 'carrito ya re-preciado por el servidor: producto_id, descripcion, cantidad, precio_unitario, iva_tasa, importe',
      pedido_id          INT UNSIGNED NULL COMMENT 'se llena al confirmarse el pago (igual que whatsapp_carritos.pedido_id)',
      ip                 VARCHAR(45) NULL COMMENT 'endpoint publico sin auth: unica pista para abuso/pruebas de tarjeta',
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_tck_stripe_session (stripe_session_id),
      KEY idx_tck_empresa_estatus (empresa_id, estatus),
      CONSTRAINT fk_tck_empresa  FOREIGN KEY (empresa_id)  REFERENCES empresas(id),
      CONSTRAINT fk_tck_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE pedidos_tienda', `
    CREATE TABLE IF NOT EXISTS pedidos_tienda (
      id                       INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id               INT UNSIGNED NOT NULL,
      folio                    VARCHAR(20) NOT NULL,
      checkout_id              INT UNSIGNED NULL,
      sucursal_id              INT UNSIGNED NOT NULL,
      nombre_recibe            VARCHAR(150) NOT NULL,
      telefono                 VARCHAR(30)  NOT NULL,
      correo                   VARCHAR(150) NOT NULL COMMENT 'lo verifica Stripe Checkout; es el identificador natural de un invitado sin cuenta',
      forma_entrega            ENUM('pickup','domicilio') NOT NULL,
      direccion_entrega        VARCHAR(500) NULL,
      estatus                  ENUM('pendiente','preparando','listo','en_reparto','entregado','cancelado')
                                NOT NULL DEFAULT 'pendiente',
      stripe_session_id        VARCHAR(255) NOT NULL,
      stripe_payment_intent_id VARCHAR(255) NULL COMMENT 'necesario para reembolsar al cancelar',
      costo_envio              DECIMAL(10,2) NOT NULL DEFAULT 0,
      subtotal                 DECIMAL(10,2) NOT NULL DEFAULT 0,
      iva                      DECIMAL(10,2) NOT NULL DEFAULT 0,
      total                    DECIMAL(10,2) NOT NULL DEFAULT 0,
      pagado                   TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'siempre 1 al nacer: la fila solo existe si Stripe confirmo el cobro',
      reembolsado_en           DATETIME NULL,
      reembolso_error          VARCHAR(255) NULL COMMENT 'si el reembolso automatico fallo, para que un humano lo haga a mano en el panel de Stripe',
      notas                    TEXT NULL,
      motivo_cancelacion       VARCHAR(255) NULL,
      cancelado_por            INT UNSIGNED NULL COMMENT 'NULL = cancelacion automatica del webhook (sin existencia)',
      cancelado_en             DATETIME NULL,
      entregado_en             DATETIME NULL,
      created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_pti_folio (folio),
      UNIQUE KEY uq_pti_stripe_session (stripe_session_id),
      KEY idx_pti_empresa_estatus (empresa_id, estatus),
      CONSTRAINT fk_pti_empresa       FOREIGN KEY (empresa_id)    REFERENCES empresas(id),
      CONSTRAINT fk_pti_sucursal      FOREIGN KEY (sucursal_id)   REFERENCES sucursales(id),
      CONSTRAINT fk_pti_checkout      FOREIGN KEY (checkout_id)   REFERENCES tienda_checkout_sesiones(id),
      CONSTRAINT fk_pti_cancelado_por FOREIGN KEY (cancelado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE pedidos_tienda_partidas', `
    CREATE TABLE IF NOT EXISTS pedidos_tienda_partidas (
      id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
      pedido_id        INT UNSIGNED NOT NULL,
      producto_id      INT UNSIGNED NOT NULL,
      presentacion_id  INT UNSIGNED NULL,
      descripcion      VARCHAR(300) NOT NULL,
      cantidad         DECIMAL(10,2) NOT NULL COMMENT 'siempre entero en la tienda web: Stripe factura por quantity entera',
      precio_unitario  DECIMAL(10,2) NOT NULL COMMENT 'snapshot CON IVA incluido, igual que pedidos_whatsapp_partidas',
      iva_tasa         DECIMAL(5,4) NOT NULL DEFAULT 0,
      importe          DECIMAL(10,2) NOT NULL,
      lotes_json       JSON NULL COMMENT 'lotes consumidos por FEFO, para reingreso exacto al cancelar',
      PRIMARY KEY (id),
      KEY idx_ptip_pedido (pedido_id),
      CONSTRAINT fk_ptip_pedido   FOREIGN KEY (pedido_id)   REFERENCES pedidos_tienda(id),
      CONSTRAINT fk_ptip_producto FOREIGN KEY (producto_id) REFERENCES productos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v59 terminada.');
  process.exit(0);
})();
