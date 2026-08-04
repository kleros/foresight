import type { IncomingMessage, ServerResponse } from "node:http";

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "GET, POST, OPTIONS",
} as const;

export const log = (message: string) => console.log(`[mock-atlas] ${message}`);

export const send = (res: ServerResponse, status: number, body: string | Uint8Array, contentType: string) => {
  res.writeHead(status, { ...CORS_HEADERS, "content-type": contentType });
  res.end(body);
};

export const sendJson = (res: ServerResponse, status: number, body: unknown) =>
  send(res, status, JSON.stringify(body), "application/json");

export const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};
