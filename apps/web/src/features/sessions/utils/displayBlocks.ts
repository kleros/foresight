import type { DisplayBlock } from "@foresight/session-metadata";

import { tryGatewayUrl } from "@/utils/ipfs";

/**
 * The indexer stores blocks as raw jsonb, so a read hands back `unknown`.
 * Narrows to the shapes the renderer knows, resolving image uris against the
 * gateway; whatever fails either test is dropped, keeping the rest.
 */
export function displayBlocks(raw: unknown, gateway: string): DisplayBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isDisplayBlock).flatMap((block): DisplayBlock[] => {
    if (block.type === "markdown") return [block];
    const url = tryGatewayUrl(gateway, block.url);
    return url ? [{ ...block, url }] : [];
  });
}

function isDisplayBlock(entry: unknown): entry is DisplayBlock {
  if (typeof entry !== "object" || entry === null) return false;
  const block = entry as Record<string, unknown>;
  if (block.type === "markdown") {
    return typeof block.body === "string" && (block.label === undefined || typeof block.label === "string");
  }
  if (block.type === "image") {
    return typeof block.label === "string" && typeof block.url === "string";
  }
  return false;
}
