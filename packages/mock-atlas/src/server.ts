/**
 * Mock Atlas + IPFS gateway for local development and e2e.
 *
 * One process plays both roles so uploaded files round-trip locally:
 *   - `POST /graphql`      Atlas auth/user operations (./atlas.ts)
 *   - `POST /ipfs/file`    Atlas upload endpoint (./ipfs.ts)
 *   - `GET  /ipfs/<cid>`   gateway read, for the indexer's ENVIO_IPFS_GATEWAY
 *   - `GET  /healthz`      readiness probe
 *
 * State is in-memory and resets on restart.
 */
import { createServer } from "node:http";

import { handleGraphql } from "./atlas";
import { CORS_HEADERS, log, send, sendJson } from "./http";
import { DEFAULT_PORT } from "./index";
import { handleGateway, handleUpload, seedExampleMetadata } from "./ipfs";

const PORT = Number(process.env.MOCK_ATLAS_PORT ?? DEFAULT_PORT);

const server = createServer((req, res) => {
  const handle = async () => {
    const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }
    if (req.method === "GET" && pathname === "/healthz") return send(res, 200, "ok", "text/plain");
    if (req.method === "POST" && pathname === "/graphql") return handleGraphql(req, res);
    if (req.method === "POST" && pathname === "/ipfs/file") return handleUpload(req, res);
    if (req.method === "GET" && pathname.startsWith("/ipfs/")) return handleGateway(res, pathname);

    return sendJson(res, 404, { message: `mock-atlas: no route for ${req.method} ${pathname}` });
  };

  handle().catch((error: unknown) => {
    console.error(`[mock-atlas] ${req.method} ${req.url} failed: ${String(error)}`);
    if (!res.headersSent) sendJson(res, 500, { message: String(error) });
  });
});

seedExampleMetadata();

server.listen(PORT, () => {
  log(`listening on http://127.0.0.1:${PORT}`);
  log(`  atlas uri     -> NEXT_PUBLIC_ATLAS_URI=http://127.0.0.1:${PORT}`);
  log(`  ipfs gateway  -> ENVIO_IPFS_GATEWAY=http://127.0.0.1:${PORT}/ipfs`);
});
