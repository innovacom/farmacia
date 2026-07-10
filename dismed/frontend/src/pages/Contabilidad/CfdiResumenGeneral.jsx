import { ReporteCfdiImpuestos, fmt, fnum } from './comun';

const TC = { I: 'Ingreso', E: 'Egreso', P: 'Pago', T: 'Traslado', N: 'Nómina' };
const TIPO_CLS = { emitido: 'bg-blue-100 text-blue-700', recibido: 'bg-green-100 text-green-700' };

export default function CfdiResumenGeneral() {
  return (
    <ReporteCfdiImpuestos
      titulo="CFDI — Resumen General"
      descripcion="Totales agrupados por tipo de CFDI y tipo de comprobante, derivados de los renglones."
      endpoint="/contabilidad/cfdi-resumen-general"
    >
      {(data) => (
        <div className="card overflow-x-auto">
          <table className="table-auto w-full text-sm">
            <thead>
              <tr className="text-xs text-left text-gray-500 border-b">
                <th className="pb-2">Tipo</th>
                <th className="pb-2">Comprobante</th>
                <th className="pb-2 text-right">Comprobantes</th>
                <th className="pb-2 text-right text-gray-400">Renglones</th>
                <th className="pb-2 text-right">Subtotal</th>
                <th className="pb-2 text-right text-gray-400">Descuento</th>
                <th className="pb-2 text-right">Neto</th>
                <th className="pb-2 text-right text-blue-600">IVA</th>
                <th className="pb-2 text-right text-purple-600">IEPS</th>
                <th className="pb-2 text-right text-red-500">ISR ret.</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="py-1 pr-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TIPO_CLS[r.tipo] || 'bg-gray-100 text-gray-600'}`}>
                      {r.tipo}
                    </span>
                  </td>
                  <td className="pr-3">
                    <span className="font-mono font-semibold text-gray-800">{r.tipo_comprobante}</span>
                    {' '}<span className="text-xs text-gray-400">{TC[r.tipo_comprobante] || ''}</span>
                  </td>
                  <td className="text-right tabular-nums pr-3">{fnum(r.num_comprobantes)}</td>
                  <td className="text-right tabular-nums pr-3 text-gray-400">{fnum(r.num_renglones)}</td>
                  <td className="text-right tabular-nums pr-3">{fmt(r.subtotal)}</td>
                  <td className="text-right tabular-nums pr-3 text-gray-400">{r.descuento ? fmt(r.descuento) : '—'}</td>
                  <td className="text-right tabular-nums pr-3">{fmt(r.neto)}</td>
                  <td className="text-right tabular-nums pr-3 text-blue-700">{r.total_iva ? fmt(r.total_iva) : '—'}</td>
                  <td className="text-right tabular-nums pr-3 text-purple-700">{r.total_ieps ? fmt(r.total_ieps) : '—'}</td>
                  <td className="text-right tabular-nums pr-3 text-red-600">{r.total_isr ? fmt(r.total_isr) : '—'}</td>
                  <td className="text-right tabular-nums font-semibold">{fmt(r.total_general)}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center text-gray-400 py-10">
                    Sin datos para los filtros seleccionados.
                  </td>
                </tr>
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className="font-semibold border-t-2 border-gray-300 bg-gray-50 text-sm">
                  <td colSpan={2} className="pt-2 pb-1">Gran total</td>
                  <td className="text-right tabular-nums pt-2">{fnum(data.gran_total.num_comprobantes)}</td>
                  <td className="text-right tabular-nums pt-2 text-gray-400">{fnum(data.gran_total.num_renglones)}</td>
                  <td className="text-right tabular-nums pt-2">{fmt(data.gran_total.subtotal)}</td>
                  <td className="text-right tabular-nums pt-2 text-gray-400">{fmt(data.gran_total.descuento)}</td>
                  <td className="text-right tabular-nums pt-2">{fmt(data.gran_total.neto)}</td>
                  <td className="text-right tabular-nums pt-2 text-blue-700">{fmt(data.gran_total.total_iva)}</td>
                  <td className="text-right tabular-nums pt-2 text-purple-700">{fmt(data.gran_total.total_ieps)}</td>
                  <td className="text-right tabular-nums pt-2 text-red-600">{fmt(data.gran_total.total_isr)}</td>
                  <td className="text-right tabular-nums pt-2 font-bold">{fmt(data.gran_total.total_general)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </ReporteCfdiImpuestos>
  );
}
