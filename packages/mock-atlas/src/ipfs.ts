/**
 * The IPFS side: Atlas's upload endpoint and the gateway the indexer reads from,
 * backed by one in-memory store so uploads round-trip locally.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { EXAMPLE_METADATA, EXAMPLE_METADATA_CID } from "@foresight/session-metadata";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";

import { bearerAddress } from "./auth";
import { log, readBody, send, sendJson } from "./http";

/** CIDv0 requires the dag-pb codec. */
const DAG_PB_CODE = 0x70;

const cidV0 = async (bytes: Uint8Array): Promise<string> =>
  CID.create(0, DAG_PB_CODE, await sha256.digest(bytes)).toString();

type StoredFile = { bytes: Uint8Array; contentType: string };

const files = new Map<string, StoredFile>();

/**
 * Seeds the shared example document under its declared key, so `EXAMPLE_METADATA_URI`
 * resolves on this gateway.
 */
export const seedExampleMetadata = () => {
  files.set(EXAMPLE_METADATA_CID, {
    bytes: new TextEncoder().encode(JSON.stringify(EXAMPLE_METADATA, null, 2)),
    contentType: "application/json",
  });
  log(`seeded example metadata at /ipfs/${EXAMPLE_METADATA_CID}`);
};

export const handleUpload = async (req: IncomingMessage, res: ServerResponse) => {
  if (!bearerAddress(req)) return sendJson(res, 401, { message: "Unauthorized" });

  const body = await readBody(req);
  const form = await new Response(body, {
    headers: { "content-type": req.headers["content-type"] ?? "" },
  }).formData();

  const file = form.get("file");
  if (!(file instanceof File)) return sendJson(res, 400, { message: "Missing file field" });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const cid = await cidV0(bytes);
  files.set(cid, { bytes, contentType: file.type || "application/octet-stream" });

  log(`upload ${file.name} (${bytes.length} bytes) -> ${cid}`);

  return send(res, 200, cid, "text/plain");
};

export const handleGateway = (res: ServerResponse, pathname: string) => {
  const cid = pathname.replace(/^\/ipfs\//, "").split("/")[0] ?? "";
  const file = files.get(cid);
  if (!file) {
    log(`gateway miss ${cid}`);
    return sendJson(res, 404, { message: `unknown cid ${cid}` });
  }
  return send(res, 200, file.bytes, file.contentType);
};
