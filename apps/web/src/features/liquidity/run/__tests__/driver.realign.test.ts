import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeEventTopics, parseAbi, zeroAddress, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOKENS, empty, live, seedInput } from "./support/requests";
import { chain, disposeDrivers, driverOn, gateway, progressOf, wallet } from "./support/world";
import { LIST, decode, owner, txsOf } from "../../flow/__tests__/support/session";
import { planSeed } from "../../flow/plan";

afterEach(disposeDrivers);

const DUST_ID = 4_242n;
const TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);

/** The realign's dust mint: a multicall holding one mint and nothing else. */
const isDustMint = (tx: FlowTx) => {
  const decoded = decode(tx);
  return decoded.kind === "multicall" && decoded.inner.length === 1 && decoded.inner[0]!.name === "mint";
};

/** A seed of an empty UP pool, on a chain whose dust mint gives out `DUST_ID` and moves the pool as a real one would. */
function realignRun(opts: { mintLogs: boolean }) {
  const pools = { up: empty(3_000n, true), down: { status: "missing" as const } };
  const input = seedInput({ pools });
  const fake = chain();
  fake.setPool(TOKENS.upToken, TOKENS.outcome, pools.up);
  fake.state.owners.set(DUST_ID, owner);
  const sends = gateway(fake, owner, {
    onBroadcast: (tx) => {
      if (isDustMint(tx)) fake.setPool(TOKENS.upToken, TOKENS.outcome, live(3_000n, true));
    },
  });
  const port = sends.port;
  const mintLog = (receipt: TransactionReceipt): TransactionReceipt["logs"][number] => ({
    address: LIST.positionManager,
    topics: encodeEventTopics({
      abi: TRANSFER,
      eventName: "Transfer",
      args: { from: zeroAddress, to: owner, tokenId: DUST_ID },
    }) as TransactionReceipt["logs"][number]["topics"],
    data: "0x",
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber,
    logIndex: 0,
    transactionHash: receipt.transactionHash,
    transactionIndex: 0,
    removed: false,
  });
  const waitForReceipt = port.waitForReceipt;
  port.waitForReceipt = async (request) => {
    const receipt = await waitForReceipt(request);
    const tx = fake.find(receipt.transactionHash)?.tx;
    return opts.mintLogs && tx && isDustMint(tx) ? { ...receipt, logs: [mintLog(receipt)] } : receipt;
  };
  const { driver } = driverOn({
    world: fake,
    gateway: sends,
    wallet: wallet(fake, owner),
    request: { kind: "seed", input },
  });
  return { driver, sends, input };
}

describe("createLiquidityRun realigning an empty pool (L3)", () => {
  it("withdraws the dust position its own mint gave out, and is not stopped by its own move of the pool", async () => {
    const { driver, sends, input } = realignRun({ mintLogs: true });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"), { timeout: 3_000 });

    expect(sends.prompts).toEqual(txsOf(planSeed(input).steps, () => DUST_ID));
  });

  it("halts before the withdrawal when the dust mint's token id cannot be read", async () => {
    const { driver, sends } = realignRun({ mintLogs: false });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"), { timeout: 3_000 });

    const withdrawals = sends.prompts.filter((tx) => {
      const decoded = decode(tx);
      return decoded.kind === "multicall" && decoded.inner.some((call) => call.name === "decreaseLiquidity");
    });
    expect(withdrawals).toEqual([]);
    expect(progressOf(driver).failure).toEqual({ reason: "unknown", retryable: false });
  });
});
