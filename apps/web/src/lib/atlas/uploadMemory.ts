/**
 * Uploads that already landed, so a retried or resumed publish does not spend
 * the rate limiter's budget on them again. Keyed by a hash of the bytes: IPFS
 * is content-addressed, so identical bytes resolve to the same upload forever.
 */

export type UploadMemory = {
  /** The uri this exact content already lives at, if it went up before. */
  recall(file: File): Promise<string | undefined>;
  keep(file: File, uri: string): Promise<void>;
};

const STORAGE_KEY = "foresight.atlas-uploads.v1";

export const MAX_REMEMBERED = 200;

type Remembered = Record<string, string>;

async function fingerprint(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createUploadMemory(opts?: {
  /** `null` remembers only for this visit. Defaults to `localStorage` in the browser. */
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}): UploadMemory {
  const storage =
    opts?.storage !== undefined ? opts.storage : typeof window === "undefined" ? null : window.localStorage;

  const thisVisit = new WeakMap<File, string>();

  const load = (): Remembered => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return Object.fromEntries(Object.entries(parsed).filter(([, uri]) => typeof uri === "string")) as Remembered;
      }
    } catch {
      // Unreadable memory only costs a re-upload.
    }
    return {};
  };

  return {
    async recall(file) {
      const seen = thisVisit.get(file);
      if (seen !== undefined) return seen;

      const key = await fingerprint(file);
      const kept = key === null ? undefined : load()[key];
      if (kept !== undefined) thisVisit.set(file, kept);
      return kept;
    },

    async keep(file, uri) {
      thisVisit.set(file, uri);
      if (!storage) return;

      const key = await fingerprint(file);
      if (key === null) return;

      const remembered = load();
      delete remembered[key];
      const entries = [...Object.entries(remembered), [key, uri] as const];
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_REMEMBERED))));
      } catch {
        // A full store only costs a re-upload next visit.
      }
    },
  };
}
