const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '-06:00',
  charset: 'utf8mb4',
});

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL conectado a', process.env.DB_HOST);
    conn.release();
  } catch (err) {
    console.error('❌ Error de conexión MySQL:', err.message);
    process.exit(1);
  }
}

module.exports = { pool, testConnection };
