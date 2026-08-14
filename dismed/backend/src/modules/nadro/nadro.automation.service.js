/**
 * nadro.automation.service.js — Coloca el pedido diario en el portal de
 * clientes de Nadro (i22.nadro.mx, VTEX) por Puppeteer, imitando el flujo
 * real de "Pedidos rápidos" mapeado a mano en el navegador:
 *
 *   login (Cognito) → /quickorder/ → cerrar aviso → pegar "EAN,cantidad"
 *   (uno por línea) → Validar → Agregar al carrito → /checkout/#/cart →
 *   Proceder al Pago → /checkout/#/payment → Finalizar Compra →
 *   /checkout/orderPlaced/ (pedido real y ya facturable contra la línea de
 *   crédito Nadro de la empresa).
 *
 * NADRO_MONTO_MAXIMO_DIARIO (default 10000) es un freno de seguridad: si el
 * total del carrito ya validado supera ese monto, NO se finaliza la compra
 * — se deja reportado (ver nadro.cron.js) para revisión manual en vez de
 * comprometer dinero real sin que nadie lo haya visto. Un pedido automático
 * sin este tope es el tipo de bug que se nota hasta que llega la factura.
 *
 * Selectores capturados a mano navegando el portal real (2026-08-10):
 * login usa Cognito hosted UI con input[name=username|password] estables;
 * el resto de la SPA de VTEX no trae id/name en los controles clave, así
 * que se ubican por texto de botón (Validar / Agregar al carrito / Proceder
 * al Pago / Finalizar Compra) en vez de clases generadas que cambian con
 * cada build de VTEX.
 */
const puppeteer = require('puppeteer');
const { pool } = require('../../config/db');

const BASE_URL = 'https://i22.nadro.mx';
const MONTO_MAXIMO_DIARIO = Number(process.env.NADRO_MONTO_MAXIMO_DIARIO) || 10000;

function launchOptions() {
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote'];
  const opts = { headless: 'new', args };
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return opts;
}

async function clickByText(page, tag, text) {
  const clicked = await page.evaluate((tag, text) => {
    const norm = (s) => (s || '').trim().toLowerCase();
    const el = [...document.querySelectorAll(tag)].find((e) => norm(e.textContent) === norm(text));
    if (!el) return false;
    el.click();
    return true;
  }, tag, text);
  if (!clicked) throw new Error(`No se encontró el botón "${text}" en la página`);
}

async function waitForButtonText(page, text, timeout = 15000) {
  await page.waitForFunction(
    (text) => {
      const norm = (s) => (s || '').trim().toLowerCase();
      return [...document.querySelectorAll('button')].some((e) => norm(e.textContent) === norm(text));
    },
    { timeout },
    text
  );
}

async function login(page) {
  await page.goto(`${BASE_URL}/quickorder/`, { waitUntil: 'networkidle2' });
  if (page.url().includes('login.nadro.mx')) {
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });
    await page.type('input[name="username"]', process.env.NADRO_USUARIO, { delay: 20 });
    await page.type('input[name="password"]', process.env.NADRO_PASSWORD, { delay: 20 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }),
      page.click('button[type="submit"]'),
    ]);
  }
  if (!page.url().includes('i22.nadro.mx')) {
    throw new Error('El login de Nadro no redirigió al portal (revisar NADRO_USUARIO/NADRO_PASSWORD)');
  }
}

async function irAQuickorder(page) {
  if (!page.url().includes('/quickorder')) {
    await page.goto(`${BASE_URL}/quickorder/`, { waitUntil: 'networkidle2' });
  }
  // El aviso "¡Aviso Importante!" solo aparece si el carrito ya traía algo
  // de una sesión anterior; si no aparece en 3s se sigue sin él.
  try {
    await page.waitForSelector('.vtex-modal-layout-0-x-closeButton--modal-quick', { timeout: 3000 });
    await page.click('.vtex-modal-layout-0-x-closeButton--modal-quick');
  } catch { /* sin aviso pendiente */ }
}

async function pegarYValidar(page, items) {
  const texto = items.map((i) => `${i.ean},${i.cantidad}`).join('\n');
  await page.waitForSelector('textarea', { timeout: 10000 });
  await page.evaluate((texto) => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, texto);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, texto);

  await clickByText(page, 'button', 'Validar');
  await waitForButtonText(page, 'Agregar al carrito', 15000);

  // Filas de resultado: se identifican por el texto de la columna Estado
  // (Válido / lo que sea que Nadro use para rechazo) en orden de aparición,
  // que coincide con el orden en que se pegaron las líneas.
  const estados = await page.evaluate(() => {
    const candidatos = [...document.querySelectorAll('body *')]
      .filter((e) => e.children.length === 0 && /^(válido|inválido|sin existencia|rechazado|agotado)$/i.test((e.textContent || '').trim()));
    return candidatos.map((e) => e.textContent.trim());
  });
  return estados;
}

async function irACheckoutYFinalizar(page, { montoMaximo }) {
  await page.goto(`${BASE_URL}/checkout/#/cart`, { waitUntil: 'networkidle2' });
  await waitForButtonText(page, 'Proceder al Pago', 15000);

  const total = await page.evaluate(() => {
    const nodos = [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0);
    const idx = nodos.findIndex((e) => (e.textContent || '').trim() === 'Total');
    if (idx === -1) return null;
    for (let i = idx + 1; i < Math.min(idx + 5, nodos.length); i++) {
      const m = (nodos[i].textContent || '').match(/\$\s*([\d,]+\.?\d*)/);
      if (m) return Number(m[1].replace(/,/g, ''));
    }
    return null;
  });

  if (total != null && total > montoMaximo) {
    throw new Error(`Total del carrito ($${total}) supera el tope de seguridad NADRO_MONTO_MAXIMO_DIARIO ($${montoMaximo}) — no se finalizó la compra, revisar manualmente en Nadro`);
  }

  await clickByText(page, 'button', 'Proceder al Pago');
  await waitForButtonText(page, 'Finalizar Compra', 15000);
  await clickByText(page, 'button', 'Finalizar Compra');

  await page.waitForFunction(() => location.href.includes('orderPlaced'), { timeout: 20000 });
  return { total, ordenUrl: page.url() };
}

/**
 * items: [{ ean, cantidad, descripcion }]. Lanza si algo falla a media
 * corrida (ver nadro.cron.js, que registra el error en nadro_pedidos_log y
 * avisa por WhatsApp en vez de dejarlo pasar en silencio).
 */
async function colocarPedido(items) {
  if (!process.env.NADRO_USUARIO || !process.env.NADRO_PASSWORD) {
    throw new Error('Faltan NADRO_USUARIO / NADRO_PASSWORD en el .env');
  }
  const browser = await puppeteer.launch(launchOptions());
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    await login(page);
    await irAQuickorder(page);
    const estados = await pegarYValidar(page, items);

    const validos = estados.filter((e) => /^válido$/i.test(e)).length;
    if (estados.length !== items.length) {
      throw new Error(`Nadro devolvió ${estados.length} fila(s) de validación para ${items.length} línea(s) enviadas — no se puede confirmar el mapeo EAN↔estado con seguridad, se aborta sin agregar al carrito`);
    }
    if (validos === 0) {
      return { ok: false, motivo: 'ningún EAN válido', estados, items };
    }

    await clickByText(page, 'button', 'Agregar al carrito');
    const { total, ordenUrl } = await irACheckoutYFinalizar(page, { montoMaximo: MONTO_MAXIMO_DIARIO });

    return { ok: true, total, ordenUrl, estados, items, validos, rechazados: estados.length - validos };
  } finally {
    await browser.close();
  }
}

module.exports = { colocarPedido };
