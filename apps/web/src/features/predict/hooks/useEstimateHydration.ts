import { useEffect } from "react";

import { ESTIMATES_STORAGE_KEY, useEstimateStore } from "../stores/estimateStore";

/**
 * Loads saved estimates once the page is on screen (see `skipHydration` on the store), and
 * again whenever another tab writes them, so two tabs on one session do not overwrite each other.
 */
export function useEstimateHydration() {
  useEffect(() => {
    void useEstimateStore.persist.rehydrate();

    const onStorage = (event: StorageEvent) => {
      // a null key is storage being cleared elsewhere
      if (event.key === ESTIMATES_STORAGE_KEY || event.key === null) void useEstimateStore.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}
