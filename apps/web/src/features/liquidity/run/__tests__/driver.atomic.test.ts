import { createMemoryStorage } from "@foresight/tx-orchestrator";
import { hexToBigInt, isAddressEqual } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mergeInput, mergeRequest, mergeTxs, seedInput, seedRequest, seedTxs } from "./support/requests";
import {
  callOf,
  chain,
  copyStorage,
  disposeDrivers,
  driverOn,
  gateway,
  progressOf,
  rawStorage,
  settled,
  wallet,
  type AtomicStatus,
  type LiquidityRequestLike,
  type SendCallsRequest,
} from "./support/world";
import { owner } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

/** A wallet call as the sequential path would hand it over: target, calldata, native value. */
const asSent = (call: SendCallsRequest["calls"][number]) => ({
  to: call.to.toLowerCase(),
  data: call.data ?? "0x",
  value: call.value === undefined ? 0n : hexToBigInt(call.value),
});

const complete = (driver: Parameters<typeof progressOf>[0]) =>
  vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"), { timeout: 3_000 });

/** What the sequential path sends for `request`, from a wallet that reports no atomic batching. */
async function sequentialCalls(request: LiquidityRequestLike) {
  const fake = chain();
  const sends = gateway(fake, owner);
  const { driver } = driverOn({
    world: fake,
    gateway: sends,
    wallet: wallet(fake, owner),
    request,
    flowId: "sequential",
  });
  driver.start();
  await complete(driver);
  return sends.prompts.map(callOf);
}

const requests: Array<[string, LiquidityRequestLike, number]> = [
  ["a seed", seedRequest(), seedTxs(seedInput()).length],
  ["a merge", mergeRequest(), mergeTxs(mergeInput()).length],
];

describe("createLiquidityRun with a wallet that batches atomically on Gnosis (L9)", () => {
  it.each<AtomicStatus>(["supported", "ready"])(
    "sends the whole seed as one wallet_sendCalls with atomicRequired when atomic is %s",
    async (atomic) => {
      const fake = chain();
      const sends = gateway(fake, owner);
      const batch = wallet(fake, owner, { atomic });
      const { driver } = driverOn({ world: fake, gateway: sends, wallet: batch, request: seedRequest() });

      driver.start();
      await complete(driver);

      expect(batch.sendCalls).toHaveLength(1);
      expect(batch.sendCalls[0]!.atomicRequired).toBe(true);
      expect(batch.sendCalls[0]!.chainId.toLowerCase()).toBe("0x64");
      expect(isAddressEqual(batch.sendCalls[0]!.from!, owner)).toBe(true);
      expect(sends.prompts).toEqual([]);
    },
  );

  it.each(requests)("batches exactly the calls the sequential path sends for %s", async (_, request, count) => {
    const sequential = await sequentialCalls(request);
    const fake = chain();
    const batch = wallet(fake, owner, { atomic: "supported" });
    const { driver } = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: batch, request });

    driver.start();
    await complete(driver);

    expect(sequential).toHaveLength(count);
    expect(batch.sendCalls[0]!.calls.map(asSent)).toEqual(sequential);
  });

  it("stores the batch's id with the run before the wallet is asked to send it", async () => {
    const fake = chain();
    let storedAtRequest: string | undefined;
    const storage = createMemoryStorage();
    const batch = wallet(fake, owner, {
      atomic: "supported",
      onSendCalls: () => (storedAtRequest = rawStorage(storage)),
    });
    const tab = driverOn({
      world: fake,
      gateway: gateway(fake, owner),
      wallet: batch,
      request: seedRequest(),
      storage,
    });

    tab.driver.start();
    await batch.sent();

    const id = batch.sendCalls[0]!.id;
    expect(typeof id).toBe("string");
    expect(id!.length).toBeGreaterThan(0);
    expect(storedAtRequest).toContain(id);
  });

  it.each(["pending", "unknown"] as const)(
    "never sends a batch again after a reload when the wallet reports its status as %s",
    async (status) => {
      const fake = chain();
      const firstWallet = wallet(fake, owner, { atomic: "supported", sendCalls: "hang" });
      const tab = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: firstWallet, request: seedRequest() });
      tab.driver.start();
      await firstWallet.sent();
      const left = copyStorage(tab.storage);
      tab.driver.dispose();

      const sends = gateway(fake, owner);
      const secondWallet = wallet(fake, owner, { atomic: "supported", status });
      const { driver } = driverOn({
        world: fake,
        gateway: sends,
        wallet: secondWallet,
        request: seedRequest(),
        storage: left,
      });
      driver.recover();
      await settled(driver);
      driver.resume();
      await new Promise((resolve) => setTimeout(resolve, 30));
      driver.retry();
      driver.start();
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(secondWallet.sendCalls).toEqual([]);
      expect(sends.prompts).toEqual([]);
      expect(progressOf(driver).stage).not.toBe("complete");
    },
  );

  it("completes a reloaded run whose batch the wallet reports confirmed, without sending it again", async () => {
    const fake = chain();
    const firstWallet = wallet(fake, owner, { atomic: "supported", status: "pending" });
    const tab = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: firstWallet, request: seedRequest() });
    tab.driver.start();
    await firstWallet.sent();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const left = copyStorage(tab.storage);
    tab.driver.dispose();
    fake.land();

    const sends = gateway(fake, owner);
    // the batch landed while no tab watched; this wallet reports it confirmed under the id it was sent with
    const secondWallet = wallet(fake, owner, { atomic: "supported", status: "confirmed" });
    const { driver } = driverOn({
      world: fake,
      gateway: sends,
      wallet: secondWallet,
      request: seedRequest(),
      storage: left,
    });
    driver.recover();
    await settled(driver);
    if (progressOf(driver).stage === "review") driver.resume();
    await complete(driver);

    expect(secondWallet.sendCalls).toEqual([]);
    expect(sends.prompts).toEqual([]);
  });
});

describe("createLiquidityRun with a wallet that does not batch atomically on Gnosis", () => {
  const fallbacks: Array<[string, Parameters<typeof wallet>[2]]> = [
    ["reports atomic unsupported", { atomic: "unsupported" }],
    ["reports no atomic capability", { atomic: "absent" }],
    ["reports atomic only for another chain", { atomic: "supported", capabilityChain: "0x1" }],
    ["does not answer wallet_getCapabilities", { atomic: "supported", capabilitiesThrow: true }],
  ];

  it.each(fallbacks)("signs the seed one transaction at a time when the wallet %s", async (_, opts) => {
    const fake = chain();
    const sends = gateway(fake, owner);
    const batch = wallet(fake, owner, opts);
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: batch, request: seedRequest() });

    driver.start();
    await complete(driver);

    expect(batch.sendCalls).toEqual([]);
    expect(sends.prompts).toEqual(seedTxs(seedInput()));
  });
});
