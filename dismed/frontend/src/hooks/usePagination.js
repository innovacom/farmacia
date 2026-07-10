import { useState, useMemo, useEffect } from 'react';
import { usePrefsStore } from '../store/prefsStore';

/**
 * Paginación client-side reutilizable sobre un array ya cargado.
 * Toma el tamaño de página de las preferencias (Configuración) salvo override.
 *
 * @param {Array} items  arreglo completo a paginar
 * @param {number} [pageSizeOverride]  fuerza un tamaño distinto al de preferencias
 * @returns { pageItems, page, setPage, totalPages, total, pageSize, from, to }
 */
export function usePagination(items = [], pageSizeOverride) {
  const rowsPerPage = usePrefsStore((s) => s.rowsPerPage);
  const pageSize = pageSizeOverride ?? rowsPerPage;
  const [page, setPage] = useState(1);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Si cambia el tamaño de página o el dataset se encoge (filtros, recarga),
  // no dejar al usuario varado en una página que ya no existe.
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return { pageItems, page, setPage, totalPages, total, pageSize, from, to };
}
