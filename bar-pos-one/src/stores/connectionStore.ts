import { create } from "zustand";

interface ConnectionState {
  isOnline: boolean;
  setOnline: (online: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  setOnline: (online) => set({ isOnline: online }),
}));

// Wire up browser events once
if (typeof window !== "undefined") {
  window.addEventListener("online", () => useConnectionStore.getState().setOnline(true));
  window.addEventListener("offline", () => useConnectionStore.getState().setOnline(false));
}
