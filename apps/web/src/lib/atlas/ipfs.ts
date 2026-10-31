import { gatewayUrl } from "@/utils/ipfs";

import type { MetadataUploader } from "./types";
import { createUploadMemory, type UploadMemory } from "./uploadMemory";

/**
 * Whatever Atlas answers with goes on chain verbatim. `SessionFactory` takes
 * the uri as an unchecked string, and every reader normalizes through
 * `@/utils/ipfs`.
 */

export const UPLOAD_ATTEMPTS = 6;
const RETRY_BASE_MS = 60_000;

/**
 * The limiter in front of Atlas answers 429 with an empty body, and kleros-app
 * reports a bodyless failure with this fallback. Pinned against the real library below.
 */
const OPAQUE_UPLOAD_FAILURE = "Error uploading to IPFS";

export function isRateLimited(error: unknown): boolean {
  return (
    error instanceof Error && (error.message === OPAQUE_UPLOAD_FAILURE || /too many requests/i.test(error.message))
  );
}

const backoffMs = (retry: number) => RETRY_BASE_MS * 2 ** (retry - 1);

export function createMetadataUploader(opts: {
  /** `AtlasProvider.uploadFile` with the image role already bound. */
  uploadImage(file: File): Promise<string | null>;
  /** The same, bound to the role that accepts `application/json`. */
  uploadDocument(file: File): Promise<string | null>;
  /** Gateway where the uploaded file is served on. */
  gateway: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  memory?: UploadMemory;
}): MetadataUploader {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const memory = opts.memory ?? createUploadMemory();

  const attempt = async (file: File, upload: (file: File) => Promise<string | null>): Promise<string | null> => {
    for (let tried = 1; ; tried++) {
      try {
        return await upload(file);
      } catch (err) {
        console.error(err);
        if (tried < UPLOAD_ATTEMPTS && isRateLimited(err)) {
          await sleep(backoffMs(tried));
          continue;
        }
        throw new Error(
          isRateLimited(err)
            ? `${file.name} could not be uploaded. Too many uploads at once: wait a minute and try again. Files already uploaded are kept.`
            : `${file.name} could not be uploaded. Try again in a moment.`,
        );
      }
    }
  };

  /** A recall trades the rate-limited upload for this cheap read: the memory can
      outlive the store behind the gateway, so it only counts while this answers ok. */
  const stillServed = async (path: string): Promise<boolean> => {
    try {
      const response = await doFetch(gatewayUrl(opts.gateway, path), {
        method: "HEAD",
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const put = async (file: File, upload: (file: File) => Promise<string | null>): Promise<string> => {
    const kept = await memory.recall(file);
    if (kept !== undefined && (await stillServed(kept))) return kept;

    const path = await attempt(file, upload);
    // A missing or expired session makes `uploadFile` answer null rather than
    // throw. Signing in from here cannot help: the provider only hands out a
    // token-bearing `uploadFile` on its next render, which is after this. The
    // deploy button is gated on `EnsureAuth` so it does not come to that.
    if (path === null) {
      throw new Error(`${file.name} could not be uploaded. Sign in again and retry.`);
    }
    await memory.keep(file, path);
    return path;
  };

  return {
    isServed: stillServed,

    uploadFile: (file) => put(file, opts.uploadImage),

    uploadJson: (name, value) =>
      put(new File([JSON.stringify(value)], name, { type: "application/json" }), opts.uploadDocument),

    async readJson(uriOrCid) {
      const url = gatewayUrl(opts.gateway, uriOrCid);
      const response = await doFetch(url);
      if (!response.ok) throw new Error(`The upload could not be read back (${response.status}).`);
      return response.json();
    },
  };
}
