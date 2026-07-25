import { useState } from 'react';
import { BarChart3, Printer } from 'lucide-react';
import {
  fmt, fnum, useFiltrosPos, useSucursales, useReportePos,
  FiltrosPos, TabsPos, EstadoReporte, NotaReporte, TarjetaKpi,
} from './comun';

const TABS = [
  { key: 'resumen',     label: 'Resumen',          endpoint: '/pos/reportes/resumen' },
  { key: 'sucursal',    label: 'Por sucursal',      endpoint: '/pos/reportes/ventas-sucursal' },
  { key: 'productos',   label: 'Top productos',     endpoint: '/pos/reportes/top-productos' },
  { key: 'pago',        label: 'Formas de pago',    endpoint: '/pos/reportes/formas-pago' },
  { key: 'existencias', label: 'Existencias',       endpoint: '/pos/reportes/existencias' },
  { key: 'recetas',     label: 'Recetas COFEPRIS',  endpoint: '/pos/reportes/recetas' },
];

/**
 * Dashboard de reportes operativos del POS Farmacia (permiso 'pos-reportes').
 * Deliberadamente separado del reporte de Ganancias (ver PosGanancias.jsx),
 * que exige el permiso aparte 'pos-reportes-ganancias'.
 */
export default function PosReportes() {
  const [tab, setTab] = useState('resumen');
  const { form, applied, set, aplicar, setForm, setApplied } = useFiltrosPos({ conAgrupar: true });
  const { data: sucursales = [] } = useSucursales();

  const activa = TABS.find((t) => t.key === tab);
  const esExistencias = tab === 'existencias';
  const filtrosExistencias = { sucursal_id: applied.sucursal_id };
  const { data, isFetching, isError, error } = useReportePos(
    activa.endpoint, esExistencias ? filtrosExistencias : applied
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <BarChart3 size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Reportes de farmacia</h1>
        </div>
        <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2 no-print">
          <Printer size={15} /> Imprimir
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-4 no-print">
        Ventas, existencias y recetas de la farmacia. El reporte de ganancias vive aparte, en su propio permiso.
      </p>

      <TabsPos tabs={TABS} tab={tab} setTab={setTab} />

      {esExistencias ? (
        <div className="card mb-4 no-print">
          <label className="label">Sucursal</label>
          <select
            className="input max-w-xs"
            value={applied.sucursal_id}
            onChange={(e) => {
              const v = e.target.value;
              setForm((f) => ({ ...f, sucursal_id: v }));
              setApplied((a) => ({ ...a, sucursal_id: v }));
            }}
          >
            <option value="">Todas</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      ) : (
        <FiltrosPos form={form} set={set} aplicar={aplicar} sucursales={sucursales} conAgrupar={tab === 'resumen'} />
      )}

      <EstadoReporte isError={isError} error={error} data={data}>
        {data && (
          <>
            {tab === 'resumen' && <VistaResumen data={data} />}
            {tab === 'sucursal' && <VistaSucursal data={data} />}
            {tab === 'productos' && <VistaProductos data={data} />}
            {tab === 'pago' && <VistaFormasPago data={data} />}
            {tab === 'existencias' && <VistaExistencias data={data} />}
            {tab === 'recetas' && <VistaRecetas data={data} />}
            <NotaReporte nota={data.nota} />
          </>
        )}
      </EstadoReporte>
      {isFetching && data && <p className="text-xs text-gray-400 mt-2 no-print">Actualizando…</p>}
    </div>
  );
}

function VistaResumen({ data }) {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <TarjetaKpi label="Tickets" valor={fnum(data.kpi.num_tickets)} />
        <TarjetaKpi label="Total vendido" valor={fmt(data.kpi.total)} tono="brand" />
        <TarjetaKpi label="Ticket promedio" valor={fmt(data.kpi.ticket_promedio)} />
        <TarjetaKpi label="Efectivo" valor={fmt(data.kpi.efectivo)} />
        <TarjetaKpi label="Tarjeta" valor={fmt(data.kpi.tarjeta)} />
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead><tr><th>Periodo</th><th className="text-center">Tickets</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {data.serie.map((s) => (
              <tr key={s.periodo}>
                <td>{s.periodo}</td>
                <td className="text-center">{fnum(s.num_tickets)}</td>
                <td className="text-right">{fmt(s.total)}</td>
              </tr>
            ))}
            {!data.serie.length && <tr><td colSpan={3} className="text-center text-gray-400 py-8">Sin ventas en el periodo</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function VistaSucursal({ data }) {
  return (
    <div className="card p-0 overflow-x-auto">
      <table className="table-auto w-full">
        <thead><tr><th>Sucursal</th><th className="text-center">Tickets</th><th className="text-right">Total</th><th className="text-right">Ticket promedio</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.sucursal_id}>
              <td>{r.sucursal}</td>
              <td className="text-center">{fnum(r.num_tickets)}</td>
              <td className="text-right">{fmt(r.total)}</td>
              <td className="text-right">{fmt(r.ticket_promedio)}</td>
            </tr>
          ))}
          {!data.rows.length && <tr><td colSpan={4} className="text-center text-gray-400 py-8">Sin ventas en el periodo</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function VistaProductos({ data }) {
  return (
    <div className="card p-0 overflow-x-auto">
      <table className="table-auto w-full">
        <thead><tr><th>#</th><th>Producto</th><th className="text-center">Cantidad</th><th className="text-right">Importe</th></tr></thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={r.producto_id}>
              <td className="text-gray-400">{i + 1}</td>
              <td>{r.descripcion}</td>
              <td className="text-center">{fnum(r.cantidad)}</td>
              <td className="text-right">{fmt(r.importe)}</td>
            </tr>
          ))}
          {!data.rows.length && <tr><td colSpan={4} className="text-center text-gray-400 py-8">Sin ventas en el periodo</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function VistaFormasPago({ data }) {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <TarjetaKpi label="Efectivo" valor={fmt(data.montos.efectivo)} sub={`${fnum(data.tickets.efectivo)} tickets · ${data.montos.pct_efectivo.toFixed(1)}%`} />
        <TarjetaKpi label="Tarjeta" valor={fmt(data.montos.tarjeta)} sub={`${fnum(data.tickets.tarjeta)} tickets · ${data.montos.pct_tarjeta.toFixed(1)}%`} />
        <TarjetaKpi label="Tickets mixtos" valor={fnum(data.tickets.mixto)} sub="Efectivo + tarjeta" />
        <TarjetaKpi label="Total" valor={fmt(data.montos.total)} tono="brand" />
      </div>
    </>
  );
}

function VistaExistencias({ data }) {
  return (
    <>
      <div className="card p-0 overflow-x-auto mb-4">
        <table className="table-auto w-full">
          <thead><tr><th>Sucursal</th><th className="text-center"># Productos</th><th className="text-right">Unidades</th></tr></thead>
          <tbody>
            {data.por_sucursal.map((r) => (
              <tr key={r.sucursal_id}>
                <td>{r.sucursal}</td>
                <td className="text-center">{fnum(r.num_productos)}</td>
                <td className="text-right">{fnum(r.unidades)}</td>
              </tr>
            ))}
            {!data.por_sucursal.length && <tr><td colSpan={3} className="text-center text-gray-400 py-8">Sin sucursales</td></tr>}
          </tbody>
        </table>
      </div>

      <h3 className="font-semibold text-gray-800 mb-2">Stock bajo (por debajo del mínimo)</h3>
      <div className="card p-0 overflow-x-auto mb-4">
        <table className="table-auto w-full">
          <thead><tr><th>Sucursal</th><th>SKU</th><th>Producto</th><th className="text-right">Existencia</th><th className="text-right">Mínimo</th></tr></thead>
          <tbody>
            {data.stock_bajo.map((r, i) => (
              <tr key={`${r.producto_id}-${i}`}>
                <td>{r.sucursal}</td>
                <td className="font-mono text-xs">{r.sku_interno}</td>
                <td>{r.descripcion}</td>
                <td className="text-right text-red-600 font-medium">{fnum(r.existencia)}</td>
                <td className="text-right">{fnum(r.stock_minimo)}</td>
              </tr>
            ))}
            {!data.stock_bajo.length && <tr><td colSpan={5} className="text-center text-gray-400 py-8">Sin productos por debajo del mínimo</td></tr>}
          </tbody>
        </table>
      </div>

      <h3 className="font-semibold text-gray-800 mb-2">Próximos a caducar</h3>
      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead><tr><th>Sucursal</th><th>SKU</th><th>Producto</th><th>Lote</th><th>Caducidad</th><th className="text-right">Cantidad</th></tr></thead>
          <tbody>
            {data.por_caducar.map((r, i) => (
              <tr key={`${r.numero_lote}-${i}`}>
                <td>{r.sucursal}</td>
                <td className="font-mono text-xs">{r.sku_interno}</td>
                <td>{r.descripcion}</td>
                <td className="font-mono text-xs">{r.numero_lote}</td>
                <td className="text-amber-700">{String(r.fecha_caducidad).slice(0, 10)}</td>
                <td className="text-right">{fnum(r.cantidad_actual)}</td>
              </tr>
            ))}
            {!data.por_caducar.length && <tr><td colSpan={6} className="text-center text-gray-400 py-8">Sin lotes próximos a caducar</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function VistaRecetas({ data }) {
  const CLASIF = { antibiotico: 'Antibiótico', fraccion_i: 'Fracción I', fraccion_ii: 'Fracción II', fraccion_iii: 'Fracción III' };
  return (
    <div className="card p-0 overflow-x-auto">
      <table className="table-auto w-full">
        <thead><tr><th>Clasificación</th><th className="text-center">Partidas</th><th className="text-right">Unidades</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.clasificacion_cofepris}>
              <td><span className="badge-yellow">{CLASIF[r.clasificacion_cofepris] || r.clasificacion_cofepris}</span></td>
              <td className="text-center">{fnum(r.partidas)}</td>
              <td className="text-right">{fnum(r.unidades)}</td>
            </tr>
          ))}
          {!data.rows.length && <tr><td colSpan={3} className="text-center text-gray-400 py-8">Sin recetas dispensadas en el periodo</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
