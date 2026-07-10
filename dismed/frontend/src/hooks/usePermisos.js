import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

/**
 * Permisos efectivos del usuario autenticado (rol + claves de menú concedidas).
 * Se consulta a la BD (no al JWT) para que los cambios del admin apliquen al
 * recargar sin necesidad de re-login. Cacheado por React Query.
 */
export function usePermisos() {
  const token = useAuthStore((s) => s.token);
  const { data } = useQuery({
    queryKey: ['mis-permisos'],
    queryFn: () => api.get('/usuarios/me/permisos').then((r) => r.data),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  const isAdmin = data?.rol === 'admin';
  const permisos = data?.permisos || [];

  // ¿Puede acceder a este item de menú?
  const can = (item) => {
    if (!item) return true;          // ruta sin item asociado: no se bloquea
    if (item.always) return true;
    if (isAdmin) return true;
    if (item.adminOnly) return false;
    return permisos.includes(item.key);
  };

  return { isAdmin, permisos, can, ready: !!data };
}
