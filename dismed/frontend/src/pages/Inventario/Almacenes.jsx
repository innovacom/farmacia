import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Loader2, Warehouse, MapPin, Trash2 } from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const TIPOS = ['zona', 'rack', 'tarima', 'anaquel', 'piso', 'otro'];
const FORM_ALM_VACIO = { codigo: '', nombre: '', direccion: '' };
const FORM_UB_VACIO = { codigo: '', descripcion: '', tipo: 'otro' };

export default function Almacenes() {
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();
  const [showAlm, setShowAlm] = useState(false);
  const [editandoAlm, setEditandoAlm] = useState(null);
  const [sel, setSel] = useState(null);          // almacén seleccionado para ver ubicaciones
  const [formAlm, setFormAlm] = useState(FORM_ALM_VACIO);
  const [estatusAlm, setEstatusAlm] = useState('activos');

  const [showUb, setShowUb] = useState(false);
  const [editandoUb, setEditandoUb] = useState(null);
  const [formUb, setFormUb] = useState(FORM_UB_VACIO);
  const [estatusUb, setEstatusUb] = useState('activos');

  const { data: almacenes = [] } = useQuery({
    queryKey: ['almacenes', estatusAlm],
    queryFn: () => api.get('/almacenes', { params: { estatus: estatusAlm } }).then((r) => r.data),
  });
  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', sel?.id, estatusUb],
    queryFn: () => api.get(`/almacenes/${sel.id}/ubicaciones`, { params: { estatus: estatusUb } }).then((r) => r.data),
    enabled: !!sel,
  });

  const guardarAlm = useMutation({
    mutationFn: (b) => editandoAlm ? api.put(`/almacenes/${editandoAlm.id}`, b) : api.post('/almacenes', b),
    onSuccess: () => {
      toast.success(editandoAlm ? 'Almacén actualizado' : 'Almacén creado');
      qc.invalidateQueries(['almacenes']);
      cerrarAlm();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });
  const bajaAlm = useMutation({
    mutationFn: (id) => api.delete(`/almacenes/${id}`),
    onSuccess: (_, id) => {
      toast.success('Almacén dado de baja');
      qc.invalidateQueries(['almacenes']);
      setSel((s) => (s && s.id === id ? null : s));
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al dar de baja'),
  });
  const reactivarAlm = useMutation({
    mutationFn: (id) => api.put(`/almacenes/${id}`, { activo: 1 }),
    onSuccess: () => { toast.success('Almacén reactivado'); qc.invalidateQueries(['almacenes']); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al reactivar'),
  });

  const guardarUb = useMutation({
    mutationFn: (b) => editandoUb
      ? api.put(`/almacenes/${sel.id}/ubicaciones/${editandoUb.id}`, b)
      : api.post(`/almacenes/${sel.id}/ubicaciones`, b),
    onSuccess: () => {
      toast.success(editandoUb ? 'Ubicación actualizada' : 'Ubicación creada');
      qc.invalidateQueries(['ubicaciones', sel.id]);
      qc.invalidateQueries(['almacenes']);
      cerrarUb();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });
  const bajaUb = useMutation({
    mutationFn: (id) => api.delete(`/almacenes/${sel.id}/ubicaciones/${id}`),
    onSuccess: () => {
      toast.success('Ubicación dada de baja');
      qc.invalidateQueries(['ubicaciones', sel.id]);
      qc.invalidateQueries(['almacenes']);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al dar de baja'),
  });
  const reactivarUb = useMutation({
    mutationFn: (id) => api.put(`/almacenes/${sel.id}/ubicaciones/${id}`, { activo: 1 }),
    onSuccess: () => {
      toast.success('Ubicación reactivada');
      qc.invalidateQueries(['ubicaciones', sel.id]);
      qc.invalidateQueries(['almacenes']);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al reactivar'),
  });

  function abrirNuevoAlm() { setEditandoAlm(null); setFormAlm(FORM_ALM_VACIO); setShowAlm(true); }
  function abrirEditarAlm(a) {
    setEditandoAlm(a);
    setFormAlm({ codigo: a.codigo || '', nombre: a.nombre || '', direccion: a.direccion || '' });
    setShowAlm(true);
  }
  function cerrarAlm() { setShowAlm(false); setEditandoAlm(null); setFormAlm(FORM_ALM_VACIO); }

  async function darDeBajaAlm(a) {
    const ok = await confirmar(
      `¿Dar de baja el almacén "${a.nombre}"? Sus ubicaciones dejarán de listarse.`,
      { titulo: 'Dar de baja almacén', textoConfirmar: 'Dar de baja' }
    );
    if (!ok) return;
    bajaAlm.mutate(a.id);
  }

  function abrirNuevaUb() { setEditandoUb(null); setFormUb(FORM_UB_VACIO); setShowUb(true); }
  function abrirEditarUb(u) {
    setEditandoUb(u);
    setFormUb({ codigo: u.codigo || '', descripcion: u.descripcion || '', tipo: u.tipo || 'otro' });
    setShowUb(true);
  }
  function cerrarUb() { setShowUb(false); setEditandoUb(null); setFormUb(FORM_UB_VACIO); }

  async function darDeBajaUb(u) {
    const ok = await confirmar(
      `¿Dar de baja la ubicación "${u.codigo}"?`,
      { titulo: 'Dar de baja ubicación', textoConfirmar: 'Dar de baja' }
    );
    if (!ok) return;
    bajaUb.mutate(u.id);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Almacenes y ubicaciones</h1>
        <button onClick={abrirNuevoAlm} className="btn-primary"><Plus size={16} /> Nuevo almacén</button>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Lista de almacenes */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">Almacenes</h2>
            <select className="input w-36 text-xs" value={estatusAlm} onChange={(e) => setEstatusAlm(e.target.value)}>
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          {almacenes.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Warehouse size={36} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">Sin almacenes{estatusAlm !== 'activos' ? ' con ese estado' : '. Crea el primero.'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {almacenes.map((a) => (
                <div key={a.id}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors flex items-center gap-2
                    ${sel?.id === a.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'}
                    ${!a.activo ? 'opacity-50' : ''}`}>
                  <button onClick={() => setSel(a)} className="flex-1 text-left min-w-0">
                    <p className="font-medium text-gray-800 truncate">{a.nombre} <span className="font-mono text-xs text-gray-400">({a.codigo})</span></p>
                    <p className="text-xs text-gray-400">{a.ubicaciones} ubicaciones{a.direccion ? ` · ${a.direccion}` : ''}</p>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => abrirEditarAlm(a)} className="text-xs text-brand-500 hover:underline">Editar</button>
                    {a.activo ? (
                      <button onClick={() => darDeBajaAlm(a)} className="text-xs text-red-400 hover:text-red-600" title="Dar de baja">
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <button onClick={() => reactivarAlm.mutate(a.id)} className="text-xs text-green-600 hover:underline">Reactivar</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ubicaciones del almacén seleccionado */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">
              Ubicaciones {sel ? <span className="text-gray-400 font-normal">— {sel.nombre}</span> : ''}
            </h2>
            {sel && (
              <select className="input w-36 text-xs" value={estatusUb} onChange={(e) => setEstatusUb(e.target.value)}>
                <option value="activos">Activas</option>
                <option value="inactivos">Inactivas</option>
                <option value="todos">Todas</option>
              </select>
            )}
          </div>
          {!sel ? (
            <p className="text-sm text-gray-400 py-8 text-center">Selecciona un almacén para ver/crear ubicaciones.</p>
          ) : (
            <>
              <div className="flex justify-end mb-3">
                <button onClick={abrirNuevaUb} className="btn-primary text-sm"><Plus size={14} /> Nueva ubicación</button>
              </div>
              {ubicaciones.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">Sin ubicaciones{estatusUb !== 'activos' ? ' con ese estado' : ' aún'}.</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {ubicaciones.map((u) => (
                    <div key={u.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 text-sm ${!u.activo ? 'opacity-50' : ''}`}>
                      <MapPin size={14} className="text-brand-500 shrink-0" />
                      <span className="font-mono">{u.codigo}</span>
                      {u.descripcion && <span className="text-gray-400 text-xs truncate">{u.descripcion}</span>}
                      <span className="badge-gray capitalize">{u.tipo}</span>
                      <div className="ml-auto flex items-center gap-2 shrink-0">
                        <button onClick={() => abrirEditarUb(u)} className="text-xs text-brand-500 hover:underline">Editar</button>
                        {u.activo ? (
                          <button onClick={() => darDeBajaUb(u)} className="text-xs text-red-400 hover:text-red-600" title="Dar de baja">
                            <Trash2 size={14} />
                          </button>
                        ) : (
                          <button onClick={() => reactivarUb.mutate(u.id)} className="text-xs text-green-600 hover:underline">Reactivar</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal alta/edición de almacén */}
      {showAlm && (
        <Modal title={editandoAlm ? 'Editar almacén' : 'Nuevo almacén'} onClose={cerrarAlm}>
          <div className="space-y-4">
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
              <button
                onClick={() => (formAlm.codigo.trim() && formAlm.nombre.trim()) ? guardarAlm.mutate(formAlm) : toast.error('Código y nombre requeridos')}
                disabled={guardarAlm.isPending} className="btn-primary">
                {guardarAlm.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
                {editandoAlm ? 'Guardar cambios' : 'Crear'}
              </button>
              <button onClick={cerrarAlm} className="btn-secondary">Cancelar</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal alta/edición de ubicación */}
      {showUb && (
        <Modal title={editandoUb ? 'Editar ubicación' : 'Nueva ubicación'} onClose={cerrarUb}>
          <div className="space-y-4">
            <div>
              <label className="label">Código *</label>
              <input className="input font-mono" value={formUb.codigo} onChange={(e) => setFormUb({ ...formUb, codigo: e.target.value })} placeholder="TARIMA-01" />
            </div>
            <div>
              <label className="label">Descripción</label>
              <input className="input" value={formUb.descripcion} onChange={(e) => setFormUb({ ...formUb, descripcion: e.target.value })} />
            </div>
            <div>
              <label className="label">Tipo</label>
              <select className="input" value={formUb.tipo} onChange={(e) => setFormUb({ ...formUb, tipo: e.target.value })}>
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => formUb.codigo.trim() ? guardarUb.mutate(formUb) : toast.error('Código requerido')}
                disabled={guardarUb.isPending} className="btn-primary">
                {guardarUb.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
                {editandoUb ? 'Guardar cambios' : 'Crear'}
              </button>
              <button onClick={cerrarUb} className="btn-secondary">Cancelar</button>
            </div>
          </div>
        </Modal>
      )}

      {dialogoConfirm}
    </div>
  );
}
