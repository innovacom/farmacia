import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Percent, Plus, Pencil, Trash2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const DIAS_SEMANA = [
  { v: 1, label: 'Lun' }, { v: 2, label: 'Mar' }, { v: 3, label: 'Mié' },
  { v: 4, label: 'Jue' }, { v: 5, label: 'Vie' }, { v: 6, label: 'Sáb' }, { v: 7, label: 'Dom' },
];

const ALCANCES = [
  { v: 'todos', label: 'Todos los productos' },
  { v: 'familia', label: 'Una familia' },
  { v: 'categoria', label: 'Una categoría' },
  { v: 'subcategoria', label: 'Una subcategoría' },
  { v: 'productos', label: 'Productos elegidos a mano' },
];

const REQUIERE_CLIENTE = [
  { v: 'nadie', label: 'Cualquier cliente' },
  { v: 'adulto_mayor', label: 'Solo con tarjeta de adulto mayor' },
  { v: 'programa_lealtad', label: 'Solo asociados al programa de lealtad' },
];

function resumenAlcance(promo) {
  let base;
  if (promo.tipo_alcance === 'todos') base = 'Todos (excepto consultas médicas)';
  else if (promo.tipo_alcance === 'productos') base = `${promo.productos?.length || 0} producto(s)`;
  else {
    const etiqueta = ALCANCES.find((a) => a.v === promo.tipo_alcance)?.label || promo.tipo_alcance;
    base = promo.alcance_nombre ? `${etiqueta}: ${promo.alcance_nombre}` : etiqueta;
  }
  if (promo.requiere_cliente && promo.requiere_cliente !== 'nadie') {
    base += ` · ${REQUIERE_CLIENTE.find((r) => r.v === promo.requiere_cliente)?.label}`;
  }
  return base;
}

function resumenVigencia(promo) {
  const dias = promo.dias_semana.length
    ? promo.dias_semana.map((d) => DIAS_SEMANA.find((x) => x.v === d)?.label).join(', ')
    : 'Todos los días';
  const rango = promo.vigencia_desde || promo.vigencia_hasta
    ? ` (${promo.vigencia_desde || '…'} a ${promo.vigencia_hasta || '…'})`
    : '';
  return dias + rango;
}

/**
 * Promociones automáticas del mostrador (permiso pos-promociones, solo
 * admin): reglas de % de descuento que se aplican SOLAS en la venta (el
 * cajero no hace nada) según alcance (todos/familia/categoría/subcategoría/
 * productos elegidos a mano) y vigencia (día de la semana y/o rango de
 * fechas). Ver pos.promociones.service.js#descuentosPara — el backend es la
 * fuente de verdad, esta pantalla solo administra las reglas.
 * Nunca tocan la familia MEDICO en alcance "todos", ni productos que
 * requieren receta en ningún alcance — reglas duras del resolver, no
 * configurables desde aquí.
 */
export default function Promociones() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null); // null | {} (nueva) | promo (editar)
  const { confirmar, dialogoConfirm } = useConfirm();

  const { data = [], isLoading } = useQuery({
    queryKey: ['pos-promociones'],
    queryFn: () => api.get('/pos/promociones').then((r) => r.data),
  });

  const eliminar = useMutation({
    mutationFn: (id) => api.delete(`/pos/promociones/${id}`),
    onSuccess: () => { toast.success('Promoción desactivada'); qc.invalidateQueries({ queryKey: ['pos-promociones'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al desactivar'),
  });

  async function pedirEliminar(promo) {
    if (await confirmar(`¿Desactivar la promoción "${promo.nombre}"?`, { titulo: 'Desactivar promoción' })) {
      eliminar.mutate(promo.id);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Percent size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Promociones</h1>
        </div>
        <button className="btn-primary" onClick={() => setModal({})}>
          <Plus size={16} /> Nueva promoción
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Descuentos automáticos en el mostrador — el cajero no hace nada, el sistema aplica el % vigente al vender.
        Nunca aplican a consultas médicas (alcance "todos") ni a productos que requieren receta.
      </p>

      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>Nombre</th><th>Alcance</th><th className="text-right">%</th>
              <th>Vigencia</th><th className="text-center">Activa</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className={!p.activo ? 'opacity-50' : ''}>
                <td className="font-medium text-gray-900">{p.nombre}</td>
                <td className="text-gray-600">{resumenAlcance(p)}</td>
                <td className="text-right font-semibold">{p.porcentaje}%</td>
                <td className="text-gray-500 text-sm">{resumenVigencia(p)}</td>
                <td className="text-center">
                  {p.activo ? <span className="badge-green">Sí</span> : <span className="badge-gray">No</span>}
                </td>
                <td>
                  <div className="flex items-center gap-1 justify-end">
                    <button className="p-1.5 text-gray-400 hover:text-brand-500 rounded-lg" title="Editar" onClick={() => setModal(p)}>
                      <Pencil size={15} />
                    </button>
                    <button className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg" title="Desactivar" onClick={() => pedirEliminar(p)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && !data.length && (
              <tr><td colSpan={6} className="text-center text-gray-400 py-8">Sin promociones configuradas.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <ModalPromocion
          promo={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['pos-promociones'] }); setModal(null); }}
        />
      )}

      {dialogoConfirm}
    </div>
  );
}

function ModalPromocion({ promo, onClose, onSaved }) {
  const editar = !!promo;
  const [form, setForm] = useState({
    nombre: promo?.nombre || '',
    porcentaje: promo?.porcentaje ?? '',
    tipo_alcance: promo?.tipo_alcance || 'todos',
    alcance_id: promo?.alcance_id || '',
    requiere_cliente: promo?.requiere_cliente || 'nadie',
    dias_semana: promo?.dias_semana || [],
    vigencia_desde: promo?.vigencia_desde || '',
    vigencia_hasta: promo?.vigencia_hasta || '',
    activo: promo ? !!promo.activo : true,
  });
  const [productos, setProductos] = useState(promo?.productos || []);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const { data: familias = [] } = useQuery({
    queryKey: ['familias', 'activos'],
    queryFn: () => api.get('/catalogos/familias', { params: { estatus: 'activos' } }).then((r) => r.data),
    enabled: ['familia', 'categoria', 'subcategoria'].includes(form.tipo_alcance),
  });
  // Para categoría/subcategoría, la familia es solo un filtro en cascada
  // (no se guarda) — se busca la familia dueña de la categoría/subcategoría
  // ya elegida al editar, para que el combo abra en el lugar correcto.
  const [familiaFiltro, setFamiliaFiltro] = useState('');
  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias', familiaFiltro, 'activos'],
    queryFn: () => api.get('/catalogos/categorias', { params: { familia_id: familiaFiltro, estatus: 'activos' } }).then((r) => r.data),
    enabled: ['categoria', 'subcategoria'].includes(form.tipo_alcance) && !!familiaFiltro,
  });
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const { data: subcategorias = [] } = useQuery({
    queryKey: ['subcategorias', categoriaFiltro, 'activos'],
    queryFn: () => api.get('/catalogos/subcategorias', { params: { categoria_id: categoriaFiltro, estatus: 'activos' } }).then((r) => r.data),
    enabled: form.tipo_alcance === 'subcategoria' && !!categoriaFiltro,
  });

  const guardar = useMutation({
    mutationFn: (body) => (editar
      ? api.put(`/pos/promociones/${promo.id}`, body)
      : api.post('/pos/promociones', body)),
    onSuccess: () => { toast.success(editar ? 'Promoción actualizada' : 'Promoción creada'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  function toggleDia(v) {
    set('dias_semana', form.dias_semana.includes(v)
      ? form.dias_semana.filter((d) => d !== v)
      : [...form.dias_semana, v].sort());
  }

  function guardarClick() {
    guardar.mutate({
      ...form,
      porcentaje: Number(form.porcentaje),
      alcance_id: ['familia', 'categoria', 'subcategoria'].includes(form.tipo_alcance) ? Number(form.alcance_id) : null,
      vigencia_desde: form.vigencia_desde || null,
      vigencia_hasta: form.vigencia_hasta || null,
      producto_ids: form.tipo_alcance === 'productos' ? productos.map((p) => p.producto_id) : undefined,
    });
  }

  const alcanceValido = form.tipo_alcance === 'todos'
    || (form.tipo_alcance === 'productos' ? productos.length > 0 : !!form.alcance_id);
  const valido = form.nombre.trim() && Number(form.porcentaje) > 0 && Number(form.porcentaje) <= 100 && alcanceValido;

  return (
    <Modal title={editar ? 'Editar promoción' : 'Nueva promoción'} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="label">Nombre</label>
            <input className="input" autoFocus value={form.nombre} onChange={(e) => set('nombre', e.target.value)}
              placeholder="Descuento lunes, promo fin de mes…" />
          </div>
          <div>
            <label className="label">% de descuento</label>
            <input type="number" min="0.01" max="100" step="0.01" className="input"
              value={form.porcentaje} onChange={(e) => set('porcentaje', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Aplica a</label>
            <select className="input" value={form.tipo_alcance}
              onChange={(e) => { set('tipo_alcance', e.target.value); set('alcance_id', ''); setFamiliaFiltro(''); setCategoriaFiltro(''); }}>
              {ALCANCES.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Descuento permanente para (fidelidad)</label>
            <select className="input" value={form.requiere_cliente} onChange={(e) => set('requiere_cliente', e.target.value)}>
              {REQUIERE_CLIENTE.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
            </select>
          </div>
        </div>

        {['familia', 'categoria', 'subcategoria'].includes(form.tipo_alcance) && (
          <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-lg p-3">
            <div>
              <label className="label">Familia</label>
              <select className="input" value={familiaFiltro}
                onChange={(e) => { setFamiliaFiltro(e.target.value); setCategoriaFiltro(''); if (form.tipo_alcance === 'familia') set('alcance_id', e.target.value); }}>
                <option value="">— Elegir —</option>
                {familias.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
              </select>
            </div>
            {form.tipo_alcance !== 'familia' && (
              <div>
                <label className="label">Categoría</label>
                <select className="input" value={categoriaFiltro} disabled={!familiaFiltro}
                  onChange={(e) => { setCategoriaFiltro(e.target.value); if (form.tipo_alcance === 'categoria') set('alcance_id', e.target.value); }}>
                  <option value="">— Elegir —</option>
                  {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
            )}
            {form.tipo_alcance === 'subcategoria' && (
              <div className="col-span-2">
                <label className="label">Subcategoría</label>
                <select className="input" value={form.alcance_id} disabled={!categoriaFiltro}
                  onChange={(e) => set('alcance_id', e.target.value)}>
                  <option value="">— Elegir —</option>
                  {subcategorias.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {form.tipo_alcance === 'productos' && (
          <div className="bg-gray-50 rounded-lg p-3">
            <label className="label">Productos</label>
            {!!productos.length && (
              <div className="flex flex-wrap gap-2 mb-2">
                {productos.map((p) => (
                  <span key={p.producto_id} className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border border-brand-100 bg-brand-50 text-brand-700 text-xs">
                    {p.descripcion}
                    <button type="button" className="hover:text-red-500" onClick={() => setProductos((ps) => ps.filter((x) => x.producto_id !== p.producto_id))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <BuscadorProductos
              excluir={productos.map((p) => p.producto_id)}
              onElegir={(p) => setProductos((ps) => [...ps, p])}
            />
          </div>
        )}

        <div>
          <label className="label">Días de la semana (ninguno seleccionado = todos los días)</label>
          <div className="flex gap-1.5 flex-wrap">
            {DIAS_SEMANA.map((d) => (
              <button key={d.v} type="button"
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors
                  ${form.dias_semana.includes(d.v) ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                onClick={() => toggleDia(d.v)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Vigencia desde (opcional)</label>
            <input type="date" className="input" value={form.vigencia_desde} onChange={(e) => set('vigencia_desde', e.target.value)} />
          </div>
          <div>
            <label className="label">Vigencia hasta (opcional)</label>
            <input type="date" className="input" value={form.vigencia_hasta} onChange={(e) => set('vigencia_hasta', e.target.value)} />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.activo} onChange={(e) => set('activo', e.target.checked)} />
              Activa
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!valido || guardar.isPending} onClick={guardarClick}>
            {editar ? 'Guardar cambios' : 'Crear promoción'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Typeahead de productos para el alcance "productos" — mismo patrón que
// BuscadorFavoritos (Pos/Sucursales.jsx), reusando GET /pos/productos/buscar.
// Ese endpoint pide sucursal_id solo para calcular existencia (que aquí no
// importa, una promoción no es por sucursal); se usa la primera sucursal
// activa nada más para satisfacer el parámetro.
function BuscadorProductos({ excluir, onElegir }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState([]);
  const { data: sucursales = [] } = useQuery({
    queryKey: ['pos-sucursales'],
    queryFn: () => api.get('/pos/sucursales').then((r) => r.data),
  });
  const sucursalId = sucursales[0]?.id;

  useEffect(() => {
    if (!q.trim() || !sucursalId) { setResultados([]); return; }
    const t = setTimeout(() => {
      api.get('/pos/productos/buscar', { params: { q: q.trim(), sucursal_id: sucursalId } })
        .then((r) => setResultados(r.data.filter((p) => !excluir.includes(p.producto_id))))
        .catch(() => setResultados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, sucursalId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input pl-8 text-sm" placeholder="Buscar producto por SKU o descripción…"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!!resultados.length && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {resultados.map((p) => (
            <button key={p.producto_id} type="button"
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-50 text-sm"
              onClick={() => { onElegir(p); setQ(''); setResultados([]); }}>
              <span className="truncate">{p.descripcion}</span>
              <span className="text-xs text-gray-400 font-mono shrink-0">{p.sku_interno}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
