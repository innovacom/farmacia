// Enlace wa.me: abre WhatsApp (app o web) del propio empleado con el mensaje
// ya redactado. No es la API oficial (no hay envío automático ni webhook de
// respuesta) — es un puente manual mientras se define la integración con
// Meta Cloud API. Requiere que el empleado dé clic en "Enviar" dentro de WhatsApp.
export function linkWhatsApp(telefono, mensaje) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (!digitos) return null;
  // Números mexicanos guardados a 10 dígitos: anteponer lada país (52).
  const conLada = digitos.length === 10 ? `52${digitos}` : digitos;
  return `https://wa.me/${conLada}?text=${encodeURIComponent(mensaje)}`;
}

export function mensajeRecordatorioCita({ paciente_nombre, fecha, hora_inicio, servicio_descripcion }) {
  const [y, m, d] = String(fecha).slice(0, 10).split('-');
  const hora = String(hora_inicio).slice(0, 5);
  return `Hola ${paciente_nombre}, le recordamos su cita${servicio_descripcion ? ` de ${servicio_descripcion}` : ''} el ${d}/${m}/${y} a las ${hora}. `
    + `¿Confirma que asistirá? Responda CONFIRMO, o avísenos si necesita reprogramar o cancelar.`;
}
