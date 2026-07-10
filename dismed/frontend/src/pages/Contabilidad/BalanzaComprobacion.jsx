import { ReporteContable, CuadreBadge, fmt } from './comun';

// Muestra un importe en su columna (deudor>0 / acreedor<0) o vacío.
const Dr = (v) => (v > 0 ? fmt(v) : '');
const Cr = (v) => (v < 0 ? fmt(-v) : '');

export default function BalanzaComprobacion() {
  return (
    <ReporteContable
      titulo="Balanza de Comprobación"
      descripcion="Saldo inicial + cargos − abonos = saldo final, por cuenta del catálogo agrupador SAT."
      endpoint="/contabilidad/balanza"
    >
      {(data) => (
        <div className="card overflow-x-auto">
          <table className="table-auto w-full text-sm">
            <thead>
              <tr className="text-xs">
                <th rowSpan={2} className="w-16">Cta.</th>
                <th rowSpan={2}>Cuenta</th>
                <th colSpan={2} className="text-center border-b">Saldo inicial</th>
                <th rowSpan={2} className="text-right w-32">Cargos</th>
                <th rowSpan={2} className="text-right w-32">Abonos</th>
                <th colSpan={2} className="text-center border-b">Saldo final</th>
              </tr>
              <tr className="text-xs text-gray-400">
                <th className="text-right w-28">Deudor</th>
                <th className="text-right w-28">Acreedor</th>
                <th className="text-right w-28">Deudor</th>
                <th className="text-right w-28">Acreedor</th>
              </tr>
            </thead>
            <tbody>
              {data.cuentas.map((c) => (
                <tr key={c.codigo}>
                  <td className="font-mono text-xs text-gray-400">{c.codigo}</td>
                  <td className="text-gray-700">{c.nombre}</td>
                  <td className="text-right tabular-nums text-gray-500">{Dr(c.saldo_inicial)}</td>
                  <td className="text-right tabular-nums text-gray-500">{Cr(c.saldo_inicial)}</td>
                  <td className="text-right tabular-nums">{c.cargos ? fmt(c.cargos) : ''}</td>
                  <td className="text-right tabular-nums">{c.abonos ? fmt(c.abonos) : ''}</td>
                  <td className="text-right tabular-nums font-medium">{Dr(c.saldo_final)}</td>
                  <td className="text-right tabular-nums font-medium">{Cr(c.saldo_final)}</td>
                </tr>
              ))}
              {data.cuentas.length === 0 && (
                <tr><td colSpan={8} className="text-center text-gray-400 py-8">
                  Sin movimientos. Genera las pólizas del periodo primero.
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t-2 border-gray-300 bg-gray-50">
                <td colSpan={2} className="pt-2">Sumas iguales</td>
                <td className="text-right tabular-nums pt-2">{fmt(data.totales?.saldo_inicial_deudor)}</td>
                <td className="text-right tabular-nums pt-2">{fmt(data.totales?.saldo_inicial_acreedor)}</td>
                <td className="text-right tabular-nums pt-2">{fmt(data.totales?.cargos)}</td>
                <td className="text-right tabular-nums pt-2">{fmt(data.totales?.abonos)}</td>
                <td className="text-right tabular-nums pt-2">{fmt(data.totales?.saldo_final_deudor)}</td>
                <td className="text-right tabular-nums pt-2">{fmt(data.totales?.saldo_final_acreedor)}</td>
              </tr>
            </tfoot>
          </table>
          <div className="flex justify-end mt-3">
            <CuadreBadge cuadra={data.totales?.cuadra} />
          </div>
        </div>
      )}
    </ReporteContable>
  );
}
