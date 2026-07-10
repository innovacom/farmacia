require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { validateEnv } = require('./config/env');
const { testConnection } = require('./config/db');

validateEnv();

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir archivos generados (PDFs de cotización)
const outputDir = process.env.OUTPUT_DIR || './outputs';
app.use('/outputs', express.static(path.resolve(outputDir)));

// Rutas
app.use('/api/auth',                   require('./modules/auth/auth.routes'));
app.use('/api/clientes',               require('./modules/clientes/clientes.routes'));
app.use('/api/proveedores',            require('./modules/proveedores/proveedores.routes'));
app.use('/api/productos',              require('./modules/productos/productos.routes'));
app.use('/api/catalogos',              require('./modules/inventario/catalogos.routes'));
app.use('/api/almacenes',              require('./modules/inventario/almacenes.routes'));
app.use('/api/inventario',             require('./modules/inventario/inventario.routes'));
app.use('/api/ventas',                 require('./modules/ventas/ventas.routes'));
app.use('/api/solicitudes',            require('./modules/solicitudes/solicitudes.routes'));
app.use('/api/cotizaciones-proveedor', require('./modules/cotizaciones/proveedor/cotprov.routes'));
app.use('/api/cotizaciones-cliente',   require('./modules/cotizaciones/cliente/cotcli.routes'));
app.use('/api/usuarios',               require('./modules/usuarios/usuarios.routes'));
app.use('/api/consultas',              require('./modules/consultas/consultas.routes'));
app.use('/api/cfdi',                   require('./modules/cfdi/cfdi.routes'));
app.use('/api/contabilidad',           require('./modules/contabilidad/contabilidad.routes'));
app.use('/api/bancos',                 require('./modules/bancos/bancos.routes'));
app.use('/api/configuracion',          require('./modules/configuracion/configuracion.routes'));
app.use('/api/herramientas',           require('./modules/herramientas/herramientas.routes'));
app.use('/api/ingestion',              require('./modules/ingestion/ingestion.routes'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3001;

testConnection().then(() => {
  app.listen(PORT, () => console.log(`🚀 DISMED API corriendo en puerto ${PORT}`));
  // Descarga masiva CFDI del SAT (día 3 mensual + reanudación horaria).
  try { require('./modules/cfdi/sat.cron').initCfdiCron(); }
  catch (e) { console.error('[cfdi] no se pudo iniciar el cron:', e.message); }
});
