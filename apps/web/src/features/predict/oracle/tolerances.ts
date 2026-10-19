import type { PredictSlippage } from "../flow/types";

/** Hundredths of a percent a quote may move against the trade wallet before the swap reverts, by default. */
export const SLIPPAGE_BPS = 100;

/** Seconds a quoted swap stays valid; a batch is quoted leg by leg before the wallet opens. */
export const QUOTE_DEADLINE_SECONDS = 30 * 60;

/** Native balance an xDAI deposit and Max always leave for gas: 0.01 xDAI. */
export const GAS_RESERVE_WEI = 10n ** 16n;

/** How far past its target a pool may end after a run, in ticks. */
export const PRICE_TOLERANCE_TICKS = 1;

/** Rounding allowed between an xDAI deposit's expected and minted sDAI, in wei. */
export const DUST_WEI = 10n ** 6n;

/**
 * Hundredths of a percent the credits swap's output may fall below its quote, by default; the
 * surplus over this floor stays in the trade wallet as WXDAI.
 */
export const CREDITS_SLIPPAGE_BPS = 20;

/** The slippage a run uses unless the visitor sets their own. */
export const DEFAULT_SLIPPAGE: PredictSlippage = { tradeBps: SLIPPAGE_BPS, creditsBps: CREDITS_SLIPPAGE_BPS };

/** The most slippage a run accepts on any swap, as CowSwap caps it: 50%. */
export const MAX_SLIPPAGE_BPS = 5_000;

/** The least custom slippage: a swap held to its exact quote reverts on a pool's rounding alone. */
export const MIN_SLIPPAGE_BPS = 1;

/** Custom slippage above these warns in the settings: 5% on trades, 1% on the credits swap's stable pair. */
export const HIGH_SLIPPAGE_BPS: Readonly<PredictSlippage> = { tradeBps: 500, creditsBps: 100 };

/** Custom slippage under these warns in the settings: 0.1% on trades, 0.05% on the credits swap. */
export const LOW_SLIPPAGE_BPS: Readonly<PredictSlippage> = { tradeBps: 10, creditsBps: 5 };
