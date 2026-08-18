import type { SessionMetadataDocument } from "@foresight/session-metadata";

/** Default port of @foresight/mock-atlas (packages/mock-atlas). */
export const MOCK_ATLAS_URL = "http://127.0.0.1:4747";

const gatewayUrl = (uri: string) => `${MOCK_ATLAS_URL}/ipfs/${uri.replace(/^(ipfs:\/\/|\/?ipfs\/)/, "")}`;

async function get(uri: string): Promise<Response> {
  const url = gatewayUrl(uri);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}

export async function readMetadataDocument(uri: string): Promise<SessionMetadataDocument> {
  return (await get(uri)).json() as Promise<SessionMetadataDocument>;
}

/** The stored bytes, for checking an image landed in the slot it was picked for. */
export async function readIpfsBytes(uri: string): Promise<Buffer> {
  return Buffer.from(await (await get(uri)).arrayBuffer());
}
