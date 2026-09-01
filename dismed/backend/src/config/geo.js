/**
 * geo.js — Geocodificación de direcciones (Google Maps Geocoding API) y
 * distancia en línea recta (Haversine) entre dos puntos.
 *
 * Se eligió Geocoding API SOLA (sin Distance Matrix): para validar si un
 * domicilio cae dentro del radio de cobertura basta la distancia en línea
 * recta, no la distancia real por calle — evita pagar dos APIs. La
 * geocodificación de Google tiene mejor cobertura de direcciones informales
 * de México (colonias, sin número, referencias) que la alternativa gratuita
 * (Nominatim/OpenStreetMap), justo el caso de uso real aquí: el cliente
 * escribe su dirección como texto libre por WhatsApp o en el checkout web.
 *
 * Degrada de forma segura: si falta GOOGLE_MAPS_API_KEY o la llamada falla
 * por cualquier motivo (red, cuota, dirección no encontrada), geocodificar()
 * devuelve null y el llamador NO bloquea el pedido — ver cobertura.service.js.
 */
const RADIO_TIERRA_KM = 6371;

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return RADIO_TIERRA_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Geocodifica una dirección de texto libre. Devuelve { lat, lng } o null. */
async function geocodificar(direccion) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const texto = (direccion || '').trim();
  if (!apiKey || !texto) return null;

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', texto);
    url.searchParams.set('region', 'mx');
    url.searchParams.set('language', 'es');
    url.searchParams.set('key', apiKey);

    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status !== 'OK' || !data.results?.length) return null;

    const { lat, lng } = data.results[0].geometry.location;
    return { lat, lng, direccion_formateada: data.results[0].formatted_address };
  } catch (e) {
    console.error('[geo] error geocodificando dirección:', e.message);
    return null;
  }
}

module.exports = { geocodificar, haversineKm };
