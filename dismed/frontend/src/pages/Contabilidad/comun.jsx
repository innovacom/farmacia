import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Printer, Search, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import api from '../../services/api';

// Formateadores compartidos por los reportes contables.
export const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
export const fnum = (n) => Number(n || 0).toLocaleString('es-MX');
export const fpct = (n) =>
  `${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

const ANIO_ACTUAL = new Date().getFullYear();
const ANIOS = Array.from({ length: 7 }, (_, i) => ANIO_ACTUAL + 1 - i);
const MESES = [
  ['', 'Ejercicio completo'], ['1', 'Enero'], ['2', 'Febrero'], ['3', 'Marzo'],
  ['4', 'Abril'], ['5', 'Mayo'], ['6', 'Junio'], ['7', 'Julio'], ['8', 'Agosto'],
  ['9', 'Septiembre'], ['10', 'Octubre'], ['11', 'Noviembre'], ['12', 'Diciembre'],
];

/**
 * Marco común de un reporte contable: filtros (año/mes/cancelados), carga del
 * endpoint, encabezado con datos de la empresa y periodo, botón de impresión y
 * la nota de "reporte derivado". El cuerpo se pinta vía render-prop children(data).
 */
export function ReporteContable({ titulo, descripcion, endpoint, children }) {
  const inicial = { anio: String(ANIO_ACTUAL), mes: '', modo: 'acumulado', solo_confirmadas: false };
  const [form, setForm] = useState(inicial);
  const [applied, setApplied] = useState(inicial);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['contab', endpoint, applied],
    queryFn: () => api.get(endpoint, {
      params: {
        anio: applied.anio,
        ...(applied.mes ? { mes: applied.mes, modo: applied.modo } : {}),
        ...(applied.solo_confirmadas ? { solo_confirmadas: 1 } : {}),
      },
    }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const generar = (e) => { e?.preventDefault(); setApplied(form); };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">{titulo}</h1>
        <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2 no-print">
          <Printer size={15} /> Imprimir
        </button>
      </div>
      {descripcion && <p className="text-sm text-gray-400 mb-4 no-print">{descripcion}</p>}

      {/* Filtros */}
      <form onSubmit={generar} className="card mb-4 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label className="label">Año</label>
            <select className="input" value={form.anio} onChange={set('anio')}>
              {ANIOS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Mes</label>
            <select className="input" value={form.mes} onChange={set('mes')}>
              {MESES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Periodo</label>
            <select className="input" value={form.modo} onChange={set('modo')} disabled={!form.mes}
              title={form.mes ? '' : 'Elige un mes para escoger mensual o acumulado'}>
              <option value="acumulado">Acumulado (enero al mes)</option>
              <option value="mensual">Solo el mes</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.solo_confirmadas} onChange={set('solo_confirmadas')} />
            Solo confirmadas
          </label>
          <button type="submit" className="btn-primary flex items-center gap-2">
            <Search size={15} /> Generar
          </button>
        </div>
      </form>

      {data && <ReporteHeader data={data} />}

      {isError ? (
        <div className="card text-sm text-red-600">
          No se pudo generar el reporte: {error?.response?.data?.error || error.message}
        </div>
      ) : !data ? (
        <div className="card text-sm text-gray-400 flex items-center gap-2 py-10 justify-center">
          <Loader2 className="animate-spin" size={16} /> Generando…
        </div>
      ) : (
        <>
          {children(data)}
          <NotaDerivado nota={data.nota} />
        </>
      )}
      {isFetching && data && <p className="text-xs text-gray-400 mt-2 no-print">Actualizando…</p>}
    </div>
  );
}

function ReporteHeader({ data }) {
  return (
    <div className="card mb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-lg font-bold text-gray-900">{data.empresa?.nombre}</div>
          {data.empresa?.rfc && <div className="text-xs text-gray-400 font-mono">{data.empresa.rfc}</div>}
        </div>
        <div className="sm:text-right">
          <div className="font-semibold text-brand-600">{data.titulo}</div>
          <div className="text-sm text-gray-500">{data.periodo?.etiqueta} · {data.estatus}</div>
        </div>
      </div>
    </div>
  );
}

// Insignia de cuadre (debe = haber, o activo = pasivo + capital).
export function CuadreBadge({ cuadra }) {
  return cuadra ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
      <CheckCircle2 size={14} /> Cuadra
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
      <AlertTriangle size={14} /> No cuadra
    </span>
  );
}

/**
 * Marco de filtros para reportes de impuestos CFDI (distinto de ReporteContable,
 * que opera sobre pólizas con año/mes). Filtros: tipo, tipo_comprobante, desde, hasta, estatus.
 */
export function ReporteCfdiImpuestos({ titulo, descripcion, endpoint, children }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const primero = `${new Date().getFullYear()}-01-01`;
  const inicial = { tipo: 'todos', tipo_comprobante: 'todos', desde: primero, hasta: hoy, estatus: 'vigente' };
  const [form, setForm] = useState(inicial);
  const [applied, setApplied] = useState(inicial);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['cfdi-impuestos', endpoint, applied],
    queryFn: () => api.get(endpoint, { params: applied }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const generar = (e) => { e?.preventDefault(); setApplied(form); };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">{titulo}</h1>
        <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2 no-print">
          <Printer size={15} /> Imprimir
        </button>
      </div>
      {descripcion && <p className="text-sm text-gray-400 mb-4 no-print">{descripcion}</p>}

      <form onSubmit={generar} className="card mb-4 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label className="label">Tipo</label>
            <select className="input" value={form.tipo} onChange={set('tipo')}>
              <option value="todos">Todos</option>
              <option value="emitido">Emitido</option>
              <option value="recibido">Recibido</option>
            </select>
          </div>
          <div>
            <label className="label">Tipo comprobante</label>
            <select className="input" value={form.tipo_comprobante} onChange={set('tipo_comprobante')}>
              <option value="todos">Todos</option>
              <option value="I">I — Ingreso</option>
              <option value="E">E — Egreso</option>
              <option value="P">P — Pago</option>
              <option value="T">T — Traslado</option>
              <option value="N">N — Nómina</option>
            </select>
          </div>
          <div>
            <label className="label">Desde</label>
            <input type="date" className="input" value={form.desde} onChange={set('desde')} />
          </div>
          <div>
            <label className="label">Hasta</label>
            <input type="date" className="input" value={form.hasta} onChange={set('hasta')} />
          </div>
          <div>
            <label className="label">Estatus</label>
            <select className="input" value={form.estatus} onChange={set('estatus')}>
              <option value="vigente">Vigente</option>
              <option value="cancelado">Cancelado</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          <button type="submit" className="btn-primary flex items-center gap-2">
            <Search size={15} /> Generar
          </button>
        </div>
      </form>

      {data && (
        <div className="card mb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-lg font-bold text-gray-900">{data.empresa?.nombre}</div>
              {data.empresa?.rfc && <div className="text-xs text-gray-400 font-mono">{data.empresa.rfc}</div>}
            </div>
            <div className="sm:text-right">
              <div className="font-semibold text-brand-600">{data.titulo}</div>
              <div className="text-sm text-gray-500">
                {applied.desde} al {applied.hasta} · {applied.estatus}
              </div>
            </div>
          </div>
        </div>
      )}

      {isError ? (
        <div className="card text-sm text-red-600">
          No se pudo generar el reporte: {error?.response?.data?.error || error.message}
        </div>
      ) : !data ? (
        <div className="card text-sm text-gray-400 flex items-center gap-2 py-10 justify-center">
          <Loader2 className="animate-spin" size={16} /> Generando…
        </div>
      ) : (
        children(data)
      )}
      {isFetching && data && <p className="text-xs text-gray-400 mt-2 no-print">Actualizando…</p>}
    </div>
  );
}

export function NotaDerivado({ nota }) {
  if (!nota) return null;
  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{nota}</span>
    </div>
  );
}
