import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Warehouse, Plus, Pencil, Monitor, Receipt, Zap, X, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';

/**
 * Sucursales y cajas del POS (permiso pos-admin).
 * Una sucursal se liga 1:1 a un almacén existente: las ventas de mostrador
 * descuentan inventario de ese almacén (FEFO).
 */
export default function Sucursales() {
  const qc = useQueryClient();
  const [modalSucursal, setModalSucursal] = useState(null); // null | {} | sucursal
  const [modalCaja, setModalCaja] = useState(null);         // null | { sucursal }

  const { data: sucursales = [], isLoading } = useQuery({
    queryKey: ['pos-sucursales'],
    queryFn: () => api.get('/pos/sucursales').then((r) => r.data),
  });
  const { data: cajas = [] } = useQuery({
    queryKey: ['pos-cajas'],
    queryFn: () => api.get('/pos/cajas').then((r) => r.data),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Warehouse size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Sucursales y cajas</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/pos/facturas-globales" className="btn-secondary">
            <Receipt size={15} /> Facturas globales
          </Link>
          <button className="btn-primary" onClick={() => setModalSucursal({})}>
            <Plus size={16} /> Nueva sucursal
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-gray-400">Cargando…</p>
      ) : !sucursales.length ? (
        <div className="card text-center text-gray-500 py-10">
          Aún no hay sucursales. Crea la primera eligiendo el almacén que surtirá el mostrador.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sucursales.map((s) => (
            <div key={s.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">
                    {s.nombre}{' '}
                    <span className="text-xs text-gray-400 font-mono">{s.codigo}</span>
                    {!s.activo && <span className="badge-gray ml-2">Inactiva</span>}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Almacén: {s.almacen_nombre} ({s.almacen_codigo})
                  </p>
                  {s.direccion && <p className="text-xs text-gray-400 mt-0.5">{s.direccion}</p>}
                </div>
                <button
                  className="p-1.5 text-gray-400 hover:text-brand-500 rounded-lg"
                  onClick={() => setModalSucursal(s)}
                  title="Editar"
                >
                  <Pencil size={15} />
                </button>
              </div>

              <div className="mt-4 border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cajas</p>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setModalCaja({ sucursal: s })}
                  >
                    <Plus size={13} /> Agregar caja
                  </button>
                </div>
                {cajas.filter((c) => c.sucursal_id === s.id).map((c) => (
                  <div key={c.id} className="flex items-center gap-2 py-1 text-sm text-gray-700">
                    <Monitor size={14} className="text-gray-400" />
                    <span className="flex-1">{c.nombre}</span>
                    {c.turno_abierto_id
                      ? <span className="badge-green">Turno abierto</span>
                      : <span className="badge-gray">Sin turno</span>}
                    {!c.activo && <span className="badge-red">Inactiva</span>}
                  </div>
                ))}
                {!cajas.some((c) => c.sucursal_id === s.id) && (
                  <p className="text-xs text-gray-400">Sin cajas registradas.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalSucursal !== null && (
        <ModalSucursal
          sucursal={modalSucursal.id ? modalSucursal : null}
          onClose={() => setModalSucursal(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['pos-sucursales'] }); setModalSucursal(null); }}
        />
      )}
      {modalCaja !== null && (
        <ModalCaja
          sucursal={modalCaja.sucursal}
          onClose={() => setModalCaja(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['pos-cajas'] }); setModalCaja(null); }}
        />
      )}
    </div>
  );
}

function ModalSucursal({ sucursal, onClose, onSaved }) {
  const [form, setForm] = useState({
    almacen_id: sucursal?.almacen_id || '',
    codigo: sucursal?.codigo || '',
    nombre: sucursal?.nombre || '',
    direccion: sucursal?.direccion || '',
    telefono: sucursal?.telefono || '',
    activo: sucursal ? !!sucursal.activo : true,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const [favoritos, setFavoritos] = useState([]); // [{id, sku_interno, descripcion}]

  const { data: almacenes = [] } = useQuery({
    queryKey: ['almacenes'],
    queryFn: () => api.get('/almacenes').then((r) => r.data),
  });

  const { data: favoritosActuales, isLoading: cargandoFavoritos } = useQuery({
    queryKey: ['pos-favoritos', sucursal?.id],
    queryFn: () => api.get('/pos/productos/favoritos', { params: { sucursal_id: sucursal.id } }).then((r) => r.data),
    enabled: !!sucursal,
  });
  useEffect(() => { if (favoritosActuales) setFavoritos(favoritosActuales); }, [favoritosActuales]);

  const guardar = useMutation({
    mutationFn: () => (sucursal
      ? api.put(`/pos/sucursales/${sucursal.id}`, {
          ...form, activo: form.activo ? 1 : 0,
          productos_favoritos: favoritos.map((p) => p.id),
        })
      : api.post('/pos/sucursales', form)),
    onSuccess: () => { toast.success('Sucursal guardada'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  return (
    <Modal title={sucursal ? 'Editar sucursal' : 'Nueva sucursal'} onClose={onClose} size="md">
      <div className="space-y-3">
        {!sucursal && (
          <div>
            <label className="label">Almacén (surtirá el mostrador)</label>
            <select
              className="input"
              value={form.almacen_id}
              onChange={(e) => set('almacen_id', e.target.value)}
            >
              <option value="">— Elegir almacén —</option>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>{a.nombre} ({a.codigo})</option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Código</label>
            <input className="input" value={form.codigo} onChange={(e) => set('codigo', e.target.value)} placeholder="SUC-01" />
          </div>
          <div>
            <label className="label">Nombre</label>
            <input className="input" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Farmacia Centro" />
          </div>
        </div>
        <div>
          <label className="label">Dirección</label>
          <input className="input" value={form.direccion} onChange={(e) => set('direccion', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Teléfono</label>
            <input className="input" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} />
          </div>
          {sucursal && (
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.activo}
                  onChange={(e) => set('activo', e.target.checked)}
                />
                Activa
              </label>
            </div>
          )}
        </div>

        {sucursal && (
          <div className="border-t border-gray-100 pt-3">
            <label className="label flex items-center gap-1.5">
              <Zap size={13} className="text-brand-500" /> Accesos rápidos de venta (máx. 5)
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Botones de compra directa en la pantalla de venta mostrador, para los productos más vendidos de esta sucursal.
            </p>
            {!!favoritos.length && (
              <div className="flex flex-wrap gap-2 mb-2">
                {favoritos.map((p) => (
                  <span key={p.id} className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-brand-50 border border-brand-100 text-xs text-brand-700">
                    {p.descripcion}
                    <button type="button" className="text-brand-400 hover:text-red-500" onClick={() => setFavoritos((f) => f.filter((x) => x.id !== p.id))}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {favoritos.length < 5 && (
              <BuscadorFavoritos
                sucursalId={sucursal.id}
                excluir={favoritos.map((p) => p.id)}
                onElegir={(p) => setFavoritos((f) => [...f, p])}
              />
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="btn-primary"
            disabled={guardar.isPending || cargandoFavoritos || !form.codigo.trim() || !form.nombre.trim() || (!sucursal && !form.almacen_id)}
            onClick={() => guardar.mutate()}
          >
            {cargandoFavoritos ? 'Cargando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BuscadorFavoritos({ sucursalId, excluir, onElegir }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState([]);

  useEffect(() => {
    if (!q.trim()) { setResultados([]); return; }
    const t = setTimeout(() => {
      api.get('/pos/productos/buscar', { params: { q: q.trim(), sucursal_id: sucursalId } })
        .then((r) => setResultados(r.data.filter((p) => !excluir.includes(p.id))))
        .catch(() => setResultados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, sucursalId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-8 text-sm"
          placeholder="Buscar producto por SKU o descripción…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {!!resultados.length && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {resultados.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-50 text-sm"
              onClick={() => { onElegir(p); setQ(''); setResultados([]); }}
            >
              <span className="truncate">{p.descripcion}</span>
              <span className="text-xs text-gray-400 font-mono shrink-0">{p.sku_interno}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ModalCaja({ sucursal, onClose, onSaved }) {
  const [nombre, setNombre] = useState('');
  const guardar = useMutation({
    mutationFn: () => api.post('/pos/cajas', { sucursal_id: sucursal.id, nombre }),
    onSuccess: () => { toast.success('Caja creada'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al crear la caja'),
  });

  return (
    <Modal title={`Nueva caja — ${sucursal.nombre}`} onClose={onClose} size="sm">
      <div className="space-y-3">
        <div>
          <label className="label">Nombre de la caja</label>
          <input
            className="input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Caja 1"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="btn-primary"
            disabled={guardar.isPending || !nombre.trim()}
            onClick={() => guardar.mutate()}
          >
            Crear
          </button>
        </div>
      </div>
    </Modal>
  );
}
