import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X, Loader2, Warehouse, MapPin } from 'lucide-react';
import api from '../../services/api';

const TIPOS = ['zona', 'rack', 'tarima', 'anaquel', 'piso', 'otro'];

export default function Almacenes() {
  const qc = useQueryClient();
  const [showAlm, setShowAlm] = useState(false);
  const [sel, setSel] = useState(null);          // almacén seleccionado para ver ubicaciones
  const [formAlm, setFormAlm] = useState({ codigo: '', nombre: '', direccion: '' });
  const [formUb, setFormUb] = useState({ codigo: '', descripcion: '', tipo: 'otro' });

  const { data: almacenes = [] } = useQuery({
    queryKey: ['almacenes'],
    queryFn: () => api.get('/almacenes').then((r) => r.data),
  });
  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', sel?.id],
    queryFn: () => api.get(`/almacenes/${sel.id}/ubicaciones`).then((r) => r.data),
    enabled: !!sel,
  });

  const crearAlm = useMutation({
    mutationFn: (b) => api.post('/almacenes', b),
    onSuccess: () => { toast.success('Almacén creado'); qc.invalidateQueries(['almacenes']); setShowAlm(false); setFormAlm({ codigo: '', nombre: '', direccion: '' }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });
  const crearUb = useMutation({
    mutationFn: (b) => api.post(`/almacenes/${sel.id}/ubicaciones`, b),
    onSuccess: () => { toast.success('Ubicación creada'); qc.invalidateQueries(['ubicaciones', sel.id]); setFormUb({ codigo: '', descripcion: '', tipo: 'otro' }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Almacenes y ubicaciones</h1>
        <button onClick={() => setShowAlm(true)} className="btn-primary"><Plus size={16} /> Nuevo almacén</button>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Lista de almacenes */}
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-3">Almacenes</h2>
          {almacenes.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Warehouse size={36} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">Sin almacenes. Crea el primero.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {almacenes.map((a) => (
                <button key={a.id} onClick={() => setSel(a)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors
                    ${sel?.id === a.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <p className="font-medium text-gray-800">{a.nombre} <span className="font-mono text-xs text-gray-400">({a.codigo})</span></p>
                  <p className="text-xs text-gray-400">{a.ubicaciones} ubicaciones{a.direccion ? ` · ${a.direccion}` : ''}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Ubicaciones del almacén seleccionado */}
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-3">
            Ubicaciones {sel ? <span className="text-gray-400 font-normal">— {sel.nombre}</span> : ''}
          </h2>
          {!sel ? (
            <p className="text-sm text-gray-400 py-8 text-center">Selecciona un almacén para ver/crear ubicaciones.</p>
          ) : (
            <>
              <div className="flex items-end gap-2 mb-3 flex-wrap">
                <div className="flex-1 min-w-[120px]">
                  <label className="label">Código</label>
                  <input className="input" value={formUb.codigo} onChange={(e) => setFormUb({ ...formUb, codigo: e.target.value })} placeholder="TARIMA-01" />
                </div>
                <div className="w-32">
                  <label className="label">Tipo</label>
                  <select className="input" value={formUb.tipo} onChange={(e) => setFormUb({ ...formUb, tipo: e.target.value })}>
                    {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <button onClick={() => formUb.codigo.trim() ? crearUb.mutate(formUb) : toast.error('Código requerido')}
                  disabled={crearUb.isPending} className="btn-primary">
                  {crearUb.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                </button>
              </div>
              {ubicaciones.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">Sin ubicaciones aún.</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {ubicaciones.map((u) => (
                    <div key={u.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 text-sm">
                      <MapPin size={14} className="text-brand-500" />
                      <span className="font-mono">{u.codigo}</span>
                      <span className="badge-gray ml-auto capitalize">{u.tipo}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal nuevo almacén */}
      {showAlm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Nuevo almacén</h2>
              <button onClick={() => setShowAlm(false)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="label">Código *</label>
                <input className="input font-mono" value={formAlm.codigo} onChange={(e) => setFormAlm({ ...formAlm, codigo: e.target.value })} placeholder="BOD-REF" />
              </div>
              <div>
                <label className="label">Nombre *</label>
                <input className="input" value={formAlm.nombre} onChange={(e) => setFormAlm({ ...formAlm, nombre: e.target.value })} placeholder="Bodega Refinería" />
              </div>
              <div>
                <label className="label">Dirección</label>
                <input className="input" value={formAlm.direccion} onChange={(e) => setFormAlm({ ...formAlm, direccion: e.target.value })} />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => (formAlm.codigo.trim() && formAlm.nombre.trim()) ? crearAlm.mutate(formAlm) : toast.error('Código y nombre requeridos')}
                  disabled={crearAlm.isPending} className="btn-primary">
                  {crearAlm.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Crear
                </button>
                <button onClick={() => setShowAlm(false)} className="btn-secondary">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
