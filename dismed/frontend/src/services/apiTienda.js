import axios from 'axios';
import { useTiendaAuth } from '../store/tiendaAuthStore';

// Cliente Axios EXCLUSIVO de /tienda — nunca el `api` de services/api.js.
// Ese otro cliente adjunta el token de STAFF a cualquier petición si hay
// sesión de ERP activa en el mismo navegador (ej. la PC del mostrador), y su
// interceptor de 401 manda a /login (el login de empleados) — un visitante
// público nunca debe verse expulsado ahí. Aquí el token es el de
// tiendaAuthStore (opcional: la mayoría de las rutas de /tienda son
// públicas y no necesitan sesión).
const apiTienda = axios.create({ baseURL: '/api' });

apiTienda.interceptors.request.use((config) => {
  const token = useTiendaAuth.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiTienda.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && useTiendaAuth.getState().token) {
      // Sesión de cliente vencida/inválida: se limpia sola. No se redirige
      // (a diferencia del ERP) — la mayoría de las pantallas de /tienda
      // siguen siendo usables sin sesión (catálogo, carrito de invitado).
      useTiendaAuth.getState().logout();
    }
    return Promise.reject(err);
  }
);

export default apiTienda;
