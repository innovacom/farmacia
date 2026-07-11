import { useState, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, X, Eye, Printer, Loader2, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import api from '../../services/api';
import { usePrefsStore } from '../../store/prefsStore';
import Pagination from '../../components/ui/Pagination';

const TABS = [
  { key: 'emitidos',  label: 'Emitidos' },
  { key: 'recibidos', label: 'Recibidos' },
];

const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fnum = (n) => Number(n || 0).toLocaleString('es-MX');
const fdate = (d) => (d ? new Date(d).toLocaleDateString('es-MX') : '—');
const fdatetime = (d) => (d ? new Date(d).toLocaleString('es-MX') : '—');

// En Emitidos la contraparte es el receptor (cliente); en Recibidos el emisor (proveedor).
const PARTY = { emitidos: 'receptor', recibidos: 'emisor' };
const partyLabel = (tab) => (PARTY[tab] === 'emisor' ? 'Proveedor (emisor)' : 'Cliente (receptor)');
const partyName = (tab, r) =>
  PARTY[tab] === 'emisor'
    ? (r.nombre_emisor || r.rfc_emisor || '—')
    : (r.nombre_receptor || r.rfc_receptor || '—');

const serieFolio = (r) => [r.serie, r.folio].filter(Boolean).join('-') || '—';

// Columnas a nivel ENCABEZADO. c(row, tab) → celda.
const COLS = [
  { h: 'UUID', sort: 'uuid', c: (r) => <span className="font-mono text-[11px] text-gray-500">{r.uuid}</span> },
  { h: 'Serie-Folio', sort: 'folio', c: (r) => <span className="font-mono text-xs font-semibold text-brand-500">{serieFolio(r)}</span> },
  { h: 'Tipo', sort: 'tipo_comprobante', c: (r) => <span className="text-gray-500">{r.tipo_comprobante || '—'}</span>, align: 'text-center' },
  { h: '__party__', c: (r, tab) => <span className="font-medium">{partyName(tab, r)}</span> },
  { h: 'Total', sort: 'total', c: (r) => fmt(r.total), align: 'text-right' },
  { h: 'Concep.', c: (r) => fnum(r.conceptos), align: 'text-center' },
  { h: 'Estatus', sort: 'estatus', c: (r) => <span className="badge-gray">{r.estatus || '—'}</span> },
  { h: 'Fecha', sort: 'fecha', c: (r) => <span className="text-gray-400 text-xs">{fdate(r.fecha)}</span> },
];

// Columnas a nivel DETALLE (conceptos).
const COLS_DET = [
  { h: 'Serie-Folio', sort: 'folio', c: (r) => <span className="font-mono text-xs font-semibold text-brand-500">{serieFolio(r)}</span> },
  { h: '__party__', c: (r, tab) => <span className="font-medium">{partyName(tab, r)}</span> },
  { h: 'Cód./SKU', sort: 'no_identificacion', c: (r) => <span className="font-mono text-xs text-gray-500">{r.no_identificacion || r.codigo_interno || '—'}</span> },
  { h: 'Descripción', sort: 'descripcion', c: (r) => <span className="text-gray-700">{r.descripcion}</span> },
  { h: 'Cant.', sort: 'cantidad', c: (r) => fnum(r.cantidad), align: 'text-center' },
  { h: 'Unidad', sort: 'unidad', c: (r) => <span className="text-gray-500">{r.unidad || r.clave_unidad || '—'}</span> },
  { h: 'V. unitario', sort: 'valor_unitario', c: (r) => fmt(r.valor_unitario), align: 'text-right' },
  { h: 'Importe', sort: 'importe', c: (r) => fmt(r.importe), align: 'text-right' },
  { h: 'Fecha', sort: 'fecha', c: (r) => <span className="text-gray-400 text-xs">{fdate(r.fecha)}</span> },
];

const EMPTY = { q: '', fecha_desde: '', fecha_hasta: '' };

export default function ConsultaCfdi() {
  const [tab, setTab] = useState('emitidos');
  const [modo, setModo] = useState('encabezado');   // 'encabezado' | 'detalle'
  const [form, setForm] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState({ field: '', dir: 'asc' }); // '' = orden por defecto (fecha desc)
  const [detalle, setDetalle] = useState(null);      // id del comprobante a mostrar
  const pageSize = usePrefsStore((s) => s.rowsPerPage);

  // Al cambiar el tamaño de página (Configuración) volver al inicio.
  useEffect(() => { setOffset(0); }, [pageSize]);

  const esDetalle = modo === 'detalle';
  const endpoint = esDetalle ? `/cfdi/${tab}/conceptos` : `/cfdi/${tab}`;

  const { data, isFetching } = useQuery({
    queryKey: ['cfdi', tab, modo, applied, sort, offset, pageSize],
    queryFn: () => api.get(endpoint, {
      params: { ...applied, ...(sort.field ? { sort: sort.field, dir: sort.dir } : {}), limit: pageSize, offset },
    }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows || [];
  const total = data?.total || 0;
  // La columna de contraparte ordena por emisor (recibidos) o receptor (emitidos).
  const partySort = PARTY[tab] === 'emisor' ? 'emisor' : 'receptor';
  const cols = (esDetalle ? COLS_DET : COLS).map((c) =>
    c.h === '__party__' ? { ...c, h: partyLabel(tab), sort: partySort } : c);

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const buscar = (e) => { e?.preventDefault(); setOffset(0); setApplied(form); };
  const limpiar = () => { setForm(EMPTY); setApplied(EMPTY); setOffset(0); };
  const cambiarTab = (k) => { setTab(k); setOffset(0); setSort({ field: '', dir: 'asc' }); };
  const cambiarModo = (m) => { setModo(m); setOffset(0); setSort({ field: '', dir: 'asc' }); };
  const toggleSort = (field) => {
    setOffset(0);
    setSort((s) => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }));
  };
  const abrir = (r) => setDetalle(esDetalle ? r.doc_id : r.id);

  const tabLabel = TABS.find((t) => t.key === tab)?.label;
  const criterios = [
    applied.q && `"${applied.q}"`,
    applied.fecha_desde && `desde ${applied.fecha_desde}`,
    applied.fecha_hasta && `hasta ${applied.fecha_hasta}`,
  ].filter(Boolean).join('  ·  ') || 'sin filtros';

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Facturas CFDI</h1>
        <div className="flex items-center gap-2 no-print">
          <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2">
            <Printer size={15} /> Imprimir
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-400 mb-5 no-print">
        Consulta los CFDI <strong>emitidos</strong> y <strong>recibidos</strong>. Busca por <strong>encabezado</strong>
        {' '}(UUID, RFC, nombre, serie-folio) o por <strong>conceptos</strong> (descripción, código).
        Doble clic en una fila para ver el comprobante completo.
      </p>

      {/* Encabezado solo para impresión */}
      <div className="hidden print:block mb-3">
        <h2 className="text-lg font-bold">CFDI {tabLabel} — {esDetalle ? 'conceptos' : 'encabezados'}</h2>
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
        {[['encabezado', 'Encabezados'], ['detalle', 'Conceptos / detalle']].map(([k, l]) => (
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
            <label className="label">{esDetalle ? 'Concepto (descripción o código)' : 'UUID / RFC / nombre / folio'}</label>
            <input className="input" autoFocus
              placeholder={esDetalle ? 'Descripción o código de concepto…' : 'UUID, RFC, nombre, serie-folio…'}
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
            {isFetching ? 'Buscando…' : `${fnum(total)} ${esDetalle ? 'conceptos' : 'comprobantes'}`}
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
                    <tr key={esDetalle ? r.id : r.id} onDoubleClick={() => abrir(r)}
                      className="cursor-pointer hover:bg-gray-50">
                      {cols.map((c) => <td key={c.h} className={c.align}>{c.c(r, tab)}</td>)}
                      <td className="text-center no-print">
                        <button onClick={(e) => { e.stopPropagation(); abrir(r); }}
                          className="text-gray-400 hover:text-brand-500" title="Ver comprobante">
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

      {detalle && <ComprobanteModal tab={tab} id={detalle} onClose={() => setDetalle(null)} />}
    </div>
  );
}

// ---- Modal de comprobante (header + conceptos) ---------------------------
function ComprobanteModal({ tab, id, onClose }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cfdi-comprobante', id],
    queryFn: () => api.get(`/cfdi/comprobante/${id}`).then((r) => r.data),
  });

  const conceptos = data?.conceptos || [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto print:static print:bg-white print:p-0 print:block">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl my-8 print:shadow-none print:my-0 print:max-w-full">
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
          <div className="min-w-0">
            <div className="font-mono text-sm font-semibold text-brand-500 break-all">{data?.uuid || '…'}</div>
            <div className="text-lg font-bold text-gray-900">{serieFolio(data || {})}</div>
            <div className="text-xs text-gray-500 mt-1 space-y-0.5">
              <div>{fdatetime(data?.fecha)}{data?.tipo_comprobante ? `  ·  Tipo ${data.tipo_comprobante}` : ''}{data?.estatus ? `  ·  ${data.estatus}` : ''}</div>
              <div><span className="text-gray-400">Emisor:</span> {data?.nombre_emisor || '—'} <span className="font-mono text-gray-400">{data?.rfc_emisor || ''}</span></div>
              <div><span className="text-gray-400">Receptor:</span> {data?.nombre_receptor || '—'} <span className="font-mono text-gray-400">{data?.rfc_receptor || ''}</span></div>
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
            <p className="text-sm text-red-500 text-center py-8">No se pudo cargar el comprobante.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-auto w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-center w-10">#</th>
                    <th>Clave SAT</th>
                    <th>Cód./SKU</th>
                    <th>Descripción</th>
                    <th className="text-center">Cant.</th>
                    <th>Unidad</th>
                    <th className="text-right">V. unitario</th>
                    <th className="text-right">Importe</th>
                    <th className="text-right">IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {conceptos.map((c, i) => (
                    <tr key={i}>
                      <td className="text-center text-gray-400">{c.linea ?? i + 1}</td>
                      <td className="font-mono text-xs text-gray-500">{c.clave_prod_serv || '—'}</td>
                      <td className="font-mono text-xs text-gray-500">{c.no_identificacion || c.codigo_interno || '—'}</td>
                      <td className="text-gray-700">{c.descripcion}</td>
                      <td className="text-center">{fnum(c.cantidad)}</td>
                      <td className="text-gray-500">{c.unidad || c.clave_unidad || '—'}</td>
                      <td className="text-right">{c.valor_unitario != null ? fmt(c.valor_unitario) : '—'}</td>
                      <td className="text-right">{c.importe != null ? fmt(c.importe) : '—'}</td>
                      <td className="text-right text-gray-500">{c.importe_iva != null ? fmt(c.importe_iva) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-col items-end gap-0.5 mt-3 text-sm text-gray-700">
                {data?.subtotal != null && <div>Subtotal: {fmt(data.subtotal)}</div>}
                {data?.total != null && <div className="font-semibold text-gray-900">Total: {fmt(data.total)} {data?.moneda || ''}</div>}
              </div>
              {data?.cfdi_relacionados && (
                <div className="mt-3 pt-3 border-t border-gray-100 text-sm text-gray-600">
                  <span className="font-medium text-gray-500">
                    {data.tipo_comprobante === 'P' ? 'Facturas pagadas:' : 'CFDI relacionados:'}
                  </span>{' '}
                  <span className="font-mono text-xs break-all">{data.cfdi_relacionados}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
