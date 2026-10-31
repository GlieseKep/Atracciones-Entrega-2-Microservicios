import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Ids de pedidos creados desde este navegador. El contrato no expone un listado de pedidos del cliente
 * (solo `GET /orders/{id}`), así que el perfil los recuerda localmente para poder abrirlos. Son
 * identificadores, no datos sensibles; el API sigue validando la propiedad del pedido.
 */
interface RecentOrdersState {
  ids: string[];
  add: (id: string) => void;
}

export const useRecentOrdersStore = create<RecentOrdersState>()(
  persist(
    (set) => ({
      ids: [],
      add: (id) => set((s) => ({ ids: [id, ...s.ids.filter((x) => x !== id)].slice(0, 20) })),
    }),
    { name: 'ea.recentOrders', storage: createJSONStorage(() => localStorage) },
  ),
);
