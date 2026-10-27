/** Hundredths of a percent a mint's or a withdrawal's token amounts may fall below what the popup showed. */
export const LIQUIDITY_SLIPPAGE_BPS = 100;

/** Seconds a mint or a withdrawal stays valid once signed. */
export const LIQUIDITY_DEADLINE_SECONDS = 30n * 60n;

/** Swapr's Algebra v1 tick spacing; read from the pool when it exists, assumed for one the run creates. */
export const NEW_POOL_TICK_SPACING = 60;

/** How far a seeded pool's price may end from the price the popup showed, in ticks. */
export const SEED_PRICE_TOLERANCE_TICKS = 1;

/** The least and most UP price a branch may be seeded at, in basis points of the parent outcome token. */
export const MIN_SEED_PRICE_BPS = 100n;
export const MAX_SEED_PRICE_BPS = 9_900n;

/** Rounding a branch may leave unused in the wallet, per token, in wei. */
export const DUST_WEI = 10n ** 6n;

/** Hundredths of a percent an xDAI split's minted sDAI may fall below `previewDeposit`; the predict flow's margin. */
export { MINT_RATE_MARGIN_BPS } from "@/features/predict/flow/plan";

/** Native balance an xDAI split always leaves for gas: 0.01 xDAI. */
export const GAS_RESERVE_WEI = 10n ** 16n;

/** Per-token scale of the throwaway position a self-realign trades against, in wei. */
export const REALIGN_DUST_WEI = 10n ** 12n;
