/**
 * Migración v50 — node migrate_v50.js
 * Pedidos en firme por WhatsApp: el cliente arma un carrito conversacional
 * (agregar/quitar/ver) y al confirmar se crea un pedido real con inventario
 * ya apartado (registrarSalidaFEFO, igual que una venta de mostrador) — sin
 * pasar por solicitud/cotización/comparador. Ver whatsapp.carrito.service.js.
 *
 * whatsapp_carritos: sesión de armado, UNA fila "abierto" por contacto
 * (dedupe la aplica el código, no un índice único, porque "abierto" cambia
 * a "cerrado"/"cancelado" y no hay UNIQUE parcial en MySQL/MariaDB).
 * `paso` gobierna el wizard post-carrito (entrega → dirección → nombre →
 * pago → confirmación); `pendiente_producto_id/pendiente_presentacion_id`
 * se usan solo durante 'esperando_cantidad' (el bot ya resolvió el producto,
 * falta la cantidad en el siguiente mensaje).
 *
 * pedidos_whatsapp / pedidos_whatsapp_partidas: snapshot de precio (igual
 * que pos_ventas_partidas) — el pedido no cambia si el catálogo cambia
 * después. `lotes_json` por partida permite reingresar EXACTO al cancelar
 * (mismo patrón que pos.ventas.service#cancelarVenta). Folio serie 'PWA'
 * vía sp_generar_folio (auto-crea la serie, ver movimientos.service#genFolio).
 *
 * Receta de controlados (decisión del usuario 2026-08-06): SÍ se permiten
 * controlados en el carrito; al confirmar, si hay alguna partida con
 * requiere_receta=1, el pedido queda con receta_estatus='pendiente' y se le
 * pide al cliente una FOTO por WhatsApp (whatsapp.client#descargarMedia). Si
 * nunca llega o no es válida, el dependiente cancela el pedido a mano desde
 * la pantalla (POS → Pedidos WhatsApp) — no hay validación automática de
 * receta, es siempre un humano quien aprueba/rechaza.
 *
 * Pago: solo efectivo/transferencia/tarjeta AL MOMENTO DE LA ENTREGA (no hay
 * cobro remoto en esta versión). Si el repartidor regresa el pedido sin
 * cobrar, el dependiente cancela y el inventario se reingresa.
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
  await run('CREATE whatsapp_carritos', `
    CREATE TABLE IF NOT EXISTS whatsapp_carritos (
      id                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id                INT UNSIGNED NOT NULL,
      contacto_id               INT UNSIGNED NOT NULL,
      sucursal_id               INT UNSIGNED NULL,
      estatus                   ENUM('abierto','confirmado','cancelado') NOT NULL DEFAULT 'abierto',
      paso                      ENUM('carrito','esperando_cantidad','esperando_entrega',
                                      'esperando_direccion','esperando_nombre','esperando_pago',
                                      'esperando_confirmacion') NOT NULL DEFAULT 'carrito',
      pendiente_producto_id     INT UNSIGNED NULL COMMENT 'producto ya resuelto, esperando cantidad',
      pendiente_presentacion_id INT UNSIGNED NULL,
      forma_entrega             ENUM('pickup','domicilio') NULL,
      direccion_entrega         VARCHAR(500) NULL,
      nombre_recibe             VARCHAR(150) NULL,
      forma_pago                ENUM('efectivo','transferencia','tarjeta') NULL,
      pedido_id                 INT UNSIGNED NULL COMMENT 'se llena al confirmar',
      created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_wa_carrito_contacto_estatus (contacto_id, estatus),
      CONSTRAINT fk_wa_carrito_empresa  FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_wa_carrito_contacto FOREIGN KEY (contacto_id) REFERENCES whatsapp_contactos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE whatsapp_carrito_items', `
    CREATE TABLE IF NOT EXISTS whatsapp_carrito_items (
      id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
      carrito_id       INT UNSIGNED NOT NULL,
      producto_id      INT UNSIGNED NOT NULL,
      presentacion_id  INT UNSIGNED NULL,
      descripcion      VARCHAR(300) NOT NULL,
      cantidad         DECIMAL(10,2) NOT NULL,
      precio_unitario  DECIMAL(10,2) NOT NULL,
      requiere_receta  TINYINT(1) NOT NULL DEFAULT 0,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_wa_citem_carrito (carrito_id),
      CONSTRAINT fk_wa_citem_carrito FOREIGN KEY (carrito_id) REFERENCES whatsapp_carritos(id),
      CONSTRAINT fk_wa_citem_producto FOREIGN KEY (producto_id) REFERENCES productos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE pedidos_whatsapp', `
    CREATE TABLE IF NOT EXISTS pedidos_whatsapp (
      id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id             INT UNSIGNED NOT NULL,
      folio                  VARCHAR(20) NOT NULL,
      contacto_id            INT UNSIGNED NOT NULL,
      carrito_id             INT UNSIGNED NULL,
      sucursal_id            INT UNSIGNED NOT NULL,
      nombre_recibe          VARCHAR(150) NOT NULL,
      telefono               VARCHAR(30) NOT NULL,
      forma_entrega          ENUM('pickup','domicilio') NOT NULL,
      direccion_entrega      VARCHAR(500) NULL,
      forma_pago             ENUM('efectivo','transferencia','tarjeta') NOT NULL,
      estatus                ENUM('pendiente','preparando','listo','en_reparto','entregado','cancelado')
                              NOT NULL DEFAULT 'pendiente',
      receta_estatus         ENUM('no_aplica','pendiente','recibida','validada','rechazada')
                              NOT NULL DEFAULT 'no_aplica',
      receta_foto_path       VARCHAR(255) NULL,
      receta_validada_por    INT UNSIGNED NULL,
      receta_validada_en     DATETIME NULL,
      receta_motivo_rechazo  VARCHAR(255) NULL,
      subtotal               DECIMAL(10,2) NOT NULL DEFAULT 0,
      iva                    DECIMAL(10,2) NOT NULL DEFAULT 0,
      total                  DECIMAL(10,2) NOT NULL DEFAULT 0,
      pagado                 TINYINT(1) NOT NULL DEFAULT 0,
      notas                  TEXT NULL,
      motivo_cancelacion     VARCHAR(255) NULL,
      cancelado_por          INT UNSIGNED NULL,
      cancelado_en           DATETIME NULL,
      entregado_en           DATETIME NULL,
      created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_pwa_folio (folio),
      KEY idx_pwa_empresa_estatus (empresa_id, estatus),
      CONSTRAINT fk_pwa_empresa   FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_pwa_contacto  FOREIGN KEY (contacto_id) REFERENCES whatsapp_contactos(id),
      CONSTRAINT fk_pwa_sucursal  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
      CONSTRAINT fk_pwa_valida_por FOREIGN KEY (receta_validada_por) REFERENCES usuarios(id),
      CONSTRAINT fk_pwa_cancelado_por FOREIGN KEY (cancelado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE pedidos_whatsapp_partidas', `
    CREATE TABLE IF NOT EXISTS pedidos_whatsapp_partidas (
      id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
      pedido_id        INT UNSIGNED NOT NULL,
      producto_id      INT UNSIGNED NOT NULL,
      presentacion_id  INT UNSIGNED NULL,
      descripcion      VARCHAR(300) NOT NULL,
      cantidad         DECIMAL(10,2) NOT NULL,
      precio_unitario  DECIMAL(10,2) NOT NULL,
      iva_tasa         DECIMAL(5,4) NOT NULL DEFAULT 0,
      importe          DECIMAL(10,2) NOT NULL,
      requiere_receta  TINYINT(1) NOT NULL DEFAULT 0,
      lotes_json       JSON NULL COMMENT 'lotes consumidos por FEFO, para reingreso exacto al cancelar',
      PRIMARY KEY (id),
      KEY idx_pwap_pedido (pedido_id),
      CONSTRAINT fk_pwap_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos_whatsapp(id),
      CONSTRAINT fk_pwap_producto FOREIGN KEY (producto_id) REFERENCES productos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v50 terminada.');
  process.exit(0);
})();
