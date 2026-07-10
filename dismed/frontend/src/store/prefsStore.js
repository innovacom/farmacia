import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Opciones ofrecidas en Configuración y en los selectores de paginación.
export const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

// Preferencias del usuario persistidas en localStorage (clave dismed-prefs).
// Por ahora solo renglones por página; se irán agregando más opciones.
export const usePrefsStore = create(
  persist(
    (set) => ({
      rowsPerPage: 25,
      setRowsPerPage: (n) => set({ rowsPerPage: Number(n) || 25 }),
    }),
    { name: 'dismed-prefs' }
  )
);
