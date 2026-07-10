import { ReporteContable, fmt, fpct } from './comun';

export default function EstadoResultados() {
  return (
    <ReporteContable
      titulo="Estado de Resultados"
      descripcion="Ingresos, costos, gastos y utilidad del periodo, por cuenta del catálogo agrupador SAT."
      endpoint="/contabilidad/estado-resultados"
    >
      {(data) => {
        const g = data.grupos || {};
        const r = data.resumen || {};
        return (
          <div className="card">
            <table className="table-auto w-full text-sm">
              <tbody>
                <Grupo titulo="Ingresos" grupo={g.ingresos} />
                <Grupo titulo="Costo de ventas" grupo={g.costos} signo="−" />
                <Total label="Utilidad bruta" valor={r.utilidad_bruta} />
                <Grupo titulo="Gastos" grupo={g.gastos} signo="−" />
                <Grupo titulo="Resultado integral de financiamiento" grupo={g.financieros} signo="−" />
                <Total label="Utilidad (o pérdida) del periodo" valor={r.utilidad} resultado />
              </tbody>
            </table>
            <div className="flex justify-end mt-3 text-sm text-gray-500">
              Margen de utilidad:&nbsp;<span className="font-medium text-gray-800">{fpct(r.margen_utilidad_pct)}</span>
            </div>
          </div>
        );
      }}
    </ReporteContable>
  );
}

function Grupo({ titulo, grupo, signo }) {
  const items = grupo?.items || [];
  return (
    <>
      <tr className="bg-gray-50">
        <td colSpan={2} className="font-semibold text-gray-800 pt-3">{titulo}</td>
        <td className="text-right font-semibold text-gray-800 pt-3 tabular-nums">
          {signo}{fmt(grupo?.subtotal)}
        </td>
      </tr>
      {items.map((it) => (
        <tr key={it.codigo}>
          <td className="font-mono text-xs text-gray-400 w-16 pl-4">{it.codigo}</td>
          <td className="text-gray-600">{it.nombre}</td>
          <td className="text-right tabular-nums text-gray-600">{fmt(it.importe)}</td>
        </tr>
      ))}
      {items.length === 0 && (
        <tr><td colSpan={3} className="text-xs text-gray-300 pl-4">— sin movimientos —</td></tr>
      )}
    </>
  );
}

function Total({ label, valor, resultado }) {
  return (
    <tr className={`border-t-2 border-gray-300 ${resultado ? 'bg-brand-50' : 'bg-gray-50'}`}>
      <td colSpan={2} className={`py-2 ${resultado ? 'font-bold text-brand-700' : 'font-semibold text-gray-900'}`}>
        {label}
      </td>
      <td className={`text-right tabular-nums py-2 ${resultado ? 'font-bold text-brand-700 text-base' : 'font-semibold'}
                      ${valor < 0 ? 'text-red-600' : ''}`}>
        {fmt(valor)}
      </td>
    </tr>
  );
}
