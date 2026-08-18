"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { getImageFile, subscribeImages, type ImageSlot } from "../stores/imageStore";

/**
 * A blob url for a picked image, for as long as it is on screen.
 * @returns null during SSR and whenever no file is picked.
 */
export function useImageUrl(slot: ImageSlot): string | null {
  const file = useSyncExternalStore(
    subscribeImages,
    () => getImageFile(slot),
    () => undefined,
  );

  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);

  return url;
}
