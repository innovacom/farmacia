import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

const STORAGE_KEY = 'expediente_turno_id';

// Turno de consultorio activo (médico + sucursal/almacén) para la sesión del
// navegador. Se persiste en localStorage para sobrevivir navegación entre
// Pacientes y el detalle de un paciente sin volver a elegir.
export function useTurnoActivo() {
  const qc = useQueryClient();
  const [turnoId, setTurnoId] = useState(() => {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? Number(v) : null;
  });

  const { data: turnos = [], isLoading } = useQuery({
    queryKey: ['expediente-turnos-abiertos'],
    queryFn: () => api.get('/expediente/turnos').then((r) => r.data),
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!isLoading && turnoId && !turnos.some((t) => t.id === turnoId)) {
      setTurnoId(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [turnos, turnoId, isLoading]);

  function seleccionar(id) {
    setTurnoId(id);
    if (id) localStorage.setItem(STORAGE_KEY, String(id));
    else localStorage.removeItem(STORAGE_KEY);
  }

  const abrirMut = useMutation({
    mutationFn: ({ medico_id, sucursal_id }) => api.post('/expediente/turnos/abrir', { medico_id, sucursal_id }),
    onSuccess: (r) => {
      qc.invalidateQueries(['expediente-turnos-abiertos']);
      seleccionar(r.data.id);
    },
  });

  const cerrarMut = useMutation({
    mutationFn: (id) => api.post(`/expediente/turnos/${id}/cerrar`),
    onSuccess: () => {
      qc.invalidateQueries(['expediente-turnos-abiertos']);
      seleccionar(null);
    },
  });

  const turno = turnos.find((t) => t.id === turnoId) || null;

  return { turno, turnos, isLoading, seleccionar, abrirMut, cerrarMut };
}
