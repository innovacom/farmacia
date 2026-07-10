/**
 * capturar_pantallas.js — Captura pantallas reales del sistema con Puppeteer para el manual.
 * Guarda PNG en frontend/public/ayuda/ (se sirven en /ayuda/<archivo>.png).
 *
 * Uso:
 *   APP_URL=https://sistema.innovacom.mx APP_USER=correo APP_PASS=clave node capturar_pantallas.js
 * Sin APP_USER/APP_PASS solo captura la pantalla de login (pública).
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const URL = (process.env.APP_URL || 'https://sistema.innovacom.mx').replace(/\/+$/, '');
const USER = process.env.APP_USER || '';
const PASS = process.env.APP_PASS || '';
const outDir = path.resolve(__dirname, '../frontend/public/ayuda');
fs.mkdirSync(outDir, { recursive: true });

// Pantallas a capturar tras iniciar sesión: [archivo, ruta, esperaSelector?]
const PANTALLAS = [
  ['dashboard.png',   '/dashboard'],
  ['solicitudes.png', '/solicitudes'],
  ['cotizaciones.png','/cotizaciones'],
  ['pedidos.png',     '/ventas/pedidos'],
  ['clientes.png',    '/clientes'],
  ['productos.png',   '/productos'],
  ['consultas.png',   '/consultas'],
  ['ayuda.png',       '/ayuda'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

    // Login (pública)
    await page.goto(`${URL}/login`, { waitUntil: 'networkidle2' });
    await sleep(800);
    await page.screenshot({ path: path.join(outDir, 'login.png') });
    console.log('OK login.png');

    if (!USER || !PASS) {
      console.log('Sin APP_USER/APP_PASS: solo se capturó el login. Define las credenciales para el resto.');
      return;
    }

    await page.type('input[type=email]', USER, { delay: 10 });
    await page.type('input[type=password]', PASS, { delay: 10 });
    await Promise.all([
      page.click('button[type=submit]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);
    await sleep(1500);
    if (/\/login/.test(page.url())) {
      console.log('No se pudo iniciar sesión (credenciales inválidas). Revisa APP_USER/APP_PASS.');
      return;
    }

    for (const [file, route] of PANTALLAS) {
      try {
        await page.goto(`${URL}${route}`, { waitUntil: 'networkidle2' });
        await sleep(1400);
        await page.screenshot({ path: path.join(outDir, file) });
        console.log('OK', file);
      } catch (e) { console.log('ERR', file, e.message); }
    }
    console.log('\nCapturas en', outDir);
  } finally {
    await browser.close();
    process.exit(0);
  }
})();
