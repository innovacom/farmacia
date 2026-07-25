import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Stethoscope, Warehouse, LogOut, ChevronDown } from 'lucide-react';
import api from '../../services/api';

/**
 * Barra de turno de consultorio: qué médico está en servicio y en qué
 * sucursal/almacén (de ahí salen las existencias que se pueden recetar).
 * Sin esto abierto no se puede dar de alta un paciente ni emitir una receta.
 */
export default function TurnoBar({ turnoState }) {
  const { turno, turnos, seleccionar, abrirMut, cerrarMut } = turnoState;
  const [abriendo, setAbriendo] = useState(false);
  const [medicoId, setMedicoId] = useState('');
  const [sucursalId, setSucursalId] = useState('');

  const { data: medicos = [] } = useQuery({
    queryKey: ['medicos'],
    queryFn: () => api.get('/pos/medicos', { params: { admin: '1' } }).then((r) => r.data),
  });
  const { data: sucursales = [] } = useQuery({
    queryKey: ['pos-sucursales'],
    queryFn: () => api.get('/pos/sucursales').then((r) => r.data),
  });

  async function abrir(e) {
    e.preventDefault();
    if (!medicoId || !sucursalId) return;
    try {
      await abrirMut.mutateAsync({ medico_id: Number(medicoId), sucursal_id: Number(sucursalId) });
      toast.success('Turno abierto');
      setAbriendo(false);
      setMedicoId(''); setSucursalId('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo abrir el turno');
    }
  }

  async function cerrar() {
    try {
      await cerrarMut.mutateAsync(turno.id);
      toast.success('Turno cerrado');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cerrar el turno');
    }
  }

  if (turno) {
    return (
      <div className="flex items-center justify-between gap-3 bg-brand-50 border border-brand-100 rounded-lg px-4 py-2.5 mb-5 text-sm">
        <div className="flex items-center gap-2 text-brand-700">
          <Stethoscope size={16} />
          <span className="font-medium">{turno.medico_nombre}</span>
          <span className="text-brand-400">·</span>
          <Warehouse size={14} />
          <span>{turno.sucursal_nombre}</span>
        </div>
        <div className="flex items-center gap-3">
          {turnos.length > 1 && (
            <button onClick={() => seleccionar(null)} className="text-xs text-brand-600 hover:underline">
              Cambiar turno
            </button>
          )}
          <button onClick={cerrar} className="flex items-center gap-1 text-xs text-red-500 hover:underline">
            <LogOut size={13} /> Cerrar turno
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5">
      {turnos.length > 0 && !abriendo ? (
        <div>
          <p className="text-sm text-amber-800 mb-2">Elige con qué turno abierto quieres trabajar:</p>
          <div className="flex flex-wrap gap-2">
            {turnos.map((t) => (
              <button
                key={t.id}
                onClick={() => seleccionar(t.id)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-300 bg-white hover:bg-amber-100"
              >
                <Stethoscope size={13} /> {t.medico_nombre} · {t.sucursal_nombre}
              </button>
            ))}
            <button onClick={() => setAbriendo(true)} className="text-xs px-3 py-1.5 rounded-lg text-amber-700 hover:underline">
              + Abrir otro turno
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={abrir} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-amber-800">Médico en servicio</label>
            <select className="input mt-1" value={medicoId} onChange={(e) => setMedicoId(e.target.value)} required>
              <option value="">Selecciona…</option>
              {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-amber-800">Sucursal / almacén</label>
            <select className="input mt-1" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} required>
              <option value="">Selecciona…</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <button type="submit" disabled={abrirMut.isPending} className="btn-primary">
            Abrir turno
          </button>
          {turnos.length > 0 && (
            <button type="button" onClick={() => setAbriendo(false)} className="btn-secondary">
              Cancelar
            </button>
          )}
        </form>
      )}
    </div>
  );
}
