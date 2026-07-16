/**
 * productos.pricing.js — Reglas de precio/vendible compartidas entre productos.controller.js
 * (alta/edición manual) y facturas.controller.js (captura de precio al recibir un producto
 * nuevo por carga automática de factura). Una sola fuente de verdad para no divergir.
 */

// Sin precio público real (vacío/0), se trata como "sin tope" — así la regla
// legal (precio_lista <= precio_publico) nunca rompe con datos incompletos.
const PRECIO_PUBLICO_SIN_TOPE = 999999.99;
function normalizarPrecioPublico(v) {
  if (v === undefined || v === null || v === '' || Number(v) === 0) return PRECIO_PUBLICO_SIN_TOPE;
  return v;
}

// Por disposición legal: el precio de lista (venta) nunca puede exceder al precio público.
function validarPrecios(precioLista, precioPublico) {
  if (precioLista == null || precioPublico == null) return null;
  if (Number(precioLista) > Number(precioPublico)) {
    return 'El precio de lista no puede ser mayor al precio público (disposición legal)';
  }
  return null;
}

// Sin precio de venta > 0 no se puede vender (POS/cotizaciones).
const tienePrecioLista = (v) => v !== undefined && v !== null && v !== '' && Number(v) > 0;

module.exports = { PRECIO_PUBLICO_SIN_TOPE, normalizarPrecioPublico, validarPrecios, tienePrecioLista };
