import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart, Plus, Pencil, Trash2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';

/**
 * Clientes de fidelidad del mostrador (permiso pos-clientes-fidelidad):
 * alta rápida con solo nombre + teléfono — correo, fecha de nacimiento y
 * enfermedad crónica son opcionales. Dos usos:
 *  - Descuentos permanentes: en Promociones, una regla puede exigir
 *    "requiere cliente" (tarjeta de adulto mayor / programa de lealtad) —
 *    se resuelve automáticamente al ligar al cliente en la venta.
 *  - Envíos masivos de WhatsApp: cada alta se sincroniza sola a la libreta
 *    de contactos con las etiquetas "fidelidad"/"adulto-mayor", ya
 *    filtrables desde Envío masivo sin nada más que configurar aquí.
 */
export default function ClientesFidelidad() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // null | {} (nuevo) | cliente (editar)
  const { confirmar, dialogoConfirm } = useConfirm();

  const { data = [], isLoading } = useQuery({
    queryKey: ['pos-clientes-fidelidad', q],
    queryFn: () => api.get('/pos/clientes-fidelidad', { params: { q: q || undefined } }).then((r) => r.data),
  });

  const eliminar = useMutation({
    mutationFn: (id) => api.delete(`/pos/clientes-fidelidad/${id}`),
    onSuccess: () => { toast.success('Cliente dado de baja'); qc.invalidateQueries({ queryKey: ['pos-clientes-fidelidad'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al dar de baja'),
  });

  async function pedirEliminar(cliente) {
    if (await confirmar(`¿Dar de baja a "${cliente.nombre}"? Deja de recibir descuentos permanentes y envíos masivos.`, { titulo: 'Dar de baja' })) {
      eliminar.mutate(cliente.id);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Heart size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Clientes de fidelidad</h1>
        </div>
        <button className="btn-primary" onClick={() => setModal({})}>
          <Plus size={16} /> Nuevo cliente
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Registro para descuentos permanentes y envíos masivos de WhatsApp — solo nombre y teléfono son obligatorios.
      </p>

      <div className="card mb-4 max-w-sm">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8" placeholder="Buscar por nombre o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>Nombre</th><th>Teléfono</th><th>Correo</th>
              <th className="text-center">Adulto mayor</th><th className="text-center">Lealtad</th>
              <th className="text-center">Activo</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} className={!c.activo ? 'opacity-50' : ''}>
                <td className="font-medium text-gray-900">{c.nombre}</td>
                <td className="font-mono text-sm">{c.telefono}</td>
                <td className="text-gray-500">{c.correo || '—'}</td>
                <td className="text-center">{c.tarjeta_adulto_mayor ? <span className="badge-green">Sí</span> : '—'}</td>
                <td className="text-center">{c.programa_lealtad ? <span className="badge-green">Sí</span> : '—'}</td>
                <td className="text-center">
                  {c.activo ? <span className="badge-green">Sí</span> : <span className="badge-gray">No</span>}
                </td>
                <td>
                  <div className="flex items-center gap-1 justify-end">
                    <button className="p-1.5 text-gray-400 hover:text-brand-500 rounded-lg" title="Editar" onClick={() => setModal(c)}>
                      <Pencil size={15} />
                    </button>
                    <button className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg" title="Dar de baja" onClick={() => pedirEliminar(c)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && !data.length && (
              <tr><td colSpan={7} className="text-center text-gray-400 py-8">Sin clientes de fidelidad registrados.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <ModalCliente
          cliente={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['pos-clientes-fidelidad'] }); setModal(null); }}
        />
      )}

      {dialogoConfirm}
    </div>
  );
}

function ModalCliente({ cliente, onClose, onSaved }) {
  const editar = !!cliente;
  const [form, setForm] = useState({
    nombre: cliente?.nombre || '',
    telefono: cliente?.telefono || '',
    correo: cliente?.correo || '',
    fecha_nacimiento: cliente?.fecha_nacimiento ? String(cliente.fecha_nacimiento).slice(0, 10) : '',
    enfermedad_cronica: cliente?.enfermedad_cronica || '',
    tarjeta_adulto_mayor: cliente?.tarjeta_adulto_mayor || false,
    programa_lealtad: cliente?.programa_lealtad || false,
    activo: cliente ? !!cliente.activo : true,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const guardar = useMutation({
    mutationFn: () => (editar
      ? api.put(`/pos/clientes-fidelidad/${cliente.id}`, form)
      : api.post('/pos/clientes-fidelidad', form)),
    onSuccess: () => { toast.success(editar ? 'Cliente actualizado' : 'Cliente registrado'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  const valido = form.nombre.trim() && form.telefono.trim();

  return (
    <Modal title={editar ? 'Editar cliente' : 'Nuevo cliente de fidelidad'} onClose={onClose} size="md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Nombre</label>
            <input className="input" autoFocus value={form.nombre} onChange={(e) => set('nombre', e.target.value)} />
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input className="input" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} placeholder="10 dígitos" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Correo (opcional)</label>
            <input type="email" className="input" value={form.correo} onChange={(e) => set('correo', e.target.value)} />
          </div>
          <div>
            <label className="label">Fecha de nacimiento (opcional)</label>
            <input type="date" className="input" value={form.fecha_nacimiento} onChange={(e) => set('fecha_nacimiento', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">¿Padece alguna enfermedad crónica? (opcional)</label>
          <input className="input" value={form.enfermedad_cronica} onChange={(e) => set('enfermedad_cronica', e.target.value)}
            placeholder="Diabetes, hipertensión…" />
        </div>
        <div className="flex flex-wrap gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.tarjeta_adulto_mayor} onChange={(e) => set('tarjeta_adulto_mayor', e.target.checked)} />
            Tiene tarjeta de descuento para adultos mayores
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.programa_lealtad} onChange={(e) => set('programa_lealtad', e.target.checked)} />
            Asociado a programa de lealtad de la farmacia
          </label>
          {editar && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.activo} onChange={(e) => set('activo', e.target.checked)} />
              Activo
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!valido || guardar.isPending} onClick={() => guardar.mutate()}>
            {editar ? 'Guardar cambios' : 'Registrar cliente'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
