export type ImageSlot = "hero" | "icon" | `image:${string}`;

/** The slot a gallery image's bytes live under. */
export const imageSlot = (id: string): ImageSlot => `image:${id}`;

/** The id back out of a gallery slot, or null for hero and icon. */
export function imageIdOf(slot: `image:${string}`): string;
export function imageIdOf(slot: ImageSlot): string | null;
export function imageIdOf(slot: ImageSlot): string | null {
  return slot.startsWith("image:") ? slot.slice("image:".length) : null;
}

const files = new Map<ImageSlot, File>();
const listeners = new Set<() => void>();

export function setImageFile(slot: ImageSlot, file: File | null): void {
  if (file) files.set(slot, file);
  else files.delete(slot);
  for (const listener of listeners) listener();
}

/**
 * The preview renders the picked bytes, and re-picking a file with the same
 * name leaves the draft untouched, so the name is not a safe proxy for "the
 * image changed" and this store has to be subscribable in its own right.
 */
export function subscribeImages(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getImageFile(slot: ImageSlot): File | undefined {
  return files.get(slot);
}

/**
 * Clears any name whose bytes did not survive. After a reload the draft still
 * says "hero.jpg" but there is nothing to upload.
 * @returns the slots that were cleared.
 */
export function reconcileImageNames(names: {
  hero: string | null;
  icon: string | null;
  images?: Array<{ id: string }>;
}): ImageSlot[] {
  const lost: ImageSlot[] = [];
  if (names.hero && !files.has("hero")) lost.push("hero");
  if (names.icon && !files.has("icon")) lost.push("icon");
  for (const image of names.images ?? []) {
    if (!files.has(imageSlot(image.id))) lost.push(imageSlot(image.id));
  }
  return lost;
}
