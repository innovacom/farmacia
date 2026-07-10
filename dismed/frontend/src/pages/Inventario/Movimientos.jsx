import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X, Loader2, Search, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, SlidersHorizontal, Upload } from 'lucide-react';
import api from '../../services/api';
import ImportExistenciasModal from './ImportExistenciasModal';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';

const TIPO_BADGE = {
  entrada:  { label: 'Entrada',  cls: 'bg-green-50 text-green-700' },
  salida:   { label: 'Salida',   cls: 'bg-red-50 text-red-700' },
  traspaso: { label: 'Traspaso', cls: 'bg-blue-50 text-blue-700' },
  ajuste:   { label: 'Ajuste',   cls: 'bg-amber-50 text-amber-700' },
};

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ── Modal de ENTRADA ──────────────────────────────────────────────────────────
function EntradaModal({ onClose, onDone }) {
  const [busc, setBusc] = useState('');
  const [prod, setProd] = useState(null);
  const [f, setF] = useState({ almacen_id: '', ubicacion_id: '', numero_lote: '', fecha_caducidad: '', cantidad: '', costo_unitario: '' });

  const { data: prods = [] } = useQuery({
    queryKey: ['prodbusca', busc], enabled: busc.length >= 2,
    queryFn: () => api.get('/productos', { params: { q: busc, limit: 10 } }).then((r) => r.data),
  });
  const { data: almacenes = [] } = useQuery({ queryKey: ['almacenes'], queryFn: () => api.get('/almacenes').then((r) => r.data) });
  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', f.almacen_id], enabled: !!f.almacen_id,
    queryFn: () => api.get(`/almacenes/${f.almacen_id}/ubicaciones`).then((r) => r.data),
  });

  const mut = useMutation({
    mutationFn: (b) => api.post('/inventario/entradas', b),
    onSuccess: (res) => { toast.success(`Entrada ${res.data.folio}`); onDone(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  function submit() {
    if (!prod) return toast.error('Selecciona un producto');
    if (!f.almacen_id || !f.ubicacion_id) return toast.error('Almacén y ubicación requeridos');
    if (!(parseFloat(f.cantidad) > 0)) return toast.error('Cantidad > 0');
    if (prod.control_lote_caducidad && !f.numero_lote.trim()) return toast.error('Este producto requiere lote');
    mut.mutate({ producto_id: prod.id, ...f, fecha_caducidad: f.fecha_caducidad || null });
  }

  return (
    <ModalShell title="Registrar entrada" onClose={onClose}>
      <div className="space-y-3">
        {!prod ? (
          <div>
            <label className="label">Producto *</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9" placeholder="Busca SKU o descripción…" value={busc} onChange={(e) => setBusc(e.target.value)} />
            </div>
            {prods.length > 0 && (
              <div className="border border-gray-200 rounded-lg mt-1 max-h-44 overflow-y-auto">
                {prods.map((p) => (
                  <button key={p.id} onClick={() => { setProd(p); setBusc(''); }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0">
                    <span className="font-mono text-brand-500 text-xs">{p.sku_interno}</span> {p.descripcion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm flex items-center justify-between">
            <span><span className="font-mono text-brand-500 text-xs">{prod.sku_interno}</span> {prod.descripcion}
              {prod.control_lote_caducidad ? <span className="badge-green ml-2">requiere lote</span> : <span className="badge-gray ml-2">genérico</span>}</span>
            <button onClick={() => setProd(null)} className="text-gray-400 hover:text-red-500"><X size={15} /></button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Almacén *</label>
            <select className="input" value={f.almacen_id} onChange={(e) => setF({ ...f, almacen_id: e.target.value, ubicacion_id: '' })}>
              <option value="">—</option>{almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Ubicación *</label>
            <select className="input" value={f.ubicacion_id} disabled={!f.almacen_id} onChange={(e) => setF({ ...f, ubicacion_id: e.target.value })}>
              <option value="">—</option>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}
            </select>
          </div>
        </div>

        {prod?.control_lote_caducidad !== 0 && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Lote {prod?.control_lote_caducidad ? '*' : ''}</label>
              <input className="input font-mono" value={f.numero_lote} disabled={prod && !prod.control_lote_caducidad}
                onChange={(e) => setF({ ...f, numero_lote: e.target.value })} placeholder={prod && !prod.control_lote_caducidad ? 'GENERICO' : 'L12345'} />
            </div>
            <div>
              <label className="label">Caducidad</label>
              <input type="date" className="input" value={f.fecha_caducidad} disabled={prod && !prod.control_lote_caducidad}
                onChange={(e) => setF({ ...f, fecha_caducidad: e.target.value })} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Cantidad *</label><input type="number" min="0" step="0.01" className="input" value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: e.target.value })} /></div>
          <div><label className="label">Costo unitario</label><input type="number" min="0" step="0.01" className="input" value={f.costo_unitario} onChange={(e) => setF({ ...f, costo_unitario: e.target.value })} /></div>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={submit} disabled={mut.isPending} className="btn-primary">{mut.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Registrar entrada</button>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Modal de operación sobre una existencia (salida / traspaso / ajuste) ───────
function OperacionModal({ tipo, lote, onClose, onDone }) {
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ubicDest, setUbicDest] = useState('');

  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', lote.almacen_id], enabled: tipo === 'traspaso' && !!lote.almacen_id,
    queryFn: () => api.get(`/almacenes/${lote.almacen_id}/ubicaciones`).then((r) => r.data),
  });

  const ep = { salida: '/inventario/salidas', traspaso: '/inventario/traspasos', ajuste: '/inventario/ajustes' }[tipo];
  const mut = useMutation({
    mutationFn: (b) => api.post(ep, b),
    onSuccess: (res) => { toast.success(`${tipo} ${res.data.folio || ''} registrado`); onDone(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  function submit() {
    if (tipo === 'ajuste') {
      if (cantidad === '' || parseFloat(cantidad) < 0) return toast.error('Cantidad nueva inválida');
      return mut.mutate({ lote_id: lote.lote_id, cantidad_nueva: parseFloat(cantidad), motivo });
    }
    if (!(parseFloat(cantidad) > 0)) return toast.error('Cantidad > 0');
    if (parseFloat(cantidad) > Number(lote.cantidad_actual)) return toast.error('Excede la existencia disponible');
    if (tipo === 'salida') return mut.mutate({ lote_id: lote.lote_id, cantidad: parseFloat(cantidad), motivo });
    if (tipo === 'traspaso') {
      if (!ubicDest) return toast.error('Ubicación destino requerida');
      return mut.mutate({ lote_id: lote.lote_id, ubicacion_destino_id: ubicDest, cantidad: parseFloat(cantidad), motivo });
    }
  }

  const titulo = { salida: 'Registrar salida', traspaso: 'Traspasar', ajuste: 'Ajustar existencia' }[tipo];
  return (
    <ModalShell title={titulo} onClose={onClose}>
      <div className="space-y-3">
        <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
          <p><span className="font-mono text-brand-500 text-xs">{lote.sku_interno}</span> {lote.descripcion}</p>
          <p className="text-xs text-gray-400">{lote.almacen} · {lote.ubicacion} · {lote.es_generico ? 'Genérico' : `Lote ${lote.numero_lote}`} · Disp: <strong>{Number(lote.cantidad_actual).toLocaleString('es-MX')}</strong></p>
        </div>
        {tipo === 'traspaso' && (
          <div>
            <label className="label">Ubicación destino *</label>
            <select className="input" value={ubicDest} onChange={(e) => setUbicDest(e.target.value)}>
              <option value="">—</option>
              {ubicaciones.filter((u) => u.id !== lote.ubicacion_id).map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">{tipo === 'ajuste' ? 'Cantidad real (conteo)' : 'Cantidad'} *</label>
          <input type="number" min="0" step="0.01" className="input" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </div>
        <div>
          <label className="label">Motivo</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipo === 'salida' ? 'Venta, merma…' : 'Observación'} />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={submit} disabled={mut.isPending} className="btn-primary">{mut.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Confirmar</button>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
        </div>
      </div>
    </ModalShell>
  );
}

export default function Movimientos() {
  const qc = useQueryClient();
  const [showEntrada, setShowEntrada] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [op, setOp] = useState(null);            // { tipo, lote }
  const [buscExist, setBuscExist] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');

  const { data: existencias = [] } = useQuery({
    queryKey: ['existencias', buscExist], enabled: buscExist.length >= 2,
    queryFn: () => api.get('/inventario/existencias', { params: { q: buscExist } }).then((r) => r.data),
  });
  const { data: kardex = [], isLoading } = useQuery({
    queryKey: ['kardex', filtroTipo],
    queryFn: () => api.get('/inventario/movimientos', { params: { tipo: filtroTipo || undefined } }).then((r) => r.data),
  });

  const { pageItems: kardexPage, page, setPage, totalPages, total, from, to } = usePagination(kardex);

  function refrescar() {
    qc.invalidateQueries(['kardex']); qc.invalidateQueries(['existencias']);
    qc.invalidateQueries(['alertas']);
    setShowEntrada(false); setShowImport(false); setOp(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Movimientos de inventario</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="btn-secondary"><Upload size={16} /> Importar existencias</button>
          <button onClick={() => setShowEntrada(true)} className="btn-primary"><ArrowDownToLine size={16} /> Entrada</button>
        </div>
      </div>

      {/* Operar sobre una existencia */}
      <div className="card mb-5">
        <h2 className="font-semibold text-gray-800 mb-1">Salida / Traspaso / Ajuste</h2>
        <p className="text-xs text-gray-400 mb-3">Busca una existencia y elige la operación.</p>
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-80" placeholder="Buscar SKU o descripción en existencias…" value={buscExist} onChange={(e) => setBuscExist(e.target.value)} />
        </div>
        {buscExist.length >= 2 && (
          existencias.length === 0 ? <p className="text-sm text-gray-400">Sin existencias para esa búsqueda.</p> : (
            <div className="overflow-x-auto">
              <table className="table-auto w-full text-xs">
                <thead><tr><th>SKU</th><th>Descripción</th><th>Ubicación</th><th>Lote</th><th className="text-right">Disp.</th><th></th></tr></thead>
                <tbody>
                  {existencias.map((e) => (
                    <tr key={e.lote_id}>
                      <td className="font-mono text-brand-500">{e.sku_interno}</td>
                      <td className="max-w-md whitespace-normal break-words align-top">{e.descripcion}</td>
                      <td>{e.almacen} · {e.ubicacion}</td>
                      <td>{e.es_generico ? 'Genérico' : e.numero_lote}</td>
                      <td className="text-right font-medium">{Number(e.cantidad_actual).toLocaleString('es-MX')}</td>
                      <td className="text-right whitespace-nowrap">
                        <button onClick={() => setOp({ tipo: 'salida', lote: e })} title="Salida" className="p-1 text-red-500 hover:bg-red-50 rounded"><ArrowUpFromLine size={15} /></button>
                        <button onClick={() => setOp({ tipo: 'traspaso', lote: e })} title="Traspaso" className="p-1 text-blue-500 hover:bg-blue-50 rounded"><ArrowLeftRight size={15} /></button>
                        <button onClick={() => setOp({ tipo: 'ajuste', lote: e })} title="Ajuste" className="p-1 text-amber-500 hover:bg-amber-50 rounded"><SlidersHorizontal size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Kardex */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold text-gray-800">Kardex (últimos movimientos)</h2>
          <select className="input w-44" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
            <option value="">Todos los tipos</option>
            <option value="entrada">Entradas</option>
            <option value="salida">Salidas</option>
            <option value="traspaso">Traspasos</option>
            <option value="ajuste">Ajustes</option>
          </select>
        </div>
        {isLoading ? <p className="text-sm text-gray-400 text-center py-10">Cargando…</p> : kardex.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Sin movimientos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-auto w-full text-xs">
              <thead><tr><th>Folio</th><th>Tipo</th><th>Fecha</th><th>SKU</th><th>Descripción</th><th>Ubic.</th><th className="text-right">Cant.</th><th>Motivo</th><th>Usuario</th></tr></thead>
              <tbody>
                {kardexPage.map((m) => {
                  const b = TIPO_BADGE[m.tipo];
                  return (
                    <tr key={m.id}>
                      <td className="font-mono text-gray-500">{m.folio}</td>
                      <td><span className={`px-2 py-0.5 rounded-full ${b.cls}`}>{b.label}</span></td>
                      <td className="whitespace-nowrap">{new Date(m.created_at).toLocaleDateString('es-MX')}</td>
                      <td className="font-mono text-brand-500">{m.sku_interno}</td>
                      <td className="max-w-[260px] whitespace-normal break-words align-top">{m.descripcion}</td>
                      <td>{m.tipo === 'traspaso' ? `${m.ubic_origen || '—'}→${m.ubic_destino || '—'}` : (m.ubic_origen || m.ubic_destino || '—')}</td>
                      <td className={`text-right font-medium ${Number(m.cantidad) < 0 ? 'text-red-600' : 'text-green-700'}`}>{Number(m.cantidad).toLocaleString('es-MX')}</td>
                      <td className="max-w-[160px] truncate text-gray-500">{m.motivo || ''}</td>
                      <td className="text-gray-500">{m.usuario || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} total={total} from={from} to={to} onChange={setPage} />
          </div>
        )}
      </div>

      {showEntrada && <EntradaModal onClose={() => setShowEntrada(false)} onDone={refrescar} />}
      {showImport && <ImportExistenciasModal onClose={() => setShowImport(false)} onDone={refrescar} />}
      {op && <OperacionModal tipo={op.tipo} lote={op.lote} onClose={() => setOp(null)} onDone={refrescar} />}
    </div>
  );
}
