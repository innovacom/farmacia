import { useState, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, X, Eye, Printer, Loader2, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import api from '../../services/api';
import { usePrefsStore } from '../../store/prefsStore';
import Pagination from '../../components/ui/Pagination';

const TABS = [
  { key: 'cotizaciones',   label: 'Cotizaciones' },
  { key: 'solicitudes',    label: 'Solicitudes' },
  { key: 'ordenes-compra', label: 'Órdenes de compra' },
  { key: 'pedidos',        label: 'Pedidos' },
];

const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fnum = (n) => Number(n || 0).toLocaleString('es-MX');
const fdate = (d) => (d ? new Date(d).toLocaleDateString('es-MX') : '—');

// Quién es la contraparte de cada documento (cliente o proveedor).
const PARTY = {
  cotizaciones: 'cliente', solicitudes: 'cliente', pedidos: 'cliente', 'ordenes-compra': 'proveedor',
};
const partyLabel = (tab) => (PARTY[tab] === 'proveedor' ? 'Proveedor' : 'Cliente');

// Columnas a nivel ENCABEZADO. render(row) → celda.
const COLS = {
  cotizaciones: [
    { h: 'Folio', sort: 'folio', c: (r) => <span className="font-mono text-xs font-semibold text-brand-500">{r.folio}</span> },
    { h: 'Cliente', sort: 'cliente', c: (r) => <span className="font-medium">{r.cliente}</span> },
    { h: 'Concepto', sort: 'concepto', c: (r) => <span className="text-gray-600">{r.concepto || '—'}</span> },
    { h: 'Partidas', c: (r) => r.partidas, align: 'text-center' },
    { h: 'Total', sort: 'total', c: (r) => fmt(r.total), align: 'text-right' },
    { h: 'Estatus', sort: 'estatus', c: (r) => <span className="badge-gray">{r.estatus}</span> },
    { h: 'Fecha', sort: 'fecha', c: (r) => <span className="text-gray-400 text-xs">{fdate(r.fecha)}</span> },
  ],
  solicitudes: [
    { h: 'Folio', sort: 'folio', c: (r) => <span className="font-mono text-xs font-semibold text-brand-500">{r.folio}</span> },
    { h: 'Cliente', sort: 'cliente', c: (r) => <span className="font-medium">{r.cliente}</span> },
    { h: 'No. Solicitud (COC)', sort: 'solicitud_cliente', c: (r) => <span className="font-mono text-xs text-gray-500">{r.solicitud_cliente || '—'}</span> },
    { h: 'Concepto', sort: 'concepto', c: (r) => <span className="text-gray-600">{r.concepto || '—'}</span> },
    { h: 'Partidas', c: (r) => r.partidas, align: 'text-center' },
    { h: 'Estatus', sort: 'estatus', c: (r) => <span className="badge-gray">{r.estatus}</span> },
    { h: 'Fecha', sort: 'fecha', c: (r) => <span className="text-gray-400 text-xs">{fdate(r.fecha)}</span> },
  ],
  'ordenes-compra': [
    { h: 'Folio', sort: 'folio', c: (r) => <span className="font-mono text-xs font-semibold text-brand-500">{r.folio}</span> },
    { h: 'Proveedor', sort: 'proveedor', c: (r) => <span className="font-medium">{r.proveedor}</span> },
    { h: 'Partidas', c: (r) => r.partidas, align: 'text-center' },
    { h: 'Total', sort: 'total', c: (r) => fmt(r.total), align: 'text-right' },
    { h: 'Estatus', sort: 'estatus', c: (r) => <span className="badge-gray">{r.estatus}</span> },
    { h: 'Fecha', sort: 'fecha', c: (r) => <span className="text-gray-400 text-xs">{fdate(r.fecha)}</span> },
  ],
  pedidos: [
    { h: 'Folio', sort: 'folio', c: (r) => <span className="font-mono text-xs font-semibold text-brand-500">{r.folio}</span> },
    { h: 'Cliente', sort: 'cliente', c: (r) => <span className="font-medium">{r.cliente}</span> },
    { h: 'Partidas', c: (r) => r.partidas, align: 'text-center' },
    { h: 'Estatus', sort: 'estatus', c: (r) => <span className="badge-gray">{r.estatus}</span> },
    { h: 'Fecha', sort: 'fecha', c: (r) => <span className="text-gray-400 text-xs">{fdate(r.fecha)}</span> },
  ],
};

// Columnas a nivel DETALLE (renglones). Cada fila = una partida + su documento padre.
const folioCol = { h: 'Folio', sort: 'folio', c: (r) => <span className="font-mono text-xs font-semibold text-brand-500">{r.folio}</span> };
const fechaCol = { h: 'Fecha', sort: 'fecha', c: (r) => <span className="text-gray-400 text-xs">{fdate(r.fecha)}</span> };
const COLS_DET = {
  cotizaciones: [
    folioCol,
    { h: 'Cliente', sort: 'cliente', c: (r) => <span className="font-medium">{r.cliente}</span> },
    { h: 'SKU', sort: 'sku', c: (r) => <span className="font-mono text-xs text-gray-500">{r.sku_interno || r.codigo_cliente || '—'}</span> },
    { h: 'Descripción', sort: 'descripcion', c: (r) => <span className="text-gray-700">{r.descripcion}</span> },
    { h: 'Cant.', sort: 'cantidad', c: (r) => fnum(r.cantidad), align: 'text-center' },
    { h: 'P. unitario', sort: 'precio_unitario_venta', c: (r) => fmt(r.precio_unitario_venta), align: 'text-right' },
    { h: 'Importe', sort: 'importe', c: (r) => fmt(r.importe), align: 'text-right' },
    fechaCol,
  ],
  solicitudes: [
    folioCol,
    { h: 'Cliente', sort: 'cliente', c: (r) => <span className="font-medium">{r.cliente}</span> },
    { h: 'Código', sort: 'codigo', c: (r) => <span className="font-mono text-xs text-gray-500">{r.codigo_cliente || r.codigo_gobierno || '—'}</span> },
    { h: 'Descripción', sort: 'descripcion', c: (r) => <span className="text-gray-700">{r.descripcion}</span> },
    { h: 'Cant.', sort: 'cantidad', c: (r) => fnum(r.cantidad), align: 'text-center' },
    { h: 'Unidad', sort: 'unidad', c: (r) => <span className="text-gray-500">{r.unidad_medida || '—'}</span> },
    fechaCol,
  ],
  'ordenes-compra': [
    folioCol,
    { h: 'Proveedor', sort: 'proveedor', c: (r) => <span className="font-medium">{r.proveedor}</span> },
    { h: 'SKU', sort: 'sku', c: (r) => <span className="font-mono text-xs text-gray-500">{r.sku_proveedor || r.sku_interno || '—'}</span> },
    { h: 'Descripción', sort: 'descripcion', c: (r) => <span className="text-gray-700">{r.descripcion}</span> },
    { h: 'Cant.', sort: 'cantidad', c: (r) => fnum(r.cantidad), align: 'text-center' },
    { h: 'P. compra', sort: 'precio_compra', c: (r) => fmt(r.precio_compra), align: 'text-right' },
    fechaCol,
  ],
  pedidos: [
    folioCol,
    { h: 'Cliente', sort: 'cliente', c: (r) => <span className="font-medium">{r.cliente}</span> },
    { h: 'SKU', sort: 'sku', c: (r) => <span className="font-mono text-xs text-gray-500">{r.sku_interno || r.codigo_cliente || '—'}</span> },
    { h: 'Descripción', sort: 'descripcion', c: (r) => <span className="text-gray-700">{r.descripcion}</span> },
    { h: 'Cant.', sort: 'cantidad', c: (r) => fnum(r.cantidad), align: 'text-center' },
    { h: 'P. unitario', sort: 'precio_unitario_venta', c: (r) => fmt(r.precio_unitario_venta), align: 'text-right' },
    fechaCol,
  ],
};

const EMPTY = { q: '', fecha_desde: '', fecha_hasta: '' };

export default function ConsultasHistoricas() {
  const [tab, setTab] = useState('cotizaciones');
  const [modo, setModo] = useState('encabezado');   // 'encabezado' | 'detalle'
  const [form, setForm] = useState(EMPTY);           // inputs en edición
  const [applied, setApplied] = useState(EMPTY);     // filtros aplicados
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState({ field: '', dir: 'asc' }); // '' = orden por defecto (fecha desc)
  const [detalle, setDetalle] = useState(null);      // { tab, id } a mostrar en modal
  const pageSize = usePrefsStore((s) => s.rowsPerPage);

  // Al cambiar el tamaño de página (Configuración) volver al inicio.
  useEffect(() => { setOffset(0); }, [pageSize]);

  const esDetalle = modo === 'detalle';
  const endpoint = esDetalle ? `/consultas/${tab}/partidas` : `/consultas/${tab}`;

  const { data, isFetching } = useQuery({
    queryKey: ['consultas', tab, modo, applied, sort, offset, pageSize],
    queryFn: () => api.get(endpoint, {
      params: { ...applied, ...(sort.field ? { sort: sort.field, dir: sort.dir } : {}), limit: pageSize, offset },
    }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const cols = esDetalle ? COLS_DET[tab] : COLS[tab];

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const buscar = (e) => { e?.preventDefault(); setOffset(0); setApplied(form); };
  const limpiar = () => { setForm(EMPTY); setApplied(EMPTY); setOffset(0); };
  const cambiarTab = (k) => { setTab(k); setOffset(0); setSort({ field: '', dir: 'asc' }); };
  const cambiarModo = (m) => { setModo(m); setOffset(0); setSort({ field: '', dir: 'asc' }); };
  const toggleSort = (field) => {
    setOffset(0);
    setSort((s) => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }));
  };
  const abrir = (r) => setDetalle({ tab, id: esDetalle ? r.doc_id : r.id });

  const tabLabel = TABS.find((t) => t.key === tab)?.label;
  const criterios = [
    applied.q && `"${applied.q}"`,
    applied.fecha_desde && `desde ${applied.fecha_desde}`,
    applied.fecha_hasta && `hasta ${applied.fecha_hasta}`,
  ].filter(Boolean).join('  ·  ') || 'sin filtros';

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Consultas históricas</h1>
        <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2 no-print">
          <Printer size={15} /> Imprimir
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-5 no-print">
        Busca por <strong>encabezado</strong> (folio, cliente, concepto) o por <strong>detalle</strong> (producto,
        código, descripción). Doble clic en una fila para ver el documento completo.
      </p>

      {/* Encabezado solo para impresión */}
      <div className="hidden print:block mb-3">
        <h2 className="text-lg font-bold">{tabLabel} — {esDetalle ? 'detalle' : 'encabezados'}</h2>
        <p className="text-xs text-gray-600">Criterios: {criterios} · {fnum(total)} resultados · {fdate(new Date())}</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-4 no-print">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => cambiarTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
              ${tab === t.key
                ? 'border-brand-500 text-brand-500'
                : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Selector de alcance */}
      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 mb-4 no-print">
        {[['encabezado', 'Encabezados'], ['detalle', 'Productos / detalle']].map(([k, l]) => (
          <button
            key={k}
            onClick={() => cambiarModo(k)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors
              ${modo === k ? 'bg-white text-brand-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <form onSubmit={buscar} className="card mb-4 no-print">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="lg:col-span-2">
            <label className="label">{esDetalle ? 'Producto (descripción o código)' : 'Nombre / descripción'}</label>
            <input className="input" autoFocus
              placeholder={esDetalle ? 'Descripción o código de producto…' : 'Cliente, proveedor, folio, concepto, producto…'}
              value={form.q} onChange={setField('q')} />
          </div>
          <div>
            <label className="label">Desde</label>
            <input type="date" className="input" value={form.fecha_desde} onChange={setField('fecha_desde')} />
          </div>
          <div>
            <label className="label">Hasta</label>
            <input type="date" className="input" value={form.fecha_hasta} onChange={setField('fecha_hasta')} />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button type="submit" className="btn-primary flex items-center gap-2">
            <Search size={15} /> Buscar
          </button>
          <button type="button" onClick={limpiar} className="btn-secondary flex items-center gap-2">
            <X size={15} /> Limpiar
          </button>
          <span className="ml-auto text-sm text-gray-400">
            {isFetching ? 'Buscando…' : `${fnum(total)} ${esDetalle ? 'renglones' : 'resultados'}`}
          </span>
        </div>
      </form>

      {/* Resultados */}
      <div className="card">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">
            {isFetching ? 'Cargando…' : 'Sin resultados para los filtros seleccionados.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table-auto w-full">
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c.h} className={c.align}>
                        {c.sort ? (
                          <button type="button" onClick={() => toggleSort(c.sort)}
                            className={`inline-flex items-center gap-1 hover:text-brand-600 select-none
                              ${c.align === 'text-right' ? 'flex-row-reverse' : ''}`}>
                            {c.h}
                            {sort.field === c.sort
                              ? (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)
                              : <ChevronsUpDown size={12} className="opacity-30" />}
                          </button>
                        ) : c.h}
                      </th>
                    ))}
                    <th className="text-center no-print w-16">Ver</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} onDoubleClick={() => abrir(r)}
                      className="cursor-pointer hover:bg-gray-50">
                      {cols.map((c) => <td key={c.h} className={c.align}>{c.c(r)}</td>)}
                      <td className="text-center no-print">
                        <button onClick={(e) => { e.stopPropagation(); abrir(r); }}
                          className="text-gray-400 hover:text-brand-500" title="Ver detalle">
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            <div className="no-print">
              <Pagination
                page={Math.floor(offset / pageSize) + 1}
                totalPages={Math.max(1, Math.ceil(total / pageSize))}
                total={total}
                from={total === 0 ? 0 : offset + 1}
                to={Math.min(offset + pageSize, total)}
                onChange={(p) => setOffset((p - 1) * pageSize)}
              />
            </div>
          </>
        )}
      </div>

      {detalle && <DetalleModal tab={detalle.tab} id={detalle.id} onClose={() => setDetalle(null)} />}
    </div>
  );
}

// ---- Modal de detalle (header + partidas) --------------------------------
function DetalleModal({ tab, id, onClose }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['consulta-detalle', tab, id],
    queryFn: () => api.get(`/consultas/${tab}/${id}`).then((r) => r.data),
  });

  const party = PARTY[tab] === 'proveedor' ? data?.proveedor : data?.cliente;
  const partidas = data?.partidas || [];
  // Precios de proveedores agrupados por partida (solo cotizaciones).
  const provPorPartida = (data?.proveedores || []).reduce((acc, p) => {
    (acc[p.partida_id] = acc[p.partida_id] || []).push(p); return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto print:static print:bg-white print:p-0 print:block">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl my-8 print:shadow-none print:my-0 print:max-w-full">
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
          <div>
            <div className="font-mono text-sm font-semibold text-brand-500">{data?.folio || '…'}</div>
            <div className="text-lg font-bold text-gray-900">{party || ''}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {fdate(data?.fecha || data?.created_at)}
              {data?.concepto ? `  ·  ${data.concepto}` : ''}
              {data?.atencion ? `  ·  Atn: ${data.atencion}` : ''}
              {data?.estatus ? `  ·  ${data.estatus}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2 no-print">
            <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2">
              <Printer size={15} /> Imprimir
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="p-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="animate-spin mr-2" size={18} /> Cargando…
            </div>
          ) : isError ? (
            <p className="text-sm text-red-500 text-center py-8">No se pudo cargar el detalle.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-auto w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-center w-10">#</th>
                    <th>Código / SKU</th>
                    <th>Descripción</th>
                    <th className="text-center">Cant.</th>
                    <th className="text-right">P. unitario</th>
                    <th className="text-right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {partidas.map((p, i) => {
                    const precio = p.precio_unitario_venta ?? p.precio_compra;
                    const cant = p.cantidad ?? p.cantidad_asignada;
                    const prov = provPorPartida[p.linea] || provPorPartida[i + 1];
                    return (
                      <tr key={i}>
                        <td className="text-center text-gray-400">{p.linea ?? i + 1}</td>
                        <td className="font-mono text-xs text-gray-500">
                          {p.sku_interno || p.codigo_cliente || p.codigo_gobierno || p.sku_proveedor || '—'}
                        </td>
                        <td className="text-gray-700">
                          {p.descripcion}
                          {prov && prov.length > 0 && (
                            <div className="text-[11px] text-gray-400 mt-0.5">
                              {prov.map((x, k) => (
                                <span key={k} className={x.es_mejor_precio ? 'text-emerald-600 font-medium' : ''}>
                                  {k > 0 && '  ·  '}{x.proveedor}: {fmt(x.precio_unitario)}
                                  {x.es_mejor_precio ? ' ★' : ''}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="text-center">{fnum(cant)}</td>
                        <td className="text-right">{precio != null ? fmt(precio) : '—'}</td>
                        <td className="text-right">{p.importe != null ? fmt(p.importe) : (precio != null && cant != null ? fmt(precio * cant) : '—')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data?.total != null && (
                <div className="flex justify-end mt-3 text-sm font-semibold text-gray-800">
                  Total: {fmt(data.total)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
