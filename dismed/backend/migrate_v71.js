/**
 * Migración v71 — node migrate_v71.js
 * Publicidad en Meta (Facebook/Instagram) y TikTok directo desde el módulo
 * `tienda` — ver DISEÑO_ADS_META_TIKTOK.md. Tres piezas, todas opcionales /
 * no bloqueantes: si nada de esto se llena, la tienda funciona igual que hoy.
 *
 *  1. productos.excluir_ads — permite sacar un producto OTC puntual del feed
 *     de catálogo sin despublicarlo de /tienda.
 *  2. whatsapp_contactos.ctwa_clid — id de clic de un anuncio de "clic a
 *     WhatsApp" de Meta (llega en el `referral` del primer mensaje entrante);
 *     se guarda para poder atribuir la compra a la campaña en el evento
 *     server-side (Conversions API).
 *  3. tienda_eventos_ads — bitácora de cada evento enviado a Meta CAPI /
 *     TikTok Events API (éxito o error), para depurar por qué una campaña no
 *     muestra conversiones sin tener que adivinar.
 *
 * Idempotente: ADD COLUMN / CREATE TABLE envueltos en run() (error -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('productos +excluir_ads',
    "ALTER TABLE productos ADD COLUMN excluir_ads TINYINT(1) NOT NULL DEFAULT 0 " +
    "COMMENT 'no incluir en el feed de catálogo de Meta/TikTok aunque esté publicar_web=1'");

  await run('whatsapp_contactos +ctwa_clid',
    "ALTER TABLE whatsapp_contactos ADD COLUMN ctwa_clid VARCHAR(512) NULL " +
    "COMMENT 'click id del anuncio clic-a-WhatsApp de Meta (referral.ctwa_clid del primer mensaje)'");
  await run('whatsapp_contactos +ctwa_clid_en',
    "ALTER TABLE whatsapp_contactos ADD COLUMN ctwa_clid_en DATETIME NULL");

  await run('CREATE tienda_eventos_ads', `
    CREATE TABLE IF NOT EXISTS tienda_eventos_ads (
      id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id   INT UNSIGNED NOT NULL,
      plataforma   ENUM('meta','tiktok') NOT NULL,
      evento       VARCHAR(40) NOT NULL COMMENT 'Purchase / CompletePayment / ...',
      origen       VARCHAR(30) NOT NULL COMMENT 'stripe / whatsapp / ...',
      referencia   VARCHAR(40) NULL COMMENT 'folio del pedido',
      event_id     VARCHAR(80) NULL COMMENT 'para dedupe con el pixel de navegador',
      exito        TINYINT(1) NOT NULL DEFAULT 0,
      respuesta    VARCHAR(1000) NULL COMMENT 'cuerpo de error o resumen de la respuesta',
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_eventos_ads_empresa (empresa_id, created_at),
      CONSTRAINT fk_eventos_ads_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v71 terminada.');
  process.exit(0);
})();
