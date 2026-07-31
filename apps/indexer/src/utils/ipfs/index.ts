import type { EffectContext } from "envio";

const PUBLIC_GATEWAYS = ["https://cloudflare-ipfs.com/ipfs", "https://ipfs.io/ipfs"];

const endpoints = (): string[] => {
  const ipfsGateway = process.env.ENVIO_IPFS_GATEWAY?.trim();

  return ipfsGateway ? [ipfsGateway, ...PUBLIC_GATEWAYS] : PUBLIC_GATEWAYS;
};

const fetchFromEndpoint = async (endpoint: string, path: string, context: EffectContext): Promise<unknown> => {
  try {
    const response = await fetch(`${endpoint}/${path}`);
    if (!response.ok) {
      context.log.error(`IPFS ${endpoint} returned ${response.status} for ${path}`);

      return null;
    }

    return await response.json();
  } catch (error) {
    context.log.error(`IPFS ${endpoint} failed for ${path}: ${String(error)}`);

    return null;
  }
};

/** `data:`, `file:`, `javascript:`, `http:` … */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const assertRequestable = (path: string): void => {
  if (path.split("/").includes("..")) {
    throw new Error(`Refusing a metadata path that escapes the gateway root: ${path}`);
  }

  if (HAS_SCHEME.test(path)) {
    throw new Error(`Refusing a metadata path that is a uri of its own: ${path}`);
  }
};

/**
 * @returns the parsed JSON, or null when no gateway could produce it.
 * @throws when the path is not one we are willing to request at all.
 */
export const tryFetchIpfsFile = async (path: string, context: EffectContext): Promise<unknown> => {
  assertRequestable(path);

  for (const endpoint of endpoints()) {
    const document = await fetchFromEndpoint(endpoint, path, context);
    if (document !== null) return document;
  }

  context.log.error(`IPFS path unreachable on every gateway: ${path}`);

  return null;
};
