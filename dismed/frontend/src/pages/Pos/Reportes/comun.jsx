import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, AlertTriangle } from 'lucide-react';
import api from '../../../services/api';

// Formateadores compartidos por los reportes del POS (mismo criterio que
// pages/Contabilidad/comun.jsx, para que los números se vean igual en todo el sistema).
export const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
export const fnum = (n) => Number(n || 0).toLocaleString('es-MX');
export const fpct = (n) =>
  `${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

const hoy = () => new Date().toISOString().slice(0, 10);
const hace7dias = () => new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString().slice(0, 10);

// Filtros de rango de fechas + sucursal + agrupación, comunes a todos los
// reportes del POS. `agrupar` solo aplica a reportes con serie temporal.
export function useFiltrosPos({ conAgrupar = false } = {}) {
  const inicial = { desde: hace7dias(), hasta: hoy(), sucursal_id: '', ...(conAgrupar ? { agrupar: 'dia' } : {}) };
  const [form, setForm] = useState(inicial);
  const [applied, setApplied] = useState(inicial);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const aplicar = (e) => { e?.preventDefault(); setApplied(form); };
  return { form, applied, set, aplicar, setForm, setApplied };
}

export function useSucursales() {
  return useQuery({
    queryKey: ['pos-sucursales'],
    queryFn: () => api.get('/pos/sucursales').then((r) => r.data).catch(() => []),
    staleTime: 5 * 60 * 1000,
  });
}

export function useReportePos(endpoint, applied) {
  return useQuery({
    queryKey: ['pos-reportes', endpoint, applied],
    queryFn: () => api.get(endpoint, {
      params: Object.fromEntries(Object.entries(applied).filter(([, v]) => v !== '' && v != null)),
    }).then((r) => r.data),
    // Solo conserva los datos anteriores como placeholder si vienen del MISMO
    // endpoint (cambiar de filtro dentro de una pestaña queda suave). Si el
    // endpoint cambió (el usuario cambió de pestaña) el shape de la respuesta
    // es distinto — mostrar el placeholder viejo rompía las vistas (p. ej.
    // "Por sucursal" leyendo data.rows sobre datos de "Resumen" sin esa
    // propiedad) y tumbaba el árbol de React entero.
    placeholderData: (prevData, prevQuery) =>
      prevQuery?.queryKey?.[1] === endpoint ? prevData : undefined,
  });
}

/**
 * Barra de filtros común: desde/hasta, sucursal, y opcionalmente agrupar
 * (día/semana/mes) para los reportes con serie temporal.
 */
export function FiltrosPos({ form, set, aplicar, sucursales = [], conAgrupar = false }) {
  return (
    <form onSubmit={aplicar} className="card mb-4 no-print">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <div>
          <label className="label">Desde</label>
          <input type="date" className="input" value={form.desde} onChange={set('desde')} />
        </div>
        <div>
          <label className="label">Hasta</label>
          <input type="date" className="input" value={form.hasta} onChange={set('hasta')} />
        </div>
        <div>
          <label className="label">Sucursal</label>
          <select className="input" value={form.sucursal_id} onChange={set('sucursal_id')}>
            <option value="">Todas</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        {conAgrupar && (
          <div>
            <label className="label">Agrupar por</label>
            <select className="input" value={form.agrupar} onChange={set('agrupar')}>
              <option value="dia">Día</option>
              <option value="semana">Semana</option>
              <option value="mes">Mes</option>
            </select>
          </div>
        )}
        <button type="submit" className="btn-primary flex items-center gap-2">
          <Search size={15} /> Generar
        </button>
      </div>
    </form>
  );
}

// Tabs simples reutilizadas del patrón de Consultas históricas.
export function TabsPos({ tabs, tab, setTab }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-4 no-print">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
            ${tab === t.key ? 'border-brand-500 text-brand-500' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function EstadoReporte({ isError, error, data, children }) {
  if (isError) {
    return (
      <div className="card text-sm text-red-600">
        No se pudo generar el reporte: {error?.response?.data?.error || error.message}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card text-sm text-gray-400 flex items-center gap-2 py-10 justify-center">
        <Loader2 className="animate-spin" size={16} /> Generando…
      </div>
    );
  }
  return children;
}

export function NotaReporte({ nota }) {
  if (!nota) return null;
  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{nota}</span>
    </div>
  );
}

// Tarjeta KPI compacta, reutilizada en Resumen y Ganancias.
export function TarjetaKpi({ label, valor, sub, tono = 'default' }) {
  const tonos = {
    default: 'text-gray-900',
    green: 'text-green-700',
    red: 'text-red-700',
    brand: 'text-brand-600',
  };
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">{label}</div>
      <div className={`text-xl font-bold ${tonos[tono] || tonos.default}`}>{valor}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
