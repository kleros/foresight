import { decodeFunctionData, encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import type { SwapQuote } from "@/lib/swap/types";

import { gnosisRouterAbi } from "@/config/contracts";

import { optionTradeCalls, type OptionTrade } from "../predict";

const ROUTER = "0x1111111111111111111111111111111111111111" as Address;
const SWAP_ROUTER = "0x2222222222222222222222222222222222222222" as Address;
const CHILD = "0x3333333333333333333333333333333333333333" as Address;
const UNDERLYING = "0x4444444444444444444444444444444444444444" as Address;
const COLLATERAL = "0x9999999999999999999999999999999999999999" as Address;
const UP = "0x5555555555555555555555555555555555555555" as Address;
const DOWN = "0x6666666666666666666666666666666666666666" as Address;
const INVALID = "0x7777777777777777777777777777777777777777" as Address;

const SWAP_DATA = "0xdeadbeef" as Hex;

const quote = (amountIn: bigint, overrides: Partial<SwapQuote> = {}): SwapQuote => ({
  amountIn,
  amountOut: amountIn / 2n,
  router: SWAP_ROUTER,
  data: SWAP_DATA,
  value: 0n,
  ...overrides,
});

const trade = (overrides: Partial<OptionTrade> = {}): OptionTrade => ({
  router: ROUTER,
  childMarket: CHILD,
  collateral: COLLATERAL,
  underlying: UNDERLYING,
  outcomeTokens: [DOWN, UP],
  invalidToken: INVALID,
  splitAmount: 0n,
  sells: [],
  mergeAmount: 0n,
  buys: [],
  ...overrides,
});

/** What each call does, as `<target>:<function>`, so a test can read the batch as a sequence. */
const shape = (calls: { to: Address; data: Hex }[]) =>
  calls.map((call) => {
    const abi = call.to === SWAP_ROUTER ? null : call.data.startsWith("0x095ea7b3") ? erc20Abi : gnosisRouterAbi;
    if (abi === null) return `${call.to}:swap`;
    return `${call.to}:${decodeFunctionData({ abi, data: call.data }).functionName}`;
  });

describe("optionTradeCalls", () => {
  it("splits, sells, merges and buys in that order", () => {
    const calls = optionTradeCalls(
      trade({
        splitAmount: 100n,
        sells: [{ tokenIn: UP, quote: quote(40n) }],
        mergeAmount: 30n,
        buys: [{ tokenIn: UNDERLYING, quote: quote(20n) }],
      }),
    );

    expect(shape(calls)).toEqual([
      `${UNDERLYING}:approve`,
      `${ROUTER}:splitPosition`,
      `${UP}:approve`,
      `${SWAP_ROUTER}:swap`,
      `${DOWN}:approve`,
      `${UP}:approve`,
      `${INVALID}:approve`,
      `${ROUTER}:mergePositions`,
      `${UNDERLYING}:approve`,
      `${SWAP_ROUTER}:swap`,
    ]);
  });

  it("approves the router for exactly what each swap takes", () => {
    const calls = optionTradeCalls(trade({ sells: [{ tokenIn: UP, quote: quote(40n) }] }));

    expect(calls[0]).toEqual({
      to: UP,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SWAP_ROUTER, 40n] }),
    });
  });

  it("gives each swap its own approve, so two legs spending one token do not overwrite each other", () => {
    const calls = optionTradeCalls(
      trade({
        buys: [
          { tokenIn: UNDERLYING, quote: quote(40n) },
          { tokenIn: UNDERLYING, quote: quote(25n) },
        ],
      }),
    );

    expect(shape(calls)).toEqual([
      `${UNDERLYING}:approve`,
      `${SWAP_ROUTER}:swap`,
      `${UNDERLYING}:approve`,
      `${SWAP_ROUTER}:swap`,
    ]);
    expect(calls[2]).toEqual({
      to: UNDERLYING,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SWAP_ROUTER, 25n] }),
    });
  });

  it("leaves out a split it was given nothing for", () => {
    expect(optionTradeCalls(trade({ sells: [{ tokenIn: UP, quote: quote(40n) }] }))).toHaveLength(2);
  });

  it("leaves out a merge it was given nothing for", () => {
    expect(
      optionTradeCalls(trade({ mergeAmount: 0n, buys: [{ tokenIn: UNDERLYING, quote: quote(9n) }] })),
    ).toHaveLength(2);
  });

  it("splits on the child market, not on the session's parent", () => {
    const [approve, split] = optionTradeCalls(trade({ splitAmount: 100n }));

    // the executor hands over the parent's outcome token, but the router names the collateral
    // the condition is denominated in, which is the session's own
    expect(approve!.to).toBe(UNDERLYING);
    expect(decodeFunctionData({ abi: gnosisRouterAbi, data: split!.data }).args).toEqual([COLLATERAL, CHILD, 100n]);
  });

  it("merges back to the same collateral the split named", () => {
    const calls = optionTradeCalls(trade({ mergeAmount: 40n, buys: [{ tokenIn: UNDERLYING, quote: quote(9n) }] }));
    const merge = calls.find((call) => call.to === ROUTER)!;

    expect(decodeFunctionData({ abi: gnosisRouterAbi, data: merge.data }).args).toEqual([COLLATERAL, CHILD, 40n]);
  });

  it("refuses a swap carrying native currency, which the executor would silently under-fund", () => {
    expect(() => optionTradeCalls(trade({ sells: [{ tokenIn: UP, quote: quote(40n, { value: 1n }) }] }))).toThrow(
      /native currency/,
    );
  });
});
