import api from './api';

/**
 * Descarga un endpoint que responde con un archivo (blob) usando el token JWT
 * del interceptor de Axios, y dispara la descarga en el navegador.
 */
export async function descargarArchivo(url, nombreDefault = 'archivo', params) {
  const r = await api.get(url, { responseType: 'blob', params });

  // Respeta el nombre que mande el backend en Content-Disposition si existe.
  let nombre = nombreDefault;
  const cd = r.headers['content-disposition'];
  const m = cd && /filename="?([^"]+)"?/.exec(cd);
  if (m) nombre = m[1];

  const blobUrl = window.URL.createObjectURL(new Blob([r.data]));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(blobUrl);
}
