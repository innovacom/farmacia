import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Carrito del catálogo público /tienda — mismo patrón que authStore.js
// (persist en localStorage), pero sin relación con la sesión del ERP: un
// visitante de /tienda nunca inicia sesión. Solo guarda datos de EXHIBICIÓN
// (descripción, imagen, el precio que se vio en pantalla); el precio real
// SIEMPRE se vuelve a calcular en el servidor en POST /tienda/checkout/iniciar
// (tienda.checkout.service.js) — lo que viaje aquí nunca se usa para cobrar.
export const useTiendaCarrito = create(
  persist(
    (set, get) => ({
      items: [], // [{ producto_id, descripcion, imagen_url, precio_final, cantidad }]

      agregar: (producto) => set((state) => {
        const existente = state.items.find((it) => it.producto_id === producto.id);
        if (existente) {
          return {
            items: state.items.map((it) => it.producto_id === producto.id
              ? { ...it, cantidad: Math.min(it.cantidad + 1, 99) }
              : it),
          };
        }
        return {
          items: [...state.items, {
            producto_id: producto.id,
            descripcion: producto.descripcion_corta || producto.descripcion,
            imagen_url: producto.imagen_url || null,
            precio_final: producto.precio_final,
            cantidad: 1,
          }],
        };
      }),

      quitar: (productoId) => set((state) => ({
        items: state.items.filter((it) => it.producto_id !== productoId),
      })),

      setCantidad: (productoId, cantidad) => set((state) => ({
        items: cantidad < 1
          ? state.items.filter((it) => it.producto_id !== productoId)
          : state.items.map((it) => it.producto_id === productoId
              ? { ...it, cantidad: Math.min(cantidad, 99) }
              : it),
      })),

      vaciar: () => set({ items: [] }),

      totalPiezas: () => get().items.reduce((acc, it) => acc + it.cantidad, 0),
    }),
    { name: 'dismed-tienda-carrito' }
  )
);
