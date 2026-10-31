import { create } from 'zustand';
import type { IsoDate } from '@/types/api';
import type { PurchaseResponse } from '@/types/purchase';
import type { PaymentSimulation } from '@/types/payment';

export type PurchaseStep = 'select' | 'billing' | 'review' | 'done';

export interface PurchaseSelection {
  attractionId: string;
  date: IsoDate;
  time: string;
  quantity: number;
}

interface PurchaseState {
  step: PurchaseStep;
  selection: PurchaseSelection | null;
  /** Pedido PENDING_PAYMENT con el precio calculado por el servidor y la retención temporal de cupos. */
  purchase: PurchaseResponse | null;
  payment: PaymentSimulation | null;
  setSelection: (selection: PurchaseSelection) => void;
  goTo: (step: PurchaseStep) => void;
  setPurchase: (purchase: PurchaseResponse) => void;
  setPayment: (payment: PaymentSimulation) => void;
  reset: () => void;
}

const initial = { step: 'select' as PurchaseStep, selection: null, purchase: null, payment: null };

export const usePurchaseStore = create<PurchaseState>((set) => ({
  ...initial,
  setSelection: (selection) =>
    set((state) => {
      const same =
        state.selection &&
        state.selection.attractionId === selection.attractionId &&
        state.selection.date === selection.date &&
        state.selection.time === selection.time &&
        state.selection.quantity === selection.quantity;
      // Cambiar la selección invalida el pedido calculado: será una operación lógica nueva.
      return same ? { selection } : { selection, purchase: null, payment: null };
    }),
  goTo: (step) => set({ step }),
  setPurchase: (purchase) => set({ purchase, step: 'review' }),
  setPayment: (payment) => set({ payment, step: 'done' }),
  reset: () => set(initial),
}));
