import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

import { AUTO_SLIPPAGE, normalizeSlippageSettings, type SlippageKind, type SlippageSettings } from "../utils/slippage";

type SlippageStore = {
  settings: SlippageSettings;
  /** Null sets the kind back to Auto. */
  setSlippage: (kind: SlippageKind, bps: number | null) => void;
};

export const SLIPPAGE_STORAGE_KEY = "foresight-predict-slippage";

/** Storage access throws in a private window or with site data blocked; the settings then last the page's life. */
const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // kept in memory only
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // nothing stored to remove
    }
  },
};

/** The visitor's slippage settings for predict runs, per browser. */
export const useSlippageStore = create<SlippageStore>()(
  persist(
    (set) => ({
      settings: AUTO_SLIPPAGE,
      setSlippage: (kind, bps) => set((state) => ({ settings: { ...state.settings, [kind]: bps } })),
    }),
    {
      name: SLIPPAGE_STORAGE_KEY,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({ settings: state.settings }),
      merge: (persisted, current) => ({
        ...current,
        settings: normalizeSlippageSettings((persisted as { settings?: unknown } | undefined)?.settings),
      }),
    },
  ),
);
