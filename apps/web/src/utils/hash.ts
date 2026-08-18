/** Both ends kept: that is what gets checked against an explorer. */
export const shortHash = (hash?: string) => (hash ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : "");
