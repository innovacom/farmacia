import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

// Lista de fabricantes distintos en existencias/movimientos de inventario —
// usada por los selects de filtro en Existencias.jsx y Movimientos.jsx.
export function useFabricantes() {
  const { data: fabricantes = [] } = useQuery({
    queryKey: ['fabricantes'],
    queryFn: () => api.get('/inventario/fabricantes').then((r) => r.data),
  });
  return fabricantes;
}
