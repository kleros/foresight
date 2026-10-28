import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeEventTopics, parseAbi, zeroAddress, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOKENS, empty, seedInput } from "./support/requests";
import {
  chain,
  copyStorage,
  disposeDrivers,
  driverOn,
  gateway,
  progressOf,
  wallet,
  type LogsOf,
} from "./support/world";
import { LIST, decode, fullRange, liquidityFor, owner, txsOf } from "../../flow/__tests__/support/session";
import { planSeed } from "../../flow/plan";
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

/** A chain holding the reviewed empty UP pool, whose run's own sends move it as they would a real pool. */
function realignChain(opts: { mintLogs: boolean }) {
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
      price = decoded.limitSqrtPrice;
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

function realignRun(opts: { mintLogs: boolean }) {
  const { fake, moveUp } = realignChain(opts);
  const sends = gateway(fake, owner, { onBroadcast: moveUp });
  const { driver } = driverOn({
    world: fake,
    gateway: sends,
    wallet: wallet(fake, owner),
    request: { kind: "seed", input },
  });
  return { driver, sends };
}

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
});
