import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Search, Link2, Check, Loader2, BookOpen, Trash2, X, Plus } from 'lucide-react';
import api from '../../services/api';
import ProductoPicker from '../../components/shared/ProductoPicker';
import { usePrefsStore } from '../../store/prefsStore';
import Pagination from '../../components/ui/Pagination';
import { useConfirm } from '../../components/ui/ConfirmDialog';

export default function CatalogoProveedor() {
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();
  const [provId, setProvId] = useState('');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [vinculado, setVinculado] = useState(''); // '', '1', '0'
  const [page, setPage] = useState(0);
  const [picker, setPicker] = useState(null);
  const [altaOpen, setAltaOpen] = useState(false);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const pageSize = usePrefsStore((s) => s.rowsPerPage);

  useEffect(() => { setPage(0); }, [pageSize]);

  // Proveedores
  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get('/proveedores').then((r) => r.data),
  });

  const { data: cfg } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get('/configuracion').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const vigenciaCatalogoMeses = cfg?.vigencia_catalogo_meses || 11;

  useEffect(() => {
    if (!provId && proveedores.length) {
      const pron = proveedores.find((p) => /pronamac/i.test(p.nombre_empresa));
      setProvId(String((pron || proveedores[0]).id));
    }
  }, [proveedores]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al cambiar proveedor limpiar selección
  useEffect(() => { setSeleccionados(new Set()); }, [provId]);

  useEffect(() => {
    const t = setTimeout(() => { setQDebounced(q); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useQuery({
    queryKey: ['catalogo-prov', provId, qDebounced, vinculado, page, pageSize],
    enabled: !!provId,
    keepPreviousData: true,
    queryFn: () => api.get(`/proveedores/${provId}/catalogo`, {
      params: { q: qDebounced || undefined, vinculado: vinculado || undefined, limit: pageSize, offset: page * pageSize },
    }).then((r) => r.data),
  });

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const guardarMut = useMutation({
    mutationFn: ({ sku, body }) =>
      api.put(`/proveedores/${provId}/catalogo/${encodeURIComponent(sku)}`, body),
    onSuccess: () => {
      qc.invalidateQueries(['catalogo-prov']);
      toast.success('Catálogo actualizado');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  const eliminarMut = useMutation({
    mutationFn: (skus) =>
      skus.length === 1
        ? api.delete(`/proveedores/${provId}/catalogo/${encodeURIComponent(skus[0])}`)
        : api.post(`/proveedores/${provId}/catalogo/baja-masiva`, { skus }),
    onSuccess: (_, skus) => {
      toast.success(skus.length === 1 ? 'Entrada eliminada del catálogo' : `${skus.length} entradas eliminadas`);
      qc.invalidateQueries(['catalogo-prov']);
      setSeleccionados(new Set());
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al eliminar'),
  });

  async function eliminar(skus) {
    const msg = skus.length === 1
      ? '¿Eliminar esta entrada del catálogo del proveedor?'
      : `¿Eliminar ${skus.length} entradas del catálogo?`;
    if (!(await confirmar(msg, { titulo: 'Eliminar del catálogo', textoConfirmar: 'Eliminar' }))) return;
    eliminarMut.mutate(skus);
  }

  const provNombre = useMemo(
    () => proveedores.find((p) => String(p.id) === String(provId))?.nombre_empresa || '',
    [proveedores, provId]
  );

  function toggleSel(sku) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      next.has(sku) ? next.delete(sku) : next.add(sku);
      return next;
    });
  }

  const todosEnPaginaSeleccionados = rows.length > 0 && rows.every((r) => seleccionados.has(r.sku_proveedor));

  function toggleTodos() {
    if (todosEnPaginaSeleccionados) {
      setSeleccionados((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => next.delete(r.sku_proveedor));
        return next;
      });
    } else {
      setSeleccionados((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => next.add(r.sku_proveedor));
        return next;
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <BookOpen className="text-brand-500" size={22} />
        <h1 className="text-xl font-bold text-gray-900">Catálogo de proveedores</h1>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-xl p-3">
        <select
          value={provId}
          onChange={(e) => { setProvId(e.target.value); setPage(0); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre_empresa}</option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por SKU, descripción, referencia, fabricante o código INNOVACOM…"
            className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm"
          />
        </div>

        <select
          value={vinculado}
          onChange={(e) => { setVinculado(e.target.value); setPage(0); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Todos</option>
          <option value="1">Vinculados</option>
          <option value="0">Sin vincular</option>
        </select>

        <span className="text-sm text-gray-500 ml-auto">{total.toLocaleString()} productos</span>

        <button
          onClick={() => setAltaOpen(true)}
          disabled={!provId}
          className="flex items-center gap-1.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg px-3 py-2 disabled:opacity-50"
        >
          <Plus size={16} /> Agregar producto
        </button>
      </div>

      {/* Barra de acciones masivas */}
      {seleccionados.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-red-50 border border-red-200 rounded-xl">
          <span className="text-sm text-red-700 font-medium">{seleccionados.size} seleccionado{seleccionados.size > 1 ? 's' : ''}</span>
          <button
            onClick={() => eliminar([...seleccionados])}
            disabled={eliminarMut.isPending}
            className="flex items-center gap-1 text-sm text-red-600 hover:text-red-800 font-medium"
          >
            <Trash2 size={14} /> Eliminar seleccionados
          </button>
          <button onClick={() => setSeleccionados(new Set())} className="ml-auto text-xs text-gray-400 hover:text-gray-600">
            Cancelar selección
          </button>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-500"
                  checked={todosEnPaginaSeleccionados}
                  onChange={toggleTodos}
                />
              </th>
              <th className="px-3 py-2 font-medium">SKU prov.</th>
              <th className="px-3 py-2 font-medium">Descripción</th>
              <th className="px-3 py-2 font-medium">Ref. fabricante</th>
              <th className="px-3 py-2 font-medium">Fabricante</th>
              <th className="px-3 py-2 font-medium">Unidad</th>
              <th className="px-3 py-2 font-medium text-right">Precio</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Fecha precio</th>
              <th className="px-3 py-2 font-medium">SKU INNOVACOM</th>
              <th className="px-3 py-2 font-medium">Producto catálogo</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={11} className="px-3 py-10 text-center text-gray-400">
                <Loader2 className="inline animate-spin mr-2" size={16} />Cargando…
              </td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-10 text-center text-gray-400">Sin resultados</td></tr>
            ) : rows.map((r) => (
              <tr key={r.sku_proveedor} className={`border-b border-gray-50 hover:bg-gray-50 ${seleccionados.has(r.sku_proveedor) ? 'bg-red-50' : ''}`}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-500"
                    checked={seleccionados.has(r.sku_proveedor)}
                    onChange={() => toggleSel(r.sku_proveedor)}
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.sku_proveedor}</td>
                <td className="px-3 py-2">{r.descripcion || <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.referencia_fabricante || '—'}</td>
                <td className="px-3 py-2 text-gray-600">
                  <TextoEdit valor={r.fabricante} placeholder="fabricante"
                    onSave={(fabricante) => guardarMut.mutate({ sku: r.sku_proveedor, body: { fabricante } })} />
                </td>
                <td className="px-3 py-2 text-gray-500">{r.unidad_medida || '—'}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <PrecioEdit row={r} onSave={(precio_lista) => guardarMut.mutate({ sku: r.sku_proveedor, body: { precio_lista } })} />
                </td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap tabular-nums">
                  {r.fecha_precio ? <FechaPrecio valor={r.fecha_precio} meses={vigenciaCatalogoMeses} /> : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.sku_innovacom || <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2">
                  {r.producto_id ? (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <Check size={14} className="text-green-600" />
                      <span className="font-mono">{r.sku_interno}</span>
                      <button onClick={() => setPicker(r)} className="text-brand-500 hover:underline ml-1">cambiar</button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setPicker(r)}
                      className="inline-flex items-center gap-1 text-xs text-brand-500 hover:underline"
                    >
                      <Link2 size={14} /> Vincular
                    </button>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => eliminar([r.sku_proveedor])}
                    className="text-red-400 hover:text-red-600"
                    title="Eliminar del catálogo"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      <Pagination
        page={page + 1}
        totalPages={totalPages}
        total={total}
        from={total === 0 ? 0 : page * pageSize + 1}
        to={Math.min((page + 1) * pageSize, total)}
        onChange={(p) => setPage(p - 1)}
      />

      {/* Alta manual en el catálogo */}
      {altaOpen && (
        <AltaCatalogoModal
          provId={provId}
          provNombre={provNombre}
          onClose={() => setAltaOpen(false)}
          onCreated={() => {
            qc.invalidateQueries(['catalogo-prov']);
            setAltaOpen(false);
          }}
        />
      )}

      {/* Picker de producto para vincular */}
      {picker && (
        <ProductoPicker
          open={!!picker}
          onClose={() => setPicker(null)}
          partida={{ descripcion_original: picker.descripcion, codigo_cliente: picker.referencia_fabricante }}
          onSelect={(prod) => {
            guardarMut.mutate({ sku: picker.sku_proveedor, body: { producto_id: prod.id } });
            setPicker(null);
          }}
        />
      )}

      <p className="text-xs text-gray-400">
        Proveedor: <span className="font-medium">{provNombre}</span>. Este catálogo es la 1ª fuente de
        precios automáticos al cotizar; los precios se cargan desde el tarifario del proveedor.
      </p>

      {dialogoConfirm}
    </div>
  );
}

function AltaCatalogoModal({ provId, provNombre, onClose, onCreated }) {
  const [form, setForm] = useState({
    sku_proveedor: '', descripcion: '', referencia_fabricante: '',
    fabricante: '', unidad_medida: '', precio_lista: '', sku_innovacom: '',
  });
  const [producto, setProducto] = useState(null); // producto vinculado (opcional)
  const [pickerOpen, setPickerOpen] = useState(false);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const crearMut = useMutation({
    mutationFn: (body) => api.post(`/proveedores/${provId}/catalogo`, body),
    onSuccess: () => {
      toast.success('Producto agregado al catálogo');
      onCreated();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al agregar'),
  });

  function guardar() {
    if (!form.sku_proveedor.trim()) {
      toast.error('El SKU del proveedor es obligatorio');
      return;
    }
    let precio;
    if (form.precio_lista.trim() !== '') {
      precio = parseFloat(form.precio_lista.replace(',', '.'));
      if (!Number.isFinite(precio) || precio < 0) {
        toast.error('Captura un precio válido (mayor o igual a 0)');
        return;
      }
    }
    crearMut.mutate({
      ...form,
      sku_proveedor: form.sku_proveedor.trim(),
      precio_lista: precio,
      producto_id: producto?.id || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">
            Agregar producto — <span className="text-brand-500">{provNombre}</span>
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-1 text-xs text-gray-600 space-y-1">
            <span>SKU proveedor <span className="text-red-500">*</span></span>
            <input
              value={form.sku_proveedor} onChange={set('sku_proveedor')} autoFocus maxLength={40}
              placeholder='ej. AMB 091'
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="col-span-1 text-xs text-gray-600 space-y-1">
            <span>Ref. fabricante</span>
            <input
              value={form.referencia_fabricante} onChange={set('referencia_fabricante')} maxLength={80}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="col-span-2 text-xs text-gray-600 space-y-1">
            <span>Descripción</span>
            <textarea
              value={form.descripcion} onChange={set('descripcion')} maxLength={800} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y"
            />
          </label>
          <label className="col-span-1 text-xs text-gray-600 space-y-1">
            <span>Fabricante</span>
            <input
              value={form.fabricante} onChange={set('fabricante')} maxLength={100}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="col-span-1 text-xs text-gray-600 space-y-1">
            <span>Unidad de medida</span>
            <input
              value={form.unidad_medida} onChange={set('unidad_medida')} maxLength={20}
              placeholder="PIEZA / CAJA / PAR / KIT"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="col-span-1 text-xs text-gray-600 space-y-1">
            <span>Precio de lista (sin IVA)</span>
            <input
              type="text" inputMode="decimal"
              value={form.precio_lista} onChange={set('precio_lista')}
              placeholder="0.00"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right tabular-nums"
            />
          </label>
          <label className="col-span-1 text-xs text-gray-600 space-y-1">
            <span>SKU INNOVACOM</span>
            <input
              value={form.sku_innovacom} onChange={set('sku_innovacom')} maxLength={20}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </label>
          <div className="col-span-1 text-xs text-gray-600 space-y-1">
            <span>Producto del catálogo (opcional)</span>
            {producto ? (
              <div className="flex items-center gap-1 text-xs pt-1.5">
                <Check size={14} className="text-green-600" />
                <span className="font-mono">{producto.sku_interno}</span>
                <button onClick={() => setProducto(null)} className="text-gray-400 hover:text-red-500 ml-1">
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setPickerOpen(true)}
                className="flex items-center gap-1 text-xs text-brand-500 hover:underline pt-1.5"
              >
                <Link2 size={14} /> Vincular producto
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={crearMut.isPending}
            className="flex items-center gap-1.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {crearMut.isPending && <Loader2 className="animate-spin" size={14} />}
            Guardar
          </button>
        </div>

        {pickerOpen && (
          <ProductoPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            partida={{ descripcion_original: form.descripcion, codigo_cliente: form.referencia_fabricante }}
            onSelect={(prod) => {
              setProducto(prod);
              setPickerOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

function FechaPrecio({ valor, meses = 11 }) {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return <span>{String(valor).slice(0, 10)}</span>;
  const limite = new Date();
  limite.setMonth(limite.getMonth() - meses);
  const vencido = fecha < limite;
  const txt = fecha.toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return (
    <span
      className={vencido ? 'text-red-500' : ''}
      title={vencido ? `Precio con más de ${meses} meses: requiere reconfirmar` : 'Precio vigente'}
    >
      {txt}{vencido && ' ⚠'}
    </span>
  );
}

function TextoEdit({ valor, onSave, placeholder = '' }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(valor ?? '');
  useEffect(() => { setVal(valor ?? ''); }, [valor]);

  function guardar() {
    setEdit(false);
    if ((val ?? '') !== (valor ?? '')) onSave(val);
  }

  if (!edit) {
    return (
      <button onClick={() => setEdit(true)} className="hover:underline text-left">
        {valor ? valor : <span className="text-gray-300">— editar</span>}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text" value={val} autoFocus maxLength={100} placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEdit(false); }}
        className="w-36 border border-brand-300 rounded px-2 py-1 text-xs"
      />
      <button onClick={guardar} className="text-green-600"><Check size={15} /></button>
    </span>
  );
}

function PrecioEdit({ row, onSave }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(row.precio_lista ?? '');
  useEffect(() => { setVal(row.precio_lista ?? ''); }, [row.precio_lista]);

  function guardar() {
    const n = parseFloat(val);
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Captura un precio válido (mayor o igual a 0)');
      return;
    }
    setEdit(false);
    if (n !== Number(row.precio_lista)) onSave(n);
  }

  function cancelar() {
    setVal(row.precio_lista ?? '');
    setEdit(false);
  }

  if (!edit) {
    return (
      <button onClick={() => setEdit(true)} className="hover:underline tabular-nums">
        {row.precio_lista != null
          ? `$${Number(row.precio_lista).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
          : <span className="text-gray-300">— editar</span>}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number" step="0.01" min="0" value={val} autoFocus
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') cancelar(); }}
        className="w-24 border border-brand-300 rounded px-2 py-1 text-right text-xs"
      />
      <button onClick={guardar} className="text-green-600"><Check size={15} /></button>
      <button onClick={cancelar} className="text-gray-400 hover:text-red-500"><X size={15} /></button>
    </span>
  );
}
