/**
 * Everything this app does with an IPFS uri: reading one, and refusing one.
 */

const PREFIXES = ["ipfs://", "ipfs::/", "ipfs:/", "/ipfs/", "ipfs/", "/"];

/**
 * Strips the addressing prefix and keeps whatever follows.
 *
 * @returns the path to append to a gateway.
 */
function ipfsPath(uri: string): string {
  const trimmed = uri.trim();
  for (const prefix of PREFIXES) {
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return trimmed;
}

/** `data:`, `file:`, `javascript:`, `http:` and anything else scheme-shaped. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * @throws when the path is not one worth requesting.
 */
function assertRequestable(path: string): void {
  if (!path) {
    throw new Error("Refusing an IPFS uri with no CID in it.");
  }
  if (path.split("/").includes("..")) {
    throw new Error(`Refusing a metadata path that escapes the gateway root: ${path}`);
  }
  if (HAS_SCHEME.test(path)) {
    throw new Error(`Refusing a metadata path that is a uri of its own: ${path}`);
  }
}

/**
 * Reading: the URL to fetch a stored uri from.
 *
 * @param gateway a gateway base such as `https://ipfs.io/ipfs`, with or without
 * a trailing slash.
 * @throws whatever `assertRequestable` throws, before any request is built.
 */
export function gatewayUrl(gateway: string, uri: string): string {
  const path = ipfsPath(uri);
  assertRequestable(path);
  return `${gateway.replace(/\/+$/, "")}/${path}`;
}

/**
 * @returns null where `gatewayUrl` refuses, so a render can drop the link
 * instead of throwing the page away over one.
 */
export function tryGatewayUrl(gateway: string, uri: string): string | null {
  try {
    return gatewayUrl(gateway, uri);
  } catch {
    return null;
  }
}
