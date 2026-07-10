import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Loader2, Truck, Trash2, Search } from 'lucide-react';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import CuentaContableSelect from '../../components/shared/CuentaContableSelect';

const CATEGORIAS = [
  'medicamento', 'material_curacion', 'ropa_hospital',
  'equipo_clinica', 'laboratorio', 'detergente', 'otro',
];

export default function ProveedoresList() {
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [selCats, setSelCats] = useState([]);
  const [ctaPasivo, setCtaPasivo] = useState('');
  const [ctaGasto, setCtaGasto] = useState('');
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [q, setQ] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get('/proveedores').then((r) => r.data),
  });

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return data;
    return data.filter((p) =>
      `${p.nombre_empresa} ${p.rfc || ''} ${p.nombre_contacto || ''} ${p.email_cotizaciones || ''}`
        .toLowerCase().includes(t)
    );
  }, [data, q]);

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(filtrados);

  const { register, handleSubmit, reset, formState: { errors } } = useForm();

  const guardarMut = useMutation({
    mutationFn: (data) => {
      const payload = {
        ...data,
        categorias: selCats,
        cuenta_pasivo_codigo: ctaPasivo || null,
        cuenta_gasto_codigo: ctaGasto || null,
      };
      return editando
        ? api.put(`/proveedores/${editando.id}`, payload)
        : api.post('/proveedores', payload);
    },
    onSuccess: () => {
      toast.success(editando ? 'Proveedor actualizado' : 'Proveedor creado');
      qc.invalidateQueries(['proveedores']);
      setShowModal(false);
      setEditando(null);
      reset();
      setSelCats([]);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const bajaMut = useMutation({
    mutationFn: (ids) =>
      ids.length === 1
        ? api.delete(`/proveedores/${ids[0]}`)
        : api.post('/proveedores/baja-masiva', { ids }),
    onSuccess: (_, ids) => {
      toast.success(ids.length === 1 ? 'Proveedor dado de baja' : `${ids.length} proveedores dados de baja`);
      qc.invalidateQueries(['proveedores']);
      setSeleccionados(new Set());
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al dar de baja'),
  });

  async function darDeBaja(ids) {
    const msg = ids.length === 1
      ? '¿Dar de baja este proveedor?'
      : `¿Dar de baja ${ids.length} proveedores seleccionados?`;
    if (!(await confirmar(msg, { titulo: 'Dar de baja', textoConfirmar: 'Dar de baja' }))) return;
    bajaMut.mutate(ids);
  }

  function abrirNuevo() {
    setEditando(null);
    reset({});
    setSelCats([]);
    setCtaPasivo('');
    setCtaGasto('');
    setShowModal(true);
  }

  function abrirEditar(p) {
    setEditando(p);
    reset(p);
    setSelCats(p.categorias || []);
    setCtaPasivo(p.cuenta_pasivo_codigo || '');
    setCtaGasto(p.cuenta_gasto_codigo || '');
    setShowModal(true);
  }

  function toggleCat(cat) {
    setSelCats((prev) => prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]);
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Proveedores</h1>
        <button onClick={abrirNuevo} className="btn-primary">
          <Plus size={16} /> Nuevo proveedor
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar por empresa, RFC o contacto…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
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
        ) : data.length === 0 ? (
          <div className="text-center py-12">
            <Truck size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">Sin proveedores registrados</p>
            <button onClick={abrirNuevo} className="btn-primary mt-4">Agregar primero</button>
          </div>
        ) : filtrados.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Sin resultados con la búsqueda</p>
        ) : (
          <table className="table-auto w-full">
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
                <th>Empresa</th>
                <th>RFC</th>
                <th>Contacto</th>
                <th>Email cotizaciones</th>
                <th>WhatsApp</th>
                <th>Categorías</th>
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
                  <td className="font-medium">{p.nombre_empresa}</td>
                  <td className="text-sm">{p.rfc || '—'}</td>
                  <td>
                    <p>{p.nombre_contacto || '—'}</p>
                    {p.puesto_contacto && (
                      <p className="text-xs text-gray-400">{p.puesto_contacto}</p>
                    )}
                  </td>
                  <td className="text-sm text-brand-500">{p.email_cotizaciones || '—'}</td>
                  <td className="text-sm">{p.whatsapp || '—'}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {(p.categorias || []).map((c) => (
                        <span key={c} className="badge-gray text-xs">{c.replace('_', ' ')}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-3">
                      <button onClick={() => abrirEditar(p)} className="text-xs text-brand-500 hover:underline">
                        Editar
                      </button>
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
        )}
        {!isLoading && (
          <Pagination page={page} totalPages={totalPages} total={total} from={from} to={to} onChange={setPage} />
        )}
      </div>

      {showModal && (
        <Modal
          title={editando ? 'Editar proveedor' : 'Nuevo proveedor'}
          onClose={() => { setShowModal(false); setEditando(null); reset(); }}
        >
          <form onSubmit={handleSubmit((d) => guardarMut.mutate(d))} className="space-y-4">
            <div>
              <label className="label">Nombre de la empresa *</label>
              <input className="input" {...register('nombre_empresa', { required: 'Requerido' })} />
              {errors.nombre_empresa && <p className="text-xs text-red-500 mt-1">{errors.nombre_empresa.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Nombre del contacto</label>
                <input className="input" {...register('nombre_contacto')} />
              </div>
              <div>
                <label className="label">Puesto</label>
                <input className="input" placeholder="Ventas" {...register('puesto_contacto')} />
              </div>
              <div>
                <label className="label">RFC</label>
                <input
                  className="input uppercase"
                  placeholder="XAXX010101000"
                  {...register('rfc')}
                  onChange={(e) => { e.target.value = e.target.value.toUpperCase(); }}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Debe coincidir exacto con el RFC emisor de sus facturas (usado para vincular facturas automáticamente).
                </p>
              </div>
              <div>
                <label className="label">Email cotizaciones</label>
                <input type="email" className="input" {...register('email_cotizaciones')} />
              </div>
              <div>
                <label className="label">Teléfono</label>
                <input className="input" {...register('telefono')} />
              </div>
              <div>
                <label className="label">WhatsApp</label>
                <input className="input" placeholder="52155XXXXXXXX" {...register('whatsapp')} />
              </div>
              <div>
                <label className="label">Días entrega promedio</label>
                <input type="number" className="input" min="1" {...register('dias_entrega_prom')} />
              </div>
            </div>

            <div>
              <label className="label">Categorías que maneja</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {CATEGORIAS.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCat(cat)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
                      ${selCats.includes(cat)
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300'}`}
                  >
                    {cat.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Contabilidad
              </p>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="label">Cuenta por pagar (pasivo)</label>
                  <CuentaContableSelect
                    value={ctaPasivo}
                    onChange={setCtaPasivo}
                    rubro="Pasivo"
                    placeholder="Sin asignar (def. 201 Proveedores)"
                  />
                </div>
                <div>
                  <label className="label">Cuenta de gasto / costo / inventario</label>
                  <CuentaContableSelect
                    value={ctaGasto}
                    onChange={setCtaGasto}
                    placeholder="Sin asignar (p. ej. 115 Inventario o 6xx Gastos)"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Cuenta donde se registran sus compras: inventario para reventa o gasto para servicios.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="label">Notas</label>
              <textarea className="input min-h-[50px]" {...register('notas')} />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={guardarMut.isPending} className="btn-primary">
                {guardarMut.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
                {editando ? 'Guardar cambios' : 'Crear proveedor'}
              </button>
              <button type="button" onClick={() => { setShowModal(false); reset(); }} className="btn-secondary">
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {dialogoConfirm}
    </div>
  );
}
