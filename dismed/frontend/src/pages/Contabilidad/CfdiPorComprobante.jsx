import { ReporteCfdiImpuestos, fmt, fnum } from './comun';

const TC = { I: 'Ingreso', E: 'Egreso', P: 'Pago', T: 'Traslado', N: 'Nómina' };
const TIPO_CLS = { emitido: 'bg-blue-100 text-blue-700', recibido: 'bg-green-100 text-green-700' };

export default function CfdiPorComprobante() {
  return (
    <ReporteCfdiImpuestos
      titulo="CFDI — Desglose por Comprobante"
      descripcion="Subtotal, IVA, IEPS e ISR calculados desde los renglones (conceptos) de cada XML."
      endpoint="/contabilidad/cfdi-por-comprobante"
    >
      {(data) => (
        <div className="card overflow-x-auto">
          <table className="table-auto w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-xs text-left text-gray-500 border-b">
                <th className="pb-2">Fecha</th>
                <th className="pb-2">Tipo</th>
                <th className="pb-2">RFC emisor</th>
                <th className="pb-2">RFC receptor</th>
                <th className="pb-2 text-right">Subtotal</th>
                <th className="pb-2 text-right">Descuento</th>
                <th className="pb-2 text-right">Neto</th>
                <th className="pb-2 text-right text-blue-600">IVA</th>
                <th className="pb-2 text-right text-purple-600">IEPS</th>
                <th className="pb-2 text-right text-red-500">ISR ret.</th>
                <th className="pb-2 text-right">Total calc.</th>
                <th className="pb-2 text-right text-gray-400">Total XML</th>
                <th className="pb-2 text-right">Dif.</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => {
                const hasDif = Math.abs(r.diferencia_vs_xml || 0) > 0.05;
                return (
                  <tr key={i} className={hasDif ? 'bg-amber-50' : 'hover:bg-gray-50'}>
                    <td className="font-mono text-xs py-1 pr-3">{r.fecha?.slice(0, 10)}</td>
                    <td className="pr-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TIPO_CLS[r.tipo] || 'bg-gray-100 text-gray-600'}`}>
                        {r.tipo[0].toUpperCase()}
                      </span>{' '}
                      <span className="text-xs text-gray-400">{TC[r.tipo_comprobante] || r.tipo_comprobante}</span>
                    </td>
                    <td className="pr-3 text-xs">
                      <div className="font-mono">{r.rfc_emisor}</div>
                      <div className="text-gray-400 max-w-[130px] truncate">{r.nombre_emisor}</div>
                    </td>
                    <td className="pr-3 text-xs">
                      <div className="font-mono">{r.rfc_receptor}</div>
                      <div className="text-gray-400 max-w-[130px] truncate">{r.nombre_receptor}</div>
                    </td>
                    <td className="text-right tabular-nums pr-3">{fmt(r.subtotal)}</td>
                    <td className="text-right tabular-nums pr-3 text-gray-400">{r.descuento ? fmt(r.descuento) : '—'}</td>
                    <td className="text-right tabular-nums pr-3">{fmt(r.neto)}</td>
                    <td className="text-right tabular-nums pr-3 text-blue-700">{r.total_iva ? fmt(r.total_iva) : '—'}</td>
                    <td className="text-right tabular-nums pr-3 text-purple-700">{r.total_ieps ? fmt(r.total_ieps) : '—'}</td>
                    <td className="text-right tabular-nums pr-3 text-red-600">{r.total_isr ? fmt(r.total_isr) : '—'}</td>
                    <td className="text-right tabular-nums pr-3 font-medium">{fmt(r.total_calculado)}</td>
                    <td className="text-right tabular-nums pr-3 text-gray-400">{fmt(r.cfdi_total)}</td>
                    <td className={`text-right tabular-nums text-xs ${hasDif ? 'text-amber-600 font-semibold' : 'text-gray-300'}`}>
                      {hasDif ? fmt(r.diferencia_vs_xml) : '—'}
                    </td>
                  </tr>
                );
              })}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="text-center text-gray-400 py-10">
                    Sin comprobantes para los filtros seleccionados.
                  </td>
                </tr>
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className="font-semibold border-t-2 border-gray-300 bg-gray-50 text-sm">
                  <td colSpan={4} className="pt-2 pb-1">
                    {fnum(data.totales.num_comprobantes)} comprobantes
                  </td>
                  <td className="text-right tabular-nums pt-2">{fmt(data.totales.subtotal)}</td>
                  <td className="text-right tabular-nums pt-2 text-gray-400">{fmt(data.totales.descuento)}</td>
                  <td className="text-right tabular-nums pt-2">{fmt(data.totales.neto)}</td>
                  <td className="text-right tabular-nums pt-2 text-blue-700">{fmt(data.totales.total_iva)}</td>
                  <td className="text-right tabular-nums pt-2 text-purple-700">{fmt(data.totales.total_ieps)}</td>
                  <td className="text-right tabular-nums pt-2 text-red-600">{fmt(data.totales.total_isr)}</td>
                  <td className="text-right tabular-nums pt-2">{fmt(data.totales.total_calculado)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </ReporteCfdiImpuestos>
  );
}
