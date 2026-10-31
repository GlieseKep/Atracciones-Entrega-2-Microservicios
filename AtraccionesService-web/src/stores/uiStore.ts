import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface UiState {
  toasts: Toast[];
  mobileMenuOpen: boolean;
  /** Ruta a la que volver cuando el usuario acepte iniciar sesión desde el diálogo. */
  loginPrompt: { returnTo: string; reason?: string } | null;
  notify: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
  setMobileMenu: (open: boolean) => void;
  requestLogin: (returnTo: string, reason?: string) => void;
  closeLoginPrompt: () => void;
}

let nextId = 1;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  mobileMenuOpen: false,
  loginPrompt: null,
  notify: (message, tone = 'info') => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts.slice(-2), { id, tone, message }] }));
    window.setTimeout(() => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })), 6000);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  setMobileMenu: (mobileMenuOpen) => set({ mobileMenuOpen }),
  requestLogin: (returnTo, reason) => set({ loginPrompt: { returnTo, reason } }),
  closeLoginPrompt: () => set({ loginPrompt: null }),
}));
