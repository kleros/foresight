/** 1e18, the scale every price in the schema is quoted at. */
export const WAD = 10n ** 18n;

export const abs = (value: bigint) => (value < 0n ? -value : value);
