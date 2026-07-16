// Catálogo canónico de items de menú sujetos a permiso para operadores.
// Debe mantenerse en sincronía con el frontend (src/config/menu.js).
// NO incluye items siempre visibles (ayuda, preferencias) ni admin-only
// (usuarios, descargas-sat): esos no se otorgan/quitan a operadores.
const PERMISSIONABLE_KEYS = [
  'dashboard',
  'clientes', 'solicitudes', 'cotizaciones', 'pedidos',
  'existencias', 'movimientos', 'almacenes', 'productos', 'proveedores',
  'catalogo-proveedor', 'catalogos-apoyo', 'carga-facturas',
  'consultas', 'cfdi',
  'contabilidad-estado-resultados', 'contabilidad-balance-general', 'contabilidad-balanza',
  'contabilidad-catalogo-cuentas', 'contabilidad-polizas', 'contabilidad-bancos',
  'contabilidad-cfdi-por-comprobante', 'contabilidad-cfdi-resumen-general',
  'herramientas-importar', 'herramientas-exportar',
  'pos-venta', 'pos-turnos', 'pos-bitacora', 'pos-admin',
];

module.exports = { PERMISSIONABLE_KEYS };
