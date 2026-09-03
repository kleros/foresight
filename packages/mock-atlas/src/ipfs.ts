/**
 * The IPFS side: Atlas's upload endpoint and the gateway the indexer reads from.
 * The store is written through to disk
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { EXAMPLE_METADATA, EXAMPLE_METADATA_CID } from "@foresight/session-metadata";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";

import { bearerAddress } from "./auth";
import { CORS_HEADERS, log, readBody, send, sendJson } from "./http";

/** CIDv0 requires the dag-pb codec. */
const DAG_PB_CODE = 0x70;

const cidV0 = async (bytes: Uint8Array): Promise<string> =>
  CID.create(0, DAG_PB_CODE, await sha256.digest(bytes)).toString();

type StoredFile = { bytes: Uint8Array; contentType: string };

const STORE_DIR = process.env.MOCK_ATLAS_STORE_DIR || fileURLToPath(new URL("../.store", import.meta.url));

/** A miss here is retried against real gateways; forked chains reference real content. */
const UPSTREAM_GATEWAYS = (
  process.env.MOCK_ATLAS_UPSTREAM_GATEWAYS || "https://cloudflare-ipfs.com/ipfs,https://ipfs.io/ipfs"
)
  .split(",")
  .map((gateway) => gateway.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const UPSTREAM_TIMEOUT_MS = 8000;

const files = new Map<string, StoredFile>();

/** CIDs no gateway produced, so repeated page loads do not stall on upstream timeouts. */
const missing = new Set<string>();

/** The content type survives restarts in a `<cid>.mime` sidecar; cids never contain a dot. */
const MIME_SUFFIX = ".mime";

/** Loads what earlier runs stored. Call once at boot, before serving. */
export const initStore = () => {
  mkdirSync(STORE_DIR, { recursive: true });
  let loaded = 0;
  for (const name of readdirSync(STORE_DIR)) {
    if (name.endsWith(MIME_SUFFIX)) continue;
    try {
      const bytes = new Uint8Array(readFileSync(join(STORE_DIR, name)));
      let contentType = "application/octet-stream";
      try {
        contentType = readFileSync(join(STORE_DIR, name + MIME_SUFFIX), "utf8").trim() || contentType;
      } catch {
        // No sidecar only costs the content type.
      }
      files.set(name, { bytes, contentType });
      loaded += 1;
    } catch (error) {
      log(`store skip ${name}: ${String(error)}`);
    }
  }
  log(`store ${STORE_DIR} (${loaded} files)`);
};

const keep = (cid: string, file: StoredFile) => {
  files.set(cid, file);
  missing.delete(cid);
  try {
    writeFileSync(join(STORE_DIR, cid), file.bytes);
    writeFileSync(join(STORE_DIR, cid + MIME_SUFFIX), file.contentType);
  } catch (error) {
    log(`store write failed for ${cid}: ${String(error)}`);
  }
};

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
  keep(cid, { bytes, contentType: file.type || "application/octet-stream" });

  log(`upload ${file.name} (${bytes.length} bytes) -> ${cid}`);

  return send(res, 200, cid, "text/plain");
};

const fetchUpstream = async (cid: string): Promise<StoredFile | undefined> => {
  if (missing.has(cid)) return undefined;

  for (const gateway of UPSTREAM_GATEWAYS) {
    try {
      const response = await fetch(`${gateway}/${cid}`, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (!response.ok) continue;
      const file: StoredFile = {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
      };
      keep(cid, file);
      log(`gateway backfill ${cid} <- ${gateway}`);
      return file;
    } catch {
      // The next gateway gets its turn.
    }
  }

  missing.add(cid);
  return undefined;
};

export const handleGateway = async (res: ServerResponse, pathname: string, headOnly = false) => {
  const cid = pathname.replace(/^\/ipfs\//, "").split("/")[0] ?? "";
  const file = files.get(cid) ?? (await fetchUpstream(cid));
  if (!file) {
    log(`gateway miss ${cid}`);
    if (headOnly) {
      res.writeHead(404, CORS_HEADERS);
      return res.end();
    }
    return sendJson(res, 404, { message: `unknown cid ${cid}` });
  }
  if (headOnly) {
    res.writeHead(200, { ...CORS_HEADERS, "content-type": file.contentType, "content-length": file.bytes.length });
    return res.end();
  }
  return send(res, 200, file.bytes, file.contentType);
};
