/** Long enough to stay readable in a wallet's token list, short enough to fit one. */
export const TOKEN_MAX_LENGTH = 14;

/** Seer packs every token name into one word, `toString31`, and reverts above it. */
export const MAX_TOKEN_BYTES = 31;

/** The longest suffix a scalar branch adds to its outcome's token. */
const LONGEST_CHILD_SUFFIX = "_DOWN";

export const MAX_BRANCH_TOKEN_BYTES = MAX_TOKEN_BYTES - LONGEST_CHILD_SUFFIX.length;

/** Bytes, not characters: `toString31` counts what UTF-8 encoding produces. */
export function tokenByteLength(token: string): number {
  return new TextEncoder().encode(token).length;
}

export function slugToken(label: string): string {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, TOKEN_MAX_LENGTH);
}
