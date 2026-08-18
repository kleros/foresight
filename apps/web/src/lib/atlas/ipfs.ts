import { gatewayUrl } from "@/utils/ipfs";

import type { MetadataUploader } from "./types";

/**
 * Whatever Atlas answers with goes on chain verbatim. `SessionFactory` takes
 * the uri as an unchecked string, and every reader normalizes through
 * `@/utils/ipfs`.
 */

export function createMetadataUploader(opts: {
  /** `AtlasProvider.uploadFile` with its role already bound. */
  upload(file: File): Promise<string | null>;
  /** Gateway where the uploaded file is served on. */
  gateway: string;
  fetchImpl?: typeof fetch;
}): MetadataUploader {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const put = async (file: File): Promise<string> => {
    // kleros-app rethrows the service's own `message` verbatim, and this reaches
    // the deploy screen. What the service calls itself is not the creator's to read.
    const path = await opts.upload(file).catch((err) => {
      console.error(err);
      throw new Error(`${file.name} could not be uploaded. Try again in a moment.`);
    });
    // A missing or expired session makes `uploadFile` answer null rather than
    // throw. Signing in from here cannot help: the provider only hands out a
    // token-bearing `uploadFile` on its next render, which is after this. The
    // deploy button is gated on `EnsureAuth` so it does not come to that.
    if (path === null) {
      throw new Error(`${file.name} could not be uploaded. Sign in again and retry.`);
    }
    return path;
  };

  return {
    uploadFile: put,

    uploadJson: (name, value) => put(new File([JSON.stringify(value)], name, { type: "application/json" })),

    async readJson(uriOrCid) {
      const url = gatewayUrl(opts.gateway, uriOrCid);
      const response = await doFetch(url);
      if (!response.ok) throw new Error(`The upload could not be read back (${response.status}).`);
      return response.json();
    },
  };
}
