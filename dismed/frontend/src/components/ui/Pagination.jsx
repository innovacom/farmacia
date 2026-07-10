import { ChevronLeft, ChevronRight } from 'lucide-react';

// Construye la lista de páginas a mostrar con elipsis: 1 … 4 5 [6] 7 8 … 20
function pageList(page, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * Barra de paginación. Pensada para usarse con usePagination().
 * No se renderiza si no hay datos.
 */
export default function Pagination({ page, totalPages, total, from, to, onChange }) {
  if (total === 0) return null;

  const btn =
    'min-w-[2rem] h-8 px-2 flex items-center justify-center rounded-lg text-sm font-medium transition-colors ' +
    'border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 px-1 pt-3 mt-3 border-t border-gray-100">
      <p className="text-xs text-gray-500">
        Mostrando <span className="font-medium text-gray-700">{from}–{to}</span> de{' '}
        <span className="font-medium text-gray-700">{total}</span>
      </p>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button className={btn} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Anterior">
            <ChevronLeft size={16} />
          </button>

          {pageList(page, totalPages).map((p, i) =>
            p === '…' ? (
              <span key={`gap-${i}`} className="px-1 text-gray-400 text-sm">…</span>
            ) : (
              <button
                key={p}
                onClick={() => onChange(p)}
                className={
                  p === page
                    ? 'min-w-[2rem] h-8 px-2 flex items-center justify-center rounded-lg text-sm font-medium bg-brand-500 text-white'
                    : btn
                }
              >
                {p}
              </button>
            )
          )}

          <button className={btn} disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="Siguiente">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
