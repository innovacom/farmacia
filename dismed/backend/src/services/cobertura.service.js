/**
 * cobertura.service.js — Verifica si una dirección de entrega cae dentro del
 * radio de cobertura configurado (configuracion.radio_cobertura_km), medido
 * desde la ubicación de la sucursal (sucursales.latitud/longitud, ver
 * migrate_v56). Usado tanto por el carrito conversacional de WhatsApp
 * (whatsapp.carrito.service.js) como por el checkout web (tienda.checkout.service.js).
 *
 * Degrada de forma segura (NUNCA bloquea un pedido por un problema técnico
 * ajeno al cliente): si la sucursal no tiene coordenadas cargadas, o la
 * dirección no se pudo geocodificar (sin GOOGLE_MAPS_API_KEY, dirección
 * ambigua, falla de red), devuelve dentro=true con motivo='sin_verificar' —
 * el pedido sigue su curso normal, igual que antes de existir esta validación.
 */
const { pool } = require('../config/db');
const geo = require('../config/geo');
const cobertura = require('../config/cobertura');

async function verificarCobertura(empresaId, sucursalId, direccionTexto) {
  const [[suc]] = await pool.query(
    'SELECT latitud, longitud FROM sucursales WHERE id = ? AND empresa_id = ?',
    [sucursalId, empresaId]
  );
  if (!suc || suc.latitud == null || suc.longitud == null) {
    return { dentro: true, motivo: 'sin_verificar', distancia_km: null, radio_km: null };
  }

  const punto = await geo.geocodificar(direccionTexto);
  if (!punto) {
    return { dentro: true, motivo: 'sin_verificar', distancia_km: null, radio_km: null };
  }

  const radioKm = await cobertura.getRadioCoberturaKm();
  const distanciaKm = geo.haversineKm(Number(suc.latitud), Number(suc.longitud), punto.lat, punto.lng);
  return {
    dentro: distanciaKm <= radioKm,
    motivo: 'verificado',
    distancia_km: Math.round(distanciaKm * 10) / 10,
    radio_km: radioKm,
  };
}

module.exports = { verificarCobertura };
