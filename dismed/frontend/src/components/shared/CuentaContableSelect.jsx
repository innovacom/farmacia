import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, X, Search } from 'lucide-react';
import api from '../../services/api';

/**
 * Selector de cuenta contable (Código Agrupador del SAT).
 * Controlado: `value` es el código (string) y `onChange(codigo|'')`.
 * Props opcionales: `rubro` (precarga/filtra por rubro), `placeholder`.
 */
export default function CuentaContableSelect({ value, onChange, rubro, placeholder = 'Sin asignar' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef(null);

  // Nombre de la cuenta seleccionada (para mostrar el código + nombre).
  const { data: sel } = useQuery({
    queryKey: ['cuenta-sel', value],
    queryFn: () => api.get('/contabilidad/catalogo-cuentas', { params: { q: value, limit: 5 } })
      .then((r) => (r.data.rows || []).find((c) => c.codigo === value) || null),
    enabled: !!value,
  });

  // Resultados de búsqueda al abrir.
  const { data, isLoading } = useQuery({
    queryKey: ['cuenta-buscar', q, rubro],
    queryFn: () => api.get('/contabilidad/catalogo-cuentas', {
      params: { q: q || undefined, rubro: rubro || undefined, limit: 50 },
    }).then((r) => r.data.rows || []),
    enabled: open,
    keepPreviousData: true,
  });

  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const rows = data || [];

  function pick(c) { onChange(c.codigo); setOpen(false); setQ(''); }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input flex items-center justify-between w-full text-left"
      >
        <span className={value ? 'text-gray-800' : 'text-gray-400'}>
          {value ? `${value} — ${sel?.nombre || '…'}` : placeholder}
        </span>
        <span className="flex items-center gap-1">
          {value && (
            <X
              size={14}
              className="text-gray-400 hover:text-red-500"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
            />
          )}
          <ChevronDown size={15} className="text-gray-400" />
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-72 overflow-hidden flex flex-col">
          <div className="relative p-2 border-b border-gray-100">
            <Search size={14} className="absolute left-4 top-4 text-gray-400" />
            <input
              autoFocus
              className="input pl-8 py-1.5 text-sm"
              placeholder="Buscar código o nombre…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="overflow-y-auto">
            {isLoading && <p className="text-xs text-gray-400 px-3 py-2">Buscando…</p>}
            {!isLoading && rows.length === 0 && (
              <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
            )}
            {rows.map((c) => (
              <button
                key={c.codigo}
                type="button"
                onClick={() => pick(c)}
                className="w-full text-left px-3 py-1.5 hover:bg-brand-50 flex items-center gap-2 text-sm"
              >
                <span className="font-mono text-xs text-gray-500 w-16 shrink-0">{c.codigo}</span>
                <span className="text-gray-700 truncate">{c.nombre}</span>
                <span className="ml-auto text-[10px] text-gray-400 shrink-0">{c.rubro}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
