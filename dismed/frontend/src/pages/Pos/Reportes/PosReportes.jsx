import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Printer, Download } from 'lucide-react';
import {
  fmt, fnum, useFiltrosPos, useSucursales, useReportePos,
  FiltrosPos, TabsPos, EstadoReporte, NotaReporte, TarjetaKpi,
} from './comun';
import { exportarCsv, hoyISO } from '../../../services/exportarExcel';
import api from '../../../services/api';
import Modal from '../../../components/ui/Modal';

const TABS = [
  { key: 'resumen',     label: 'Resumen',          endpoint: '/pos/reportes/resumen' },
  { key: 'tickets',     label: 'Tickets por fecha', endpoint: '/pos/reportes/tickets' },
  { key: 'sucursal',    label: 'Por sucursal',      endpoint: '/pos/reportes/ventas-sucursal' },
  { key: 'productos',   label: 'Top productos',     endpoint: '/pos/reportes/top-productos' },
  { key: 'venta_producto', label: 'Venta por producto (compras)', endpoint: '/pos/reportes/ventas-producto' },
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
            {tab === 'tickets' && <VistaTickets data={data} />}
            {tab === 'sucursal' && <VistaSucursal data={data} />}
            {tab === 'productos' && <VistaProductos data={data} />}
            {tab === 'venta_producto' && <VistaVentaProducto data={data} />}
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

// Lista de tickets del periodo con su cuenta de artículos/piezas, para
// verificar el conteo de "número de ventas" contra lo que cada ticket
// realmente incluyó. Al hacer clic se consulta el detalle (solo lectura;
// cancelar/facturar sigue viviendo en Ventas de mostrador, permiso aparte).
function VistaTickets({ data }) {
  const [ticketId, setTicketId] = useState(null);
  const { data: detalle, isFetching } = useQuery({
    queryKey: ['pos-ticket-detalle', ticketId],
    queryFn: () => api.get(`/pos/reportes/tickets/${ticketId}`).then((r) => r.data),
    enabled: !!ticketId,
  });

  return (
    <>
      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>Folio</th><th>Fecha</th><th>Sucursal / Caja</th><th>Cajero</th>
              <th className="text-center">Artículos</th><th className="text-center">Piezas</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setTicketId(r.id)}>
                <td className="font-mono text-xs">{r.folio}</td>
                <td>{new Date(r.created_at).toLocaleString('es-MX')}</td>
                <td>{r.sucursal} · {r.caja}</td>
                <td>{r.cajero}</td>
                <td className="text-center">{fnum(r.num_partidas)}</td>
                <td className="text-center">{fnum(r.num_piezas)}</td>
                <td className="text-right font-semibold">{fmt(r.total)}</td>
              </tr>
            ))}
            {!data.rows.length && <tr><td colSpan={7} className="text-center text-gray-400 py-8">Sin tickets en el periodo</td></tr>}
          </tbody>
        </table>
      </div>

      {ticketId && (
        <Modal title={detalle ? `Ticket ${detalle.folio}` : 'Cargando…'} onClose={() => setTicketId(null)} size="lg">
          {!detalle ? (
            <p className="text-sm text-gray-400 py-6 text-center">{isFetching ? 'Cargando…' : 'No se pudo cargar el ticket'}</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p><span className="text-gray-500">Fecha:</span> {new Date(detalle.created_at).toLocaleString('es-MX')}</p>
                <p><span className="text-gray-500">Cajero:</span> {detalle.cajero}</p>
                <p><span className="text-gray-500">Sucursal:</span> {detalle.sucursal} · {detalle.caja}</p>
                <p><span className="text-gray-500">Estatus:</span> {detalle.estatus}</p>
              </div>
              <table className="table-auto w-full">
                <thead><tr><th>Producto</th><th className="text-center">Cant.</th><th className="text-right">Importe</th></tr></thead>
                <tbody>
                  {detalle.partidas.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.descripcion}
                        {p.folio_receta || p.medico ? (
                          <p className="text-xs text-gray-400">
                            Receta {p.folio_receta || 's/folio'} · {p.medico} ({p.cedula_profesional})
                          </p>
                        ) : null}
                      </td>
                      <td className="text-center">{Number(p.cantidad)}</td>
                      <td className="text-right">{fmt(p.importe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-right text-lg font-bold">{fmt(detalle.total)}</div>
            </div>
          )}
        </Modal>
      )}
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

function VistaVentaProducto({ data }) {
  function exportar() {
    exportarCsv(`venta_producto_${hoyISO()}.csv`, data.rows.map((r) => ({
      SKU: r.sku_interno,
      EAN: r.ean,
      Producto: r.descripcion,
      Proveedor: r.proveedor,
      'Piezas vendidas': r.cantidad,
      Importe: r.importe,
    })));
  }
  return (
    <>
      <div className="flex justify-end mb-2 no-print">
        <button onClick={exportar} className="btn-secondary flex items-center gap-2" disabled={!data.rows.length}>
          <Download size={15} /> Exportar CSV
        </button>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>SKU</th><th>EAN</th><th>Producto</th><th>Proveedor</th>
              <th className="text-center">Piezas vendidas</th><th className="text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.producto_id}>
                <td className="font-mono text-xs">{r.sku_interno}</td>
                <td className="font-mono text-xs">{r.ean}</td>
                <td>{r.descripcion}</td>
                <td>{r.proveedor}</td>
                <td className="text-center">{fnum(r.cantidad)}</td>
                <td className="text-right">{fmt(r.importe)}</td>
              </tr>
            ))}
            {!data.rows.length && <tr><td colSpan={6} className="text-center text-gray-400 py-8">Sin ventas en el periodo</td></tr>}
          </tbody>
        </table>
      </div>
    </>
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
