import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Sesión de CLIENTE de la tienda web (Entrega 2) — completamente aparte de
// authStore.js (staff/ERP): mismo patrón (Zustand + persist en localStorage)
// que tiendaCarritoStore.js, con su propia key, para que un visitante de
// /tienda que abre sesión con su código de WhatsApp nunca comparta el mismo
// slot que un empleado logueado en el ERP en ese mismo navegador (ej. un
// cajero que también compra en la tienda desde la PC del mostrador).
export const useTiendaAuth = create(
  persist(
    (set) => ({
      token: null,
      cliente: null, // { id, nombre, telefono, correo }
      setSesion: (token, cliente) => set({ token, cliente }),
      actualizarCliente: (cliente) => set({ cliente }),
      logout: () => set({ token: null, cliente: null }),
    }),
    { name: 'dismed-tienda-cliente' }
  )
);
