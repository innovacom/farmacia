import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ListTree } from 'lucide-react';
import api from '../../services/api';

// Consulta del Código Agrupador de Cuentas del SAT (Anexo 24 RMF).
export default function CatalogoCuentas() {
  const [q, setQ] = useState('');
  const [rubro, setRubro] = useState('');
  const [nivel, setNivel] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['catalogo-cuentas', q, rubro, nivel],
    queryFn: () =>
      api.get('/contabilidad/catalogo-cuentas', {
        params: { q: q || undefined, rubro: rubro || undefined, nivel: nivel || undefined, limit: 2000 },
      }).then((r) => r.data),
    keepPreviousData: true,
  });

  const rows = data?.rows || [];
  const rubros = data?.rubros || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ListTree size={22} className="text-brand-500" /> Catálogo de cuentas
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Código Agrupador del SAT — Anexo 24 de la Resolución Miscelánea Fiscal.
          </p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative md:col-span-1">
            <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Buscar código o nombre…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="input" value={rubro} onChange={(e) => setRubro(e.target.value)}>
            <option value="">Todos los rubros</option>
            {rubros.map((r) => (
              <option key={r.rubro} value={r.rubro}>{r.rubro} ({r.n})</option>
            ))}
          </select>
          <select className="input" value={nivel} onChange={(e) => setNivel(e.target.value)}>
            <option value="">Todos los niveles</option>
            <option value="1">Nivel 1 — Cuenta de mayor</option>
            <option value="2">Nivel 2 — Subcuenta</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-gray-500">
            {isLoading ? 'Cargando…' : `${rows.length} de ${data?.total ?? 0} cuentas`}
          </p>
        </div>
        <table className="table-auto w-full text-sm">
          <thead>
            <tr>
              <th className="w-24">Código</th>
              <th>Nombre de la cuenta / subcuenta</th>
              <th className="w-40">Rubro</th>
              <th className="text-center w-20">Nivel</th>
              <th className="text-center w-24">Naturaleza</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.codigo} className={c.nivel === 1 ? 'bg-gray-50/60' : ''}>
                <td className={`font-mono ${c.nivel === 1 ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                  {c.codigo}
                </td>
                <td className={c.nivel === 1 ? 'font-medium text-gray-900' : 'text-gray-700 pl-4'}>
                  {c.nombre}
                </td>
                <td className="text-gray-500">{c.rubro}</td>
                <td className="text-center text-gray-400">{c.nivel}</td>
                <td className="text-center">
                  <span className={`badge text-xs ${c.naturaleza === 'D' ? 'badge-blue' : 'badge-gray'}`}>
                    {c.naturaleza === 'D' ? 'Deudora' : 'Acreedora'}
                  </span>
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={5} className="text-center text-gray-400 py-8">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
