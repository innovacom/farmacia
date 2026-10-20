import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Loader2, MapPin, Merge } from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import SerieFacturacionSelect from '../../components/shared/SerieFacturacionSelect';

const mxn = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export default function SucursalesModal({ cliente, clientes, onClose }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(null); // null = lista, {} = nueva, {id,..} = editar
  const [fusion, setFusion] = useState(false);
  const [destinoId, setDestinoId] = useState('');
  const { register, handleSubmit, reset } = useForm();

  const { data: sucursales = [], isLoading } = useQuery({
    queryKey: ['sucursales', cliente.id],
    queryFn: () => api.get(`/clientes/${cliente.id}/sucursales`).then((r) => r.data),
  });

  function refrescar() {
    qc.invalidateQueries(['sucursales', cliente.id]);
    qc.invalidateQueries(['clientes']);
  }

  const guardarMut = useMutation({
    mutationFn: (d) => editando.id
      ? api.put(`/clientes/${cliente.id}/sucursales/${editando.id}`, d)
      : api.post(`/clientes/${cliente.id}/sucursales`, d),
    onSuccess: () => {
      toast.success('Sucursal guardada');
      refrescar(); setEditando(null); reset();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  const activoMut = useMutation({
    mutationFn: (s) => api.put(`/clientes/${cliente.id}/sucursales/${s.id}`, { activo: s.activo ? 0 : 1 }),
    onSuccess: refrescar,
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const fusionarMut = useMutation({
    mutationFn: ({ forzar }) =>
      api.post(`/clientes/${cliente.id}/fusionar`, { destino_id: Number(destinoId), forzar }),
    onSuccess: () => {
      toast.success('Cliente fusionado como sucursal');
      qc.invalidateQueries(['clientes']);
      onClose();
    },
    onError: (e) => {
      const d = e.response?.data;
      if (d?.requiere_forzar && window.confirm(`${d.error}\n\n¿Fusionar de todos modos?`)) {
        fusionarMut.mutate({ forzar: true });
        return;
      }
      toast.error(d?.error || 'Error al fusionar');
    },
  });

  function abrir(s) {
    setEditando(s);
    reset(s.id ? s : {});
  }

  const candidatos = clientes.filter((c) => c.id !== cliente.id && c.activo);

  return (
    <Modal title={`Sucursales — ${cliente.razon_social}`} onClose={onClose}>
      {editando ? (
        <form onSubmit={handleSubmit((d) => guardarMut.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Nombre de la sucursal *</label>
              <input className="input" placeholder="Hospital Regional de Salamanca"
                {...register('nombre', { required: true })} />
            </div>
            <div>
              <label className="label">Clave / centro de costo</label>
              <input className="input" {...register('clave')} />
            </div>
            <div>
              <label className="label">Teléfono</label>
              <input className="input" {...register('telefono')} />
            </div>
            <div className="col-span-2">
              <label className="label">Dirección de entrega</label>
              <textarea className="input min-h-[60px]" {...register('direccion_entrega')} />
            </div>
            <div>
              <label className="label">C.P.</label>
              <input className="input" maxLength={5} {...register('codigo_postal')} />
            </div>
            <div />
            <div>
              <label className="label">Límite de crédito propio (MXN)</label>
              <input type="number" min="0" step="0.01" className="input"
                placeholder="Vacío = solo aplica el del cliente" {...register('limite_credito')} />
            </div>
            <div>
              <label className="label">Días de crédito propios</label>
              <input type="number" min="0" className="input"
                placeholder={`Vacío = hereda ${cliente.dias_credito ?? 0}`} {...register('dias_credito')} />
            </div>
            <div className="col-span-2">
              <label className="label">Serie de facturación</label>
              <SerieFacturacionSelect actual={editando.serie_facturacion}
                vacio={`Vacío = la del cliente${cliente.serie_facturacion ? ` (${cliente.serie_facturacion})` : ''}`}
                {...register('serie_facturacion')} />
            </div>
            <div className="col-span-2">
              <label className="label">Notas</label>
              <textarea className="input min-h-[50px]" {...register('notas')} />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={guardarMut.isPending} className="btn-primary">
              {guardarMut.isPending && <Loader2 size={15} className="animate-spin" />} Guardar
            </button>
            <button type="button" className="btn-secondary" onClick={() => { setEditando(null); reset(); }}>
              Volver
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            RFC {cliente.rfc} · Crédito del cliente: {mxn(cliente.limite_credito || 0)} / {cliente.dias_credito || 0} días.
            Cada sucursal puede tener su propio tope; el del cliente es el consolidado. En el Excel de solicitud, escribe el ID de la sucursal en la celda B3 (código de cliente).
          </p>

          {isLoading ? (
            <p className="text-sm text-gray-400 text-center py-6">Cargando…</p>
          ) : (
            <table className="table-auto w-full">
              <thead>
                <tr><th>ID</th><th>Sucursal</th><th>Entrega</th><th>Serie</th><th className="text-right">Crédito propio</th><th /></tr>
              </thead>
              <tbody>
                {sucursales.map((s) => (
                  <tr key={s.id} className={!s.activo ? 'opacity-50' : ''}>
                    <td className="font-mono text-xs" title="Ponlo en la celda B3 del Excel para identificar esta sucursal">{s.id}</td>
                    <td>
                      <p className="font-medium">{s.nombre}</p>
                      {s.es_matriz ? <span className="badge-gray">Matriz</span> : null}
                    </td>
                    <td className="text-xs text-gray-500 max-w-[220px]">
                      {s.direccion_entrega && <><MapPin size={11} className="inline mr-1" />{s.direccion_entrega}</>}
                    </td>
                    <td className="text-xs font-mono">
                      {s.serie_facturacion || <span className="text-gray-400" title="Hereda la del cliente">{cliente.serie_facturacion || '—'}</span>}
                    </td>
                    <td className="text-right text-xs">
                      {s.limite_credito != null ? mxn(s.limite_credito) : '—'}
                      {s.dias_credito != null ? ` · ${s.dias_credito} d` : ''}
                    </td>
                    <td>
                      <div className="flex gap-3 justify-end">
                        <button className="text-xs text-brand-500 hover:underline" onClick={() => abrir(s)}>Editar</button>
                        {!s.es_matriz && (
                          <button className="text-xs text-red-400 hover:underline" onClick={() => activoMut.mutate(s)}>
                            {s.activo ? 'Desactivar' : 'Reactivar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <button className="btn-primary" onClick={() => abrir({})}>
            <Plus size={16} /> Nueva sucursal
          </button>

          <div className="border-t border-gray-100 pt-4">
            {!fusion ? (
              <button className="text-xs text-gray-500 hover:underline" onClick={() => setFusion(true)}>
                <Merge size={12} className="inline mr-1" />
                Este cliente en realidad es una sucursal de otro… fusionar
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-600">
                  «{cliente.razon_social}» pasará a ser una sucursal del cliente que elijas, con todo su
                  historial (solicitudes, cotizaciones, pedidos, contactos y SKUs). Este cliente quedará inactivo.
                </p>
                <select className="input" value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
                  <option value="">Cliente destino…</option>
                  {candidatos.map((c) => (
                    <option key={c.id} value={c.id}>{c.razon_social} — {c.rfc}</option>
                  ))}
                </select>
                <div className="flex gap-3">
                  <button className="btn-primary" disabled={!destinoId || fusionarMut.isPending}
                    onClick={() => fusionarMut.mutate({ forzar: false })}>
                    {fusionarMut.isPending && <Loader2 size={15} className="animate-spin" />} Fusionar
                  </button>
                  <button className="btn-secondary" onClick={() => setFusion(false)}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
