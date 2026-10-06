import { create } from "zustand";

export type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface UIState {
  toasts: Toast[];
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
  removeToast: (id: string) => void;
}

function uid() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useUIStore = create<UIState>((set, get) => ({
  toasts: [],

  showSuccess: (message) => {
    const id = uid();
    set({ toasts: [...get().toasts, { id, message, type: "success" }] });
    setTimeout(() => get().removeToast(id), 3000);
  },

  showError: (message) => {
    const id = uid();
    set({ toasts: [...get().toasts, { id, message, type: "error" }] });
    setTimeout(() => get().removeToast(id), 4000);
  },

  showInfo: (message) => {
    const id = uid();
    set({ toasts: [...get().toasts, { id, message, type: "info" }] });
    setTimeout(() => get().removeToast(id), 3000);
  },

  removeToast: (id) =>
    set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
