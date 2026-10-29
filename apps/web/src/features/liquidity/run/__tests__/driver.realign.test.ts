import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeEventTopics, parseAbi, zeroAddress, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOKENS, empty, seedInput } from "./support/requests";
import {
  CLOSES_AT,
  chain,
  copyStorage,
  disposeDrivers,
  driverOn,
  gateway,
  progressOf,
  wallet,
  type Chain,
  type LogsOf,
} from "./support/world";
import {
  BPS,
  CHAIN_TIME,
  LIST,
  amount0Delta,
  amount1Delta,
  decode,
  fullRange,
  liquidityFor,
  owner,
  txsOf,
  userSqrtPrice,
} from "../../flow/__tests__/support/session";
import { planSeed } from "../../flow/plan";
import { LIQUIDITY_DEADLINE_SECONDS, LIQUIDITY_SLIPPAGE_BPS } from "../../oracle/tolerances";
import type { PoolState } from "../../types";

afterEach(disposeDrivers);

const DUST_ID = 4_242n;
const TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);
const REVIEWED = { up: empty(3_000n, true), down: { status: "missing" } as PoolState };
const FROM = REVIEWED.up.status === "empty" ? REVIEWED.up.sqrtPriceX96 : 0n;
const { sqrtA, sqrtB } = fullRange(60);

/** The realign's dust mint: a multicall holding one mint and nothing else. */
const isDustMint = (tx: FlowTx) => {
  const decoded = decode(tx);
  return decoded.kind === "multicall" && decoded.inner.length === 1 && decoded.inner[0]!.name === "mint";
};

const isWithdraw = (tx: FlowTx) => {
  const decoded = decode(tx);
  return decoded.kind === "multicall" && decoded.inner.some((call) => call.name === "decreaseLiquidity");
};

/** The dust mint's position manager Transfer from the zero address, giving out `DUST_ID`. */
const mintLogs: LogsOf = (sent, receipt) =>
  isDustMint(sent.tx)
    ? [
        {
          address: LIST.positionManager,
          topics: encodeEventTopics({
            abi: TRANSFER,
            eventName: "Transfer",
            args: { from: zeroAddress, to: owner, tokenId: DUST_ID },
          }) as TransactionReceipt["logs"][number]["topics"],
          data: "0x",
          ...receipt,
          logIndex: 0,
          transactionIndex: 0,
          removed: false,
        },
      ]
    : [];

/**
 * A chain holding the reviewed empty UP pool, whose run's own sends move it as they would a real pool: the swap to
 * its limit, or to `swapTo` where a capped swap stops short.
 */
function realignChain(opts: { mintLogs: boolean; swapTo?: bigint }) {
  const fake = chain({ logs: opts.mintLogs ? mintLogs : undefined });
  fake.setPool(TOKENS.upToken, TOKENS.outcome, REVIEWED.up);
  fake.state.owners.set(DUST_ID, owner);
  let dust = 0n;
  let price = FROM;
  const moveUp = (tx: FlowTx) => {
    const decoded = decode(tx);
    if (isDustMint(tx) && decoded.kind === "multicall" && decoded.inner[0]!.name === "mint") {
      const mint = decoded.inner[0]!;
      dust = liquidityFor(FROM, sqrtA, sqrtB, mint.amount0Desired, mint.amount1Desired);
      fake.setPool(TOKENS.upToken, TOKENS.outcome, {
        status: "live",
        sqrtPriceX96: FROM,
        liquidity: dust,
        tickSpacing: 60,
      });
    } else if (decoded.kind === "swap") {
      price = opts.swapTo ?? decoded.limitSqrtPrice;
      fake.setPool(TOKENS.upToken, TOKENS.outcome, {
        status: "live",
        sqrtPriceX96: price,
        liquidity: dust,
        tickSpacing: 60,
      });
    } else if (isWithdraw(tx)) {
      fake.setPool(TOKENS.upToken, TOKENS.outcome, { status: "empty", sqrtPriceX96: price, tickSpacing: 60 });
    }
  };
  return { fake, moveUp };
}

const input = seedInput({ pools: REVIEWED });

/** A realign run on `realignChain`, where `meanwhile` runs after each of the run's sends has moved the pool. */
function realignRun(opts: { mintLogs: boolean; swapTo?: bigint; meanwhile?: (tx: FlowTx, fake: Chain) => void }) {
  const { fake, moveUp } = realignChain(opts);
  const sends = gateway(fake, owner, {
    onBroadcast: (tx) => {
      moveUp(tx);
      opts.meanwhile?.(tx, fake);
    },
  });
  const { driver } = driverOn({
    world: fake,
    gateway: sends,
    wallet: wallet(fake, owner),
    request: { kind: "seed", input },
  });
  return { driver, sends, fake };
}

const isSwap = (tx: FlowTx) => decode(tx).kind === "swap";
/** The branch's seed: a multicall minting both of its pools. */
const isSeedMint = (tx: FlowTx) => {
  const decoded = decode(tx);
  return decoded.kind === "multicall" && decoded.inner.filter((call) => call.name === "mint").length === 2;
};
/** Someone else's liquidity, far deeper than the dust. */
const OTHERS = 10n ** 21n;

describe("createLiquidityRun realigning an empty pool (L3)", () => {
  it("withdraws the dust position its own mint gave out, and is not stopped by its own move of the pool", async () => {
    const { driver, sends } = realignRun({ mintLogs: true });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"), { timeout: 3_000 });

    expect(sends.prompts).toEqual(txsOf(planSeed(input).steps, () => DUST_ID));
  });

  it("halts before the withdrawal when the dust mint's token id cannot be read", async () => {
    const { driver, sends } = realignRun({ mintLogs: false });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"), { timeout: 3_000 });

    expect(sends.prompts.filter(isWithdraw)).toEqual([]);
    expect(progressOf(driver).failure).toEqual({ reason: "unknown", retryable: false });
  });

  it("withdraws the dust position whose mint was approved after the tab closed", async () => {
    const { fake, moveUp } = realignChain({ mintLogs: true });
    const dustAt = txsOf(planSeed(input).steps).findIndex(isDustMint);
    const first = gateway(fake, owner, {
      script: (index) => (index === dustAt ? "hang" : "sign"),
      onBroadcast: moveUp,
    });
    const tab = driverOn({
      world: fake,
      gateway: first,
      wallet: wallet(fake, owner),
      request: { kind: "seed", input },
    });
    tab.driver.start();
    await first.held();
    const left = copyStorage(tab.storage);
    tab.driver.dispose();
    fake.approveLater(first.hung[0]!, owner);
    moveUp(first.hung[0]!);

    const second = gateway(fake, owner, { onBroadcast: moveUp });
    const { driver } = driverOn({
      world: fake,
      gateway: second,
      wallet: wallet(fake, owner),
      request: { kind: "seed", input },
      storage: left,
    });
    driver.recover();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("review"));
    driver.resume();
    await vi.waitFor(() => expect(["complete", "halted", "moved"]).toContain(progressOf(driver).stage));

    expect(progressOf(driver).stage).toBe("complete");
    const withdrawals = second.prompts.filter(isWithdraw).map(decode);
    expect(
      withdrawals.map(
        (each) => each.kind === "multicall" && each.inner[0]!.name === "decreaseLiquidity" && each.inner[0]!.tokenId,
      ),
    ).toEqual([DUST_ID]);
  });

  it("stops for a new review before the swap when someone added liquidity after the run's dust mint (L10)", async () => {
    const { driver, sends } = realignRun({
      mintLogs: true,
      meanwhile: (tx, fake) => {
        const mint = decode(tx);
        if (!isDustMint(tx) || mint.kind !== "multicall" || mint.inner[0]!.name !== "mint") return;
        const dust = liquidityFor(FROM, sqrtA, sqrtB, mint.inner[0]!.amount0Desired, mint.inner[0]!.amount1Desired);
        fake.setPool(TOKENS.upToken, TOKENS.outcome, {
          status: "live",
          sqrtPriceX96: FROM,
          liquidity: dust + OTHERS,
          tickSpacing: 60,
        });
      },
    });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("moved"), { timeout: 3_000 });

    expect(sends.prompts.filter(isDustMint)).toHaveLength(1);
    expect(sends.prompts.filter(isSwap)).toEqual([]);
    expect(sends.prompts.filter(isWithdraw)).toEqual([]);
  });

  it("stops for a new review before the seed mint when someone seeded the pool after the dust withdrawal (L10)", async () => {
    const target = planSeed(input).branches[0]!.pools.up.sqrtPriceX96;
    const { driver, sends } = realignRun({
      mintLogs: true,
      meanwhile: (tx, fake) => {
        if (!isWithdraw(tx)) return;
        fake.setPool(TOKENS.upToken, TOKENS.outcome, {
          status: "live",
          sqrtPriceX96: target,
          liquidity: OTHERS,
          tickSpacing: 60,
        });
      },
    });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("moved"), { timeout: 3_000 });

    expect(sends.prompts.filter(isWithdraw)).toHaveLength(1);
    expect(sends.prompts.filter(isSeedMint)).toEqual([]);
  });

  it("holds the dust withdrawal to the amounts at the pool's price read at build, with the deadline from chain time then", async () => {
    // a capped swap stopped short of the target
    const swapTo = userSqrtPrice(4_000n, true);
    const later = CHAIN_TIME + 3_600n;
    const { driver, sends } = realignRun({
      mintLogs: true,
      swapTo,
      meanwhile: (tx, fake) => {
        if (isSwap(tx)) fake.state.chainTime = later;
      },
    });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"), { timeout: 3_000 });

    const withdraw = decode(sends.prompts.find(isWithdraw)!);
    const decrease = withdraw.kind === "multicall" ? withdraw.inner[0] : undefined;
    if (decrease?.name !== "decreaseLiquidity") throw new Error("no dust withdrawal");
    const less = (amount: bigint) => (amount * (BPS - BigInt(LIQUIDITY_SLIPPAGE_BPS))) / BPS;
    expect(decrease).toMatchObject({
      amount0Min: less(amount0Delta(swapTo, sqrtB, decrease.liquidity, false)),
      amount1Min: less(amount1Delta(sqrtA, swapTo, decrease.liquidity, false)),
      deadline: later + LIQUIDITY_DEADLINE_SECONDS,
    });
  });

  /** The token id each dust withdrawal sent takes out. */
  const withdrawn = (prompts: FlowTx[]) =>
    prompts
      .filter(isWithdraw)
      .map(decode)
      .map(
        (each) => each.kind === "multicall" && each.inner[0]!.name === "decreaseLiquidity" && each.inner[0]!.tokenId,
      );

  it("withdraws the dust when someone added liquidity after the swap, then stops for a new review before the seed mint (L3, L10)", async () => {
    let dust = 0n;
    let at = FROM;
    const { driver, sends } = realignRun({
      mintLogs: true,
      meanwhile: (tx, fake) => {
        const decoded = decode(tx);
        if (isDustMint(tx) && decoded.kind === "multicall" && decoded.inner[0]!.name === "mint") {
          dust = liquidityFor(FROM, sqrtA, sqrtB, decoded.inner[0]!.amount0Desired, decoded.inner[0]!.amount1Desired);
          return;
        }
        if (decoded.kind === "swap") at = decoded.limitSqrtPrice;
        else if (!isWithdraw(tx)) return;
        fake.setPool(TOKENS.upToken, TOKENS.outcome, {
          status: "live",
          sqrtPriceX96: at,
          liquidity: OTHERS + (decoded.kind === "swap" ? dust : 0n),
          tickSpacing: 60,
        });
      },
    });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("moved"), { timeout: 3_000 });

    expect(withdrawn(sends.prompts)).toEqual([DUST_ID]);
    expect(sends.prompts.filter(isSeedMint)).toEqual([]);
  });

  it("withdraws the dust when the session closed after the swap, then halts as closed before the seed mint (L3, L7)", async () => {
    const { driver, sends } = realignRun({
      mintLogs: true,
      meanwhile: (tx, fake) => {
        if (isSwap(tx)) fake.state.chainTime = CLOSES_AT;
      },
    });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"), { timeout: 3_000 });

    expect(progressOf(driver).failure?.reason).toBe("closed");
    expect(withdrawn(sends.prompts)).toEqual([DUST_ID]);
    expect(sends.prompts.filter(isSeedMint)).toEqual([]);
  });

  /** A realign run where, once the dust mint is broadcast, the pool reads as `after` with the dust's liquidity. */
  function afterDustMint(after: (dust: bigint) => PoolState) {
    return realignRun({
      mintLogs: true,
      meanwhile: (tx, fake) => {
        const mint = decode(tx);
        if (!isDustMint(tx) || mint.kind !== "multicall" || mint.inner[0]!.name !== "mint") return;
        const dust = liquidityFor(FROM, sqrtA, sqrtB, mint.inner[0]!.amount0Desired, mint.inner[0]!.amount1Desired);
        fake.setPool(TOKENS.upToken, TOKENS.outcome, after(dust));
      },
    });
  }

  it("stops for a new review before the swap when someone moved the price, not the liquidity, after the dust mint (L10)", async () => {
    // between the pool's price and the target, where a capped swap of the run's own could stop
    const { driver, sends } = afterDustMint((dust) => ({
      status: "live",
      sqrtPriceX96: userSqrtPrice(4_000n, true),
      liquidity: dust,
      tickSpacing: 60,
    }));

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("moved"), { timeout: 3_000 });

    expect(sends.prompts.filter(isSwap)).toEqual([]);
  });

  it("stops for a new review before the swap when the pool reads another tick spacing after the dust mint (L10)", async () => {
    const { driver, sends } = afterDustMint((dust) => ({
      status: "live",
      sqrtPriceX96: FROM,
      liquidity: dust,
      tickSpacing: 10,
    }));

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("moved"), { timeout: 3_000 });

    expect(sends.prompts.filter(isSwap)).toEqual([]);
  });

  it("stops before the dust withdrawal when its pool cannot be read", async () => {
    const { driver, sends } = realignRun({
      mintLogs: true,
      meanwhile: (tx, fake) => {
        if (isSwap(tx)) fake.setPool(TOKENS.upToken, TOKENS.outcome, { status: "missing" });
      },
    });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("moved"), { timeout: 3_000 });

    expect(sends.prompts.filter(isWithdraw)).toEqual([]);
  });
});
