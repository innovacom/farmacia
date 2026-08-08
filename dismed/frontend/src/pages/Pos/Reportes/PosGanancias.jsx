import { PiggyBank, Printer } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  fmt, fpct, useFiltrosPos, useSucursales, useReportePos,
  FiltrosPos, EstadoReporte, NotaReporte, TarjetaKpi,
} from './comun';

// Paleta validada (dataviz skill, references/palette.md): venta = categórico
// slot 1 (azul), ganancia = slot 6 (verde). Par validado con
// scripts/validate_palette.js (ΔE CVD 26.5 protan / 29.0 normal-vision — sobra margen).
const COLOR_VENTA = '#2a78d6';
const COLOR_GANANCIA = '#008300';
const GRID = '#e1e0d9';
const AXIS = '#898781';

/**
 * Reporte de Ganancia/Margen del POS Farmacia — permiso APARTE
 * ('pos-reportes-ganancias'), separado a propósito del resto de los
 * reportes (ver PosReportes.jsx) para que el admin decida quién lo ve.
 */
export default function PosGanancias() {
  const { form, applied, set, aplicar } = useFiltrosPos({ conAgrupar: true });
  const { data: sucursales = [] } = useSucursales();
  const { data: kpiData, isFetching, isError, error } = useReportePos('/pos/reportes/ganancias', applied);
  const { data: prodData } = useReportePos('/pos/reportes/ganancias-productos', applied);
  const { data: preciosData } = useReportePos('/pos/reportes/precios-modificados', applied);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <PiggyBank size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Ganancias</h1>
        </div>
        <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2 no-print">
          <Printer size={15} /> Imprimir
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-4 no-print">
        Venta menos costo de las salidas de inventario (FEFO) de cada ticket. Reporte sensible: solo lo ve
        quien tenga el permiso "Ganancias".
      </p>

      <FiltrosPos form={form} set={set} aplicar={aplicar} sucursales={sucursales} conAgrupar />

      <EstadoReporte isError={isError} error={error} data={kpiData}>
        {kpiData && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
              <TarjetaKpi label="Venta" valor={fmt(kpiData.kpi.venta)} tono="brand" />
              <TarjetaKpi label="Descuento (promociones)" valor={fmt(kpiData.kpi.descuento)} />
              <TarjetaKpi label="Costo" valor={fmt(kpiData.kpi.costo)} />
              <TarjetaKpi label="Ganancia" valor={fmt(kpiData.kpi.ganancia)} tono="green" />
              <TarjetaKpi label="Margen" valor={fpct(kpiData.kpi.margen_pct)} tono="green" />
            </div>

            <div className="card mb-4">
              <h3 className="font-semibold text-gray-800 mb-3">Venta y ganancia por periodo</h3>
              {kpiData.serie.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={kpiData.serie} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="periodo" tick={{ fontSize: 12, fill: AXIS }} axisLine={{ stroke: AXIS }} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: AXIS }} axisLine={false} tickLine={false} width={70}
                      tickFormatter={(v) => fmt(v)} />
                    <Tooltip formatter={(v) => fmt(v)} contentStyle={{ fontSize: 13 }} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Line type="monotone" dataKey="venta" name="Venta" stroke={COLOR_VENTA} strokeWidth={2}
                      dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="ganancia" name="Ganancia" stroke={COLOR_GANANCIA} strokeWidth={2}
                      dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-400 text-center py-10">Sin ventas en el periodo</p>
              )}
            </div>
          </>
        )}
      </EstadoReporte>

      {prodData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-3">Más rentables (top 10)</h3>
            {prodData.top_rentables.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={prodData.top_rentables} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12, fill: AXIS }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => fmt(v)} />
                  <YAxis type="category" dataKey="descripcion" width={140} tick={{ fontSize: 11, fill: AXIS }}
                    axisLine={false} tickLine={false} tickFormatter={(v) => (v.length > 22 ? v.slice(0, 20) + '…' : v)} />
                  <Tooltip formatter={(v) => fmt(v)} contentStyle={{ fontSize: 13 }} />
                  <Bar dataKey="ganancia" name="Ganancia" fill={COLOR_GANANCIA} radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-gray-400 text-center py-10">Sin datos en el periodo</p>}
          </div>

          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-3">Más vendidos (top 10, por unidades)</h3>
            {prodData.top_vendidos.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={prodData.top_vendidos} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12, fill: AXIS }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="descripcion" width={140} tick={{ fontSize: 11, fill: AXIS }}
                    axisLine={false} tickLine={false} tickFormatter={(v) => (v.length > 22 ? v.slice(0, 20) + '…' : v)} />
                  <Tooltip contentStyle={{ fontSize: 13 }} />
                  <Bar dataKey="cantidad" name="Unidades" fill={COLOR_VENTA} radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-gray-400 text-center py-10">Sin datos en el periodo</p>}
          </div>
        </div>
      )}

      {kpiData && (
        <>
          <h3 className="font-semibold text-gray-800 mb-2">Detalle por producto</h3>
          <div className="card p-0 overflow-x-auto">
            <table className="table-auto w-full">
              <thead>
                <tr>
                  <th>Producto</th><th className="text-center">Cantidad</th>
                  <th className="text-right">Venta</th><th className="text-right">Descuento</th>
                  <th className="text-right">Costo</th>
                  <th className="text-right">Ganancia</th><th className="text-right">Margen</th>
                </tr>
              </thead>
              <tbody>
                {(prodData?.rows || []).map((r) => (
                  <tr key={r.producto_id}>
                    <td>{r.descripcion}</td>
                    <td className="text-center">{r.cantidad}</td>
                    <td className="text-right">{fmt(r.venta)}</td>
                    <td className="text-right text-gray-500">{r.descuento ? `− ${fmt(r.descuento)}` : '—'}</td>
                    <td className="text-right">{fmt(r.costo)}</td>
                    <td className="text-right text-green-700 font-medium">{fmt(r.ganancia)}</td>
                    <td className="text-right">{fpct(r.margen_pct)}</td>
                  </tr>
                ))}
                {!prodData?.rows?.length && (
                  <tr><td colSpan={7} className="text-center text-gray-400 py-8">Sin ventas en el periodo</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <NotaReporte nota={kpiData.nota} />
        </>
      )}

      {preciosData && (
        <div className="mt-6">
          <h3 className="font-semibold text-gray-800 mb-2">Precios modificados en el mostrador</h3>
          <div className="card p-0 overflow-x-auto">
            <table className="table-auto w-full">
              <thead>
                <tr>
                  <th>Fecha</th><th>Folio</th><th>Sucursal</th><th>Cajero</th>
                  <th>Producto</th><th className="text-right">Lista</th>
                  <th className="text-right">Cobrado</th><th className="text-right">Diferencia</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {preciosData.rows.map((r, i) => (
                  <tr key={`${r.folio}-${i}`}>
                    <td className="whitespace-nowrap">{new Date(r.created_at).toLocaleString('es-MX')}</td>
                    <td className="font-mono text-xs">{r.folio}</td>
                    <td>{r.sucursal}</td>
                    <td>{r.cajero}</td>
                    <td>{r.descripcion}</td>
                    <td className="text-right">{fmt(r.precio_lista)}</td>
                    <td className="text-right font-medium">{fmt(r.precio_cobrado)}</td>
                    <td className={`text-right ${r.diferencia < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {fmt(r.diferencia)}
                    </td>
                    <td className="max-w-xs">{r.motivo}</td>
                  </tr>
                ))}
                {!preciosData.rows.length && (
                  <tr><td colSpan={9} className="text-center text-gray-400 py-8">Sin precios modificados en el periodo</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <NotaReporte nota={preciosData.nota} />
        </div>
      )}

      {isFetching && kpiData && <p className="text-xs text-gray-400 mt-2 no-print">Actualizando…</p>}
    </div>
  );
}
