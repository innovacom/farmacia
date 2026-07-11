import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Plus, Loader2, Package, Search, Upload, Trash2 } from 'lucide-react';
import api from '../../services/api';
import ImportCatalogoModal from './ImportCatalogoModal';
import { usePrefsStore } from '../../store/prefsStore';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import CuentaContableSelect from '../../components/shared/CuentaContableSelect';

const FORM_VACIO = {
  sku_interno: '', descripcion: '', familia_id: '', categoria_id: '', subcategoria_id: '',
  unidad_medida_id: '', unidad_medida: '', unidad_base: 'pieza', factor_empaque: 1,
  control_lote_caducidad: 1, precio_lista: '', precio_publico: '', iva_exento: 0,
  clave_sat: '', clave_unidad_sat: '', fabricante: '', ean: '',
  clasificacion_cofepris: 'libre',
  cuenta_ingreso_codigo: '', cuenta_costo_codigo: '',
};

export default function ProductosList() {
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editando, setEditando] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [busquedaDeb, setBusquedaDeb] = useState('');
  const [filtroFamilia, setFiltroFamilia] = useState('');
  const [page, setPage] = useState(0);
  const [form, setForm] = useState(FORM_VACIO);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const pageSize = usePrefsStore((s) => s.rowsPerPage);

  useEffect(() => { setPage(0); }, [pageSize, filtroFamilia]);
  useEffect(() => {
    const t = setTimeout(() => { setBusquedaDeb(busqueda); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  // ── Datos de apoyo ──────────────────────────────────────────────────────
  const { data: familias = [] } = useQuery({
    queryKey: ['familias'],
    queryFn: () => api.get('/catalogos/familias').then((r) => r.data),
  });
  const { data: unidades = [] } = useQuery({
    queryKey: ['unidades'],
    queryFn: () => api.get('/catalogos/unidades').then((r) => r.data),
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias', form.familia_id],
    queryFn: () => api.get('/catalogos/categorias', { params: { familia_id: form.familia_id } }).then((r) => r.data),
    enabled: !!form.familia_id,
  });
  const { data: subcategorias = [] } = useQuery({
    queryKey: ['subcategorias', form.categoria_id],
    queryFn: () => api.get('/catalogos/subcategorias', { params: { categoria_id: form.categoria_id } }).then((r) => r.data),
    enabled: !!form.categoria_id,
  });

  // ── Lista de productos (paginación en servidor: se ve TODO el catálogo) ──
  const { data, isLoading } = useQuery({
    queryKey: ['productos', busquedaDeb, filtroFamilia, page, pageSize],
    queryFn: () => api.get('/productos', {
      params: {
        q: busquedaDeb || undefined,
        familia_id: filtroFamilia || undefined,
        limit: pageSize,
        offset: page * pageSize,
      },
    }).then((r) => r.data),
    keepPreviousData: true,
  });

  const pageItems  = data?.rows || [];
  const total      = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const guardarMut = useMutation({
    mutationFn: (payload) =>
      editando ? api.put(`/productos/${editando.id}`, payload) : api.post('/productos', payload),
    onSuccess: (res) => {
      toast.success(editando ? 'Producto actualizado' : `Producto creado — SKU: ${res.data?.sku_interno || ''}`);
      qc.invalidateQueries(['productos']);
      cerrar();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const bajaMut = useMutation({
    mutationFn: (ids) =>
      ids.length === 1
        ? api.delete(`/productos/${ids[0]}`)
        : api.post('/productos/baja-masiva', { ids }),
    onSuccess: (_, ids) => {
      toast.success(ids.length === 1 ? 'Producto dado de baja' : `${ids.length} productos dados de baja`);
      qc.invalidateQueries(['productos']);
      setSeleccionados(new Set());
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al dar de baja'),
  });

  async function darDeBaja(ids) {
    const msg = ids.length === 1
      ? '¿Dar de baja este producto? No aparecerá en nuevas cotizaciones.'
      : `¿Dar de baja ${ids.length} productos seleccionados?`;
    if (!(await confirmar(msg, { titulo: 'Dar de baja', textoConfirmar: 'Dar de baja' }))) return;
    bajaMut.mutate(ids);
  }

  function abrirNuevo() { setEditando(null); setForm(FORM_VACIO); setShowModal(true); }

  function abrirEditar(p) {
    setEditando(p);
    setForm({
      sku_interno: p.sku_interno || '', descripcion: p.descripcion || '',
      familia_id: p.familia_id || '', categoria_id: p.categoria_id || '', subcategoria_id: p.subcategoria_id || '',
      unidad_medida_id: '', unidad_medida: p.unidad_medida || '',
      unidad_base: p.unidad_base || 'pieza', factor_empaque: p.factor_empaque ?? 1,
      control_lote_caducidad: p.control_lote_caducidad ?? 1,
      precio_lista: p.precio_lista ?? '', precio_publico: p.precio_publico ?? '',
      iva_exento: p.iva_exento ?? 0, clave_sat: p.clave_sat || '', clave_unidad_sat: p.clave_unidad_sat || '',
      fabricante: p.fabricante || '', ean: p.ean || '',
      clasificacion_cofepris: p.clasificacion_cofepris || 'libre',
      cuenta_ingreso_codigo: p.cuenta_ingreso_codigo || '', cuenta_costo_codigo: p.cuenta_costo_codigo || '',
    });
    setShowModal(true);
  }

  function cerrar() { setShowModal(false); setEditando(null); setForm(FORM_VACIO); }
  function set(campo, valor) { setForm((f) => ({ ...f, [campo]: valor })); }

  function onFamilia(id) { setForm((f) => ({ ...f, familia_id: id, categoria_id: '', subcategoria_id: '' })); }
  function onCategoria(id) { setForm((f) => ({ ...f, categoria_id: id, subcategoria_id: '' })); }
  function onUnidad(id) {
    const u = unidades.find((x) => String(x.id) === String(id));
    setForm((f) => ({ ...f, unidad_medida_id: id, unidad_medida: u?.nombre || '',
      factor_empaque: u?.factor_sugerido ?? f.factor_empaque }));
  }

  function submit(e) {
    e.preventDefault();
    if (!form.descripcion?.trim()) return toast.error('Descripción requerida');
    if (!form.familia_id || !form.categoria_id || !form.subcategoria_id)
      return toast.error('Familia, categoría y subcategoría son obligatorias');
    if (form.precio_lista === '' || form.precio_lista == null)
      return toast.error('Precio de lista obligatorio');
    const payload = {
      ...form,
      precio_lista: parseFloat(form.precio_lista) || 0,
      precio_publico: form.precio_publico === '' ? null : parseFloat(form.precio_publico),
      factor_empaque: parseFloat(form.factor_empaque) || 1,
      cuenta_ingreso_codigo: form.cuenta_ingreso_codigo || null,
      cuenta_costo_codigo: form.cuenta_costo_codigo || null,
    };
    if (editando) delete payload.sku_interno;
    guardarMut.mutate(payload);
  }

  function toggleSel(id) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const todosEnPaginaSeleccionados = pageItems.length > 0 && pageItems.every((p) => seleccionados.has(p.id));

  function toggleTodos() {
    if (todosEnPaginaSeleccionados) {
      setSeleccionados((prev) => {
        const next = new Set(prev);
        pageItems.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSeleccionados((prev) => {
        const next = new Set(prev);
        pageItems.forEach((p) => next.add(p.id));
        return next;
      });
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Catálogo de productos</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="btn-secondary">
            <Upload size={16} /> Importar catálogo
          </button>
          <button onClick={abrirNuevo} className="btn-primary">
            <Plus size={16} /> Nuevo producto
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar por SKU o descripción…"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <select className="input w-56" value={filtroFamilia} onChange={(e) => setFiltroFamilia(e.target.value)}>
          <option value="">Todas las familias</option>
          {familias.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
        </select>
      </div>

      {/* Barra de acciones masivas */}
      {seleccionados.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 bg-red-50 border border-red-200 rounded-xl">
          <span className="text-sm text-red-700 font-medium">{seleccionados.size} seleccionado{seleccionados.size > 1 ? 's' : ''}</span>
          <button
            onClick={() => darDeBaja([...seleccionados])}
            disabled={bajaMut.isPending}
            className="flex items-center gap-1 text-sm text-red-600 hover:text-red-800 font-medium"
          >
            <Trash2 size={14} /> Dar de baja seleccionados
          </button>
          <button onClick={() => setSeleccionados(new Set())} className="ml-auto text-xs text-gray-400 hover:text-gray-600">
            Cancelar selección
          </button>
        </div>
      )}

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
        ) : total === 0 ? (
          <div className="text-center py-12">
            <Package size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">{busqueda || filtroFamilia ? 'No se encontraron productos' : 'Sin productos registrados'}</p>
            {!busqueda && !filtroFamilia && (
              <p className="text-xs text-gray-400 mt-1">Usa «Importar catálogo» para cargar el archivo maestro.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-auto w-full text-sm">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-500"
                      checked={todosEnPaginaSeleccionados}
                      onChange={toggleTodos}
                    />
                  </th>
                  <th>SKU</th>
                  <th>Descripción</th>
                  <th>Familia / Categoría</th>
                  <th className="text-center">U/M</th>
                  <th className="text-center">Lote/Cad.</th>
                  <th className="text-center">IVA</th>
                  <th className="text-right">P. Lista</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => (
                  <tr key={p.id} className={seleccionados.has(p.id) ? 'bg-red-50' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-500"
                        checked={seleccionados.has(p.id)}
                        onChange={() => toggleSel(p.id)}
                      />
                    </td>
                    <td className="font-mono text-xs font-semibold text-brand-500">{p.sku_interno}</td>
                    <td className="max-w-md">
                      <p className="font-medium">{p.descripcion}</p>
                      {p.fabricante && <p className="text-xs text-gray-400">{p.fabricante}</p>}
                    </td>
                    <td className="text-xs">
                      <span className="text-gray-700">{p.familia_nombre || '—'}</span>
                      {p.categoria_nombre && <span className="text-gray-400"> · {p.categoria_nombre}</span>}
                    </td>
                    <td className="text-center text-xs">{p.unidad_medida}</td>
                    <td className="text-center">
                      {p.control_lote_caducidad
                        ? <span className="badge-green">Sí</span>
                        : <span className="badge-gray">No</span>}
                    </td>
                    <td className="text-center text-xs">{p.iva_exento ? 'Exento' : '16%'}</td>
                    <td className="text-right">{p.precio_lista != null
                      ? Number(p.precio_lista).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
                      : '—'}</td>
                    <td>
                      <div className="flex items-center gap-3">
                        <button onClick={() => abrirEditar(p)} className="text-xs text-brand-500 hover:underline">Editar</button>
                        <button
                          onClick={() => darDeBaja([p.id])}
                          className="text-xs text-red-400 hover:text-red-600"
                          title="Dar de baja"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && (
          <Pagination
            page={page + 1}
            totalPages={totalPages}
            total={total}
            from={total === 0 ? 0 : page * pageSize + 1}
            to={Math.min((page + 1) * pageSize, total)}
            onChange={(p) => setPage(p - 1)}
          />
        )}
      </div>

      {/* Modal alta/edición */}
      {showModal && (
        <Modal size="lg" title={editando ? 'Editar producto' : 'Nuevo producto'} onClose={cerrar}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">SKU (código INNOVACOM) {editando ? '' : '*'}</label>
                <input className="input font-mono" placeholder="INAP00238" value={form.sku_interno}
                  disabled={!!editando} onChange={(e) => set('sku_interno', e.target.value)} />
                {!editando && <p className="text-xs text-gray-400 mt-0.5">Déjalo vacío para autogenerar DM-#####</p>}
              </div>
              <div>
                <label className="label">Fabricante / Laboratorio</label>
                <input className="input" value={form.fabricante} onChange={(e) => set('fabricante', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label">Descripción *</label>
              <input className="input" value={form.descripcion} onChange={(e) => set('descripcion', e.target.value)} />
            </div>

            {/* Taxonomía encadenada */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Familia *</label>
                <select className="input" value={form.familia_id} onChange={(e) => onFamilia(e.target.value)}>
                  <option value="">—</option>
                  {familias.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Categoría *</label>
                <select className="input" value={form.categoria_id} disabled={!form.familia_id}
                  onChange={(e) => onCategoria(e.target.value)}>
                  <option value="">—</option>
                  {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Subcategoría *</label>
                <select className="input" value={form.subcategoria_id} disabled={!form.categoria_id}
                  onChange={(e) => set('subcategoria_id', e.target.value)}>
                  <option value="">—</option>
                  {subcategorias.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
            </div>

            {/* Unidad + inventario */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Unidad de venta</label>
                <select className="input" value={form.unidad_medida_id} onChange={(e) => onUnidad(e.target.value)}>
                  <option value="">{form.unidad_medida || '—'}</option>
                  {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Unidad base inventario</label>
                <select className="input" value={form.unidad_base} onChange={(e) => set('unidad_base', e.target.value)}>
                  <option value="pieza">Pieza</option>
                  <option value="empaque">Empaque</option>
                </select>
              </div>
              <div>
                <label className="label">Factor empaque (pzas)</label>
                <input type="number" min="1" step="1" className="input" value={form.factor_empaque}
                  onChange={(e) => set('factor_empaque', e.target.value)} />
              </div>
            </div>

            {/* Precios + flags */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Precio de lista *</label>
                <input type="number" min="0" step="0.01" className="input" value={form.precio_lista}
                  onChange={(e) => set('precio_lista', e.target.value)} />
              </div>
              <div>
                <label className="label">Precio público</label>
                <input type="number" min="0" step="0.01" className="input" value={form.precio_publico}
                  onChange={(e) => set('precio_publico', e.target.value)} />
              </div>
              <div className="flex flex-col gap-2 pt-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-brand-500"
                    checked={!form.iva_exento} onChange={(e) => set('iva_exento', e.target.checked ? 0 : 1)} />
                  Calcula IVA 16%
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-brand-500"
                    checked={!!form.control_lote_caducidad}
                    onChange={(e) => set('control_lote_caducidad', e.target.checked ? 1 : 0)} />
                  Control de lote y caducidad
                </label>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Clave SAT</label>
                <input className="input font-mono" value={form.clave_sat} onChange={(e) => set('clave_sat', e.target.value)} />
              </div>
              <div>
                <label className="label">Unidad SAT</label>
                <input className="input font-mono" value={form.clave_unidad_sat} onChange={(e) => set('clave_unidad_sat', e.target.value)} />
              </div>
              <div>
                <label className="label">EAN / código barras</label>
                <input className="input font-mono" value={form.ean} onChange={(e) => set('ean', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label">Clasificación COFEPRIS (venta en mostrador)</label>
              <select
                className="input"
                value={form.clasificacion_cofepris}
                onChange={(e) => set('clasificacion_cofepris', e.target.value)}
              >
                <option value="libre">Venta libre (fracción VI)</option>
                <option value="venta_farmacia">Venta en farmacia sin receta (fracción V)</option>
                <option value="antibiotico">Antibiótico — receta retenida (fracción IV)</option>
                <option value="fraccion_iii">Fracción III — receta, hasta 3 surtimientos</option>
                <option value="fraccion_ii">Fracción II — receta retenida, libro de control</option>
                <option value="fraccion_i">Fracción I — receta especial, libro de control</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Antibióticos y fracciones I–III exigen receta al vender en el POS y se registran en la bitácora COFEPRIS.
              </p>
            </div>

            {/* Cuentas contables (Código Agrupador SAT) */}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Contabilidad</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Cuenta de ingreso (venta)</label>
                  <CuentaContableSelect
                    value={form.cuenta_ingreso_codigo}
                    onChange={(v) => set('cuenta_ingreso_codigo', v)}
                    rubro="Ingresos"
                    placeholder="Sin asignar (def. 401 Ingresos)"
                  />
                </div>
                <div>
                  <label className="label">Cuenta de costo de venta</label>
                  <CuentaContableSelect
                    value={form.cuenta_costo_codigo}
                    onChange={(v) => set('cuenta_costo_codigo', v)}
                    rubro="Costos"
                    placeholder="Sin asignar (def. 501 Costo de venta)"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={guardarMut.isPending} className="btn-primary">
                {guardarMut.isPending && <Loader2 size={15} className="animate-spin" />}
                {editando ? 'Guardar cambios' : 'Crear producto'}
              </button>
              <button type="button" onClick={cerrar} className="btn-secondary">Cancelar</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal importación */}
      {showImport && (
        <ImportCatalogoModal
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); qc.invalidateQueries(['productos']); }}
        />
      )}

      {dialogoConfirm}
    </div>
  );
}
