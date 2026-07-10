/**
 * old-db.js — Conexión SOLO LECTURA a la base de datos del sistema ANTERIOR
 * (innova99_innovacom). Se usa únicamente para migración/importación histórica
 * de cotizaciones (y a futuro CFDI). NO forma parte del flujo de la app.
 *
 * Credenciales en .env como OLD_DB_*. El host es cPanel con Remote MySQL
 * restringido: hoy solo acepta la IP de desarrollo (el VPS está bloqueado por
 * firewall), por eso la EXTRACCIÓN se corre desde la máquina local.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

function createOldPool() {
  if (!process.env.OLD_DB_HOST) {
    throw new Error('OLD_DB_* no configurado en .env (sistema anterior).');
  }
  return mysql.createPool({
    host: process.env.OLD_DB_HOST,
    port: parseInt(process.env.OLD_DB_PORT, 10) || 3306,
    user: process.env.OLD_DB_USER,
    password: process.env.OLD_DB_PASSWORD,
    database: process.env.OLD_DB_NAME,
    waitForConnections: true,
    connectionLimit: 4,
    queueLimit: 0,
    charset: 'utf8mb4',
    dateStrings: true, // fechas como string, sin conversión de zona horaria
  });
}

module.exports = { createOldPool };
