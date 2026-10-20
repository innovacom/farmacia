import { forwardRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';

// Selector de serie CFDI. Las opciones salen del catálogo de Configuración → Series de facturación.
// Si el registro ya tiene una serie que ya no está en el catálogo, se conserva como opción.
// forwardRef: react-hook-form (register) necesita el ref del <select> para leer el valor al guardar.
const SerieFacturacionSelect = forwardRef(function SerieFacturacionSelect(
  { vacio = 'Sin serie (usa la del sistema)', actual, ...rest }, ref,
) {
  const { data: series = [] } = useQuery({
    queryKey: ['cfdi-series'],
    queryFn: () => api.get('/configuracion/cfdi/series').then((r) => r.data),
    staleTime: 60_000,
  });
  const opciones = actual && !series.includes(actual) ? [...series, actual] : series;
  return (
    <select className="input" ref={ref} {...rest}>
      <option value="">{vacio}</option>
      {opciones.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
});

export default SerieFacturacionSelect;
