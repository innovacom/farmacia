import { ReporteContable, CuadreBadge, fmt } from './comun';

export default function BalanceGeneral() {
  return (
    <ReporteContable
      titulo="Balance General"
      descripcion="Posición de activo, pasivo y capital al corte, por cuenta del catálogo agrupador SAT (incluye saldos iniciales)."
      endpoint="/contabilidad/balance-general"
    >
      {(data) => (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Seccion titulo="Activo" cuentas={data.activo} total={data.totales?.activo} />
          <div className="space-y-4">
            <Seccion titulo="Pasivo" cuentas={data.pasivo} total={data.totales?.pasivo} />
            <Seccion titulo="Capital" cuentas={data.capital} total={data.totales?.capital} />
            <div className="card">
              <div className="flex items-center justify-between font-semibold text-gray-900">
                <span>Pasivo + Capital</span>
                <span className="tabular-nums">{fmt(data.totales?.pasivo_mas_capital)}</span>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 text-sm text-gray-500">
                <span>Activo = Pasivo + Capital</span>
                <CuadreBadge cuadra={data.totales?.cuadra} />
              </div>
            </div>
          </div>
        </div>
      )}
    </ReporteContable>
  );
}

function Seccion({ titulo, cuentas, total }) {
  return (
    <div className="card">
      <h3 className="font-semibold text-gray-800 mb-2">{titulo}</h3>
      <table className="table-auto w-full text-sm">
        <tbody>
          {cuentas.map((c) => (
            <tr key={c.codigo}>
              <td className="text-gray-400 font-mono text-xs w-12">{c.codigo}</td>
              <td className="text-gray-700">
                {c.cuenta}
                {c.estimado && <span className="ml-1 text-[10px] text-amber-600">(estimado)</span>}
              </td>
              <td className={`text-right tabular-nums ${c.importe < 0 ? 'text-red-600' : ''}`}>{fmt(c.importe)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold border-t border-gray-200">
            <td colSpan={2} className="pt-2">Total {titulo.toLowerCase()}</td>
            <td className="text-right tabular-nums pt-2">{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
