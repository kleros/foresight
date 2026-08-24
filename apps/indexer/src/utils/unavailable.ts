/** What a failed on-chain read leaves in a non-null string field. */
export const UNAVAILABLE = "";

/** Narrows away both a missing field and the UNAVAILABLE marker. */
export const isAvailable = (value: string | undefined): value is string => value !== undefined && value !== UNAVAILABLE;
