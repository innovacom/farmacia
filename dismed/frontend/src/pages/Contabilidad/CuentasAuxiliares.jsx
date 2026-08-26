import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Rows3, Plus, Pencil, Check, X } from 'lucide-react';
import api from '../../services/api';
import CuentaContableSelect from '../../components/shared/CuentaContableSelect';

const TIPOS = { cliente: 'Cliente', proveedor: 'Proveedor', banco: 'Banco', manual: 'Manual' };

// Catálogo de cuentas auxiliares (nivel 3, el detalle: cuenta_padre.consecutivo,
// ej. 105.01.01 = un cliente específico dentro de "105.01 Clientes nacionales").
// El alta por cliente/proveedor es automática (el motor de pólizas la asigna al
// primer movimiento); aquí se consulta el catálogo y se pueden dar de alta
// auxiliares manuales para cualquier subcuenta.
export default function CuentasAuxiliares() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [cuentaPadre, setCuentaPadre] = useState('');
  const [entidadTipo, setEntidadTipo] = useState('');
  const [nuevo, setNuevo] = useState(null); // { cuenta_padre, nombre }
  const [editId, setEditId] = useState(null);
  const [editNombre, setEditNombre] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['cuentas-auxiliares', q, cuentaPadre, entidadTipo],
    queryFn: () => api.get('/contabilidad/auxiliares', {
      params: { q: q || undefined, cuenta_padre: cuentaPadre || undefined, entidad_tipo: entidadTipo || undefined },
    }).then((r) => r.data),
  });

  const rows = data || [];

  async function crear() {
    if (!nuevo?.cuenta_padre || !nuevo?.nombre?.trim()) return;
    await api.post('/contabilidad/auxiliares', { cuenta_padre: nuevo.cuenta_padre, nombre: nuevo.nombre.trim() });
    setNuevo(null);
    qc.invalidateQueries({ queryKey: ['cuentas-auxiliares'] });
  }

  function empezarEditar(r) { setEditId(r.id); setEditNombre(r.nombre); }

  async function guardarEditar(id) {
    if (!editNombre.trim()) return;
    await api.put(`/contabilidad/auxiliares/${id}`, { nombre: editNombre.trim() });
    setEditId(null);
    qc.invalidateQueries({ queryKey: ['cuentas-auxiliares'] });
  }

  async function toggleActivo(r) {
    await api.put(`/contabilidad/auxiliares/${r.id}`, { activo: !r.activo });
    qc.invalidateQueries({ queryKey: ['cuentas-auxiliares'] });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Rows3 size={22} className="text-brand-500" /> Cuentas auxiliares
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Tercer nivel del catálogo de cuentas — el detalle donde reciben movimientos las
            pólizas (ej. 105.01.01 dentro de la subcuenta 105.01 Clientes nacionales). Los
            auxiliares de cliente/proveedor se crean solos con la primera póliza; aquí también
            se pueden dar de alta manualmente para cualquier subcuenta.
          </p>
        </div>
        <button className="btn-primary flex items-center gap-1.5" onClick={() => setNuevo({ cuenta_padre: '', nombre: '' })}>
          <Plus size={16} /> Auxiliar manual
        </button>
      </div>

      {nuevo && (
        <div className="card mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="label">Subcuenta (nivel 2)</label>
              <CuentaContableSelect value={nuevo.cuenta_padre} nivel={2}
                onChange={(v) => setNuevo((n) => ({ ...n, cuenta_padre: v }))} />
            </div>
            <div className="md:col-span-1">
              <label className="label">Nombre del auxiliar</label>
              <input className="input" value={nuevo.nombre}
                onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))}
                placeholder="Ej. Farmacia Innovacom Centro" />
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={crear}>Guardar</button>
              <button className="btn-secondary" onClick={() => setNuevo(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <div className="card mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
            <input className="input pl-9" placeholder="Buscar código o nombre…"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <CuentaContableSelect value={cuentaPadre} nivel={2} onChange={setCuentaPadre}
            placeholder="Todas las subcuentas" />
          <select className="input" value={entidadTipo} onChange={(e) => setEntidadTipo(e.target.value)}>
            <option value="">Todos los orígenes</option>
            {Object.entries(TIPOS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <p className="text-sm text-gray-500 mb-2">{isLoading ? 'Cargando…' : `${rows.length} auxiliares`}</p>
        <table className="table-auto w-full text-sm">
          <thead>
            <tr>
              <th className="w-28">Código</th>
              <th>Nombre</th>
              <th className="w-28">RFC</th>
              <th className="w-56">Subcuenta</th>
              <th className="w-24 text-center">Origen</th>
              <th className="w-20 text-center">Activo</th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={!r.activo ? 'opacity-50' : ''}>
                <td className="font-mono text-gray-700">{r.codigo}</td>
                <td>
                  {editId === r.id ? (
                    <div className="flex items-center gap-1">
                      <input className="input py-1" value={editNombre} autoFocus
                        onChange={(e) => setEditNombre(e.target.value)} />
                      <button onClick={() => guardarEditar(r.id)} className="text-emerald-600"><Check size={16} /></button>
                      <button onClick={() => setEditId(null)} className="text-gray-400"><X size={16} /></button>
                    </div>
                  ) : r.nombre}
                </td>
                <td className="font-mono text-xs text-gray-500">{r.rfc || '—'}</td>
                <td className="text-gray-500">{r.cuenta_padre} — {r.subcuenta_nombre || '(sin catálogo)'}</td>
                <td className="text-center">
                  <span className="badge-gray text-xs">{TIPOS[r.entidad_tipo] || r.entidad_tipo}</span>
                </td>
                <td className="text-center">
                  <button onClick={() => toggleActivo(r)}
                    className={`text-xs ${r.activo ? 'badge-blue' : 'badge-gray'}`}>
                    {r.activo ? 'Sí' : 'No'}
                  </button>
                </td>
                <td className="text-center">
                  {editId !== r.id && (
                    <button onClick={() => empezarEditar(r)} className="text-gray-400 hover:text-brand-600">
                      <Pencil size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="text-center text-gray-400 py-8">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
