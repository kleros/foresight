const IPFS_PREFIXES = ["ipfs://", "ipfs::/", "ipfs:/", "/ipfs/", "ipfs/", "/"];

/**
 * Extracts the CID, with any trailing path.
 * @returns the path to append to a gateway.
 */
export const ipfsPath = (uri: string) => {
  const trimmed = uri.trim();

  for (const prefix of IPFS_PREFIXES) {
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }

  return trimmed;
};
