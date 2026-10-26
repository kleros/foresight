import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { describe, expect, it, vi } from "vitest";

import { gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

import { createPredictHooks, depositMintPatch, planPredict, STEP_ID } from "../plan";
import type { PredictCtx, PredictSnapshot } from "../types";
import { addresses, ctx, fakeQuoter, fakeReader, landedTx, mintLog, snapshot } from "./support/fakes";

const other: Address = "0x00000000000000000000000000000000000000ee";
const split = (
  collateral = addresses.collateral,
  parent = addresses.parentMarket,
  name: "splitPosition" | "mergePositions" = "splitPosition",
) => encodeFunctionData({ abi: gnosisRouterAbi, functionName: name, args: [collateral, parent, 10n] });
const batch = (calls: { to: Address; data: Hex }[]) =>
  encodeFunctionData({ abi: tradeExecutorAbi, functionName: "batchExecute", args: [calls] });
const native = (parent = addresses.parentMarket) =>
  encodeFunctionData({ abi: gnosisRouterAbi, functionName: "splitFromBase", args: [parent] });
const credit = {
  to: addresses.manager,
  data: encodeFunctionData({
    abi: parseAbi(["function execute(address,bytes,uint256,address)"]),
    functionName: "execute",
    args: [addresses.swapRouter, "0x", 7n, addresses.wxdai],
  }),
};
async function witnessed(
  input: Hex,
  to = addresses.executor,
  snap: PredictSnapshot = snapshot({ collateralIn: 10n }),
  context: PredictCtx = ctx(),
) {
  const reader = fakeReader({ landed: [landedTx({ to, data: input })] });
  const step = planPredict(snap, { reader, quoter: fakeQuoter() }).find((each) => each.id === STEP_ID.predict(1))!;
  return step.canSkip!(context, snap);
}

describe("first-batch recovery witnesses", () => {
  it.each([
    ["another executor", batch([{ to: addresses.router, data: split() }]), other],
    ["malformed batch", "0xdeadbeef", addresses.executor],
    ["another router", batch([{ to: other, data: split() }]), addresses.executor],
    [
      "merge instead of split",
      batch([{ to: addresses.router, data: split(addresses.collateral, addresses.parentMarket, "mergePositions") }]),
      addresses.executor,
    ],
    ["another collateral", batch([{ to: addresses.router, data: split(other) }]), addresses.executor],
    ["malformed router call", batch([{ to: addresses.router, data: "0xdeadbeef" }]), addresses.executor],
  ] satisfies [string, Hex, Address][])("does not adopt %s as the collateral split", async (_, input, to) => {
    await expect(witnessed(input, to)).resolves.toBe(false);
  });

  it("adopts a matching collateral split without a credits route", async () => {
    await expect(
      witnessed(
        batch([{ to: addresses.router, data: split() }]),
        addresses.executor,
        snapshot({ collateralIn: 10n }),
        ctx({ credits: null }),
      ),
    ).resolves.toBe(true);
  });

  it.each([
    ["another parent", native(other)],
    [
      "another function",
      encodeFunctionData({
        abi: gnosisRouterAbi,
        functionName: "splitPosition",
        args: [addresses.parentMarket, addresses.parentMarket, 7n],
      }),
    ],
    ["malformed native split", "0xdeadbeef"],
  ] satisfies [string, Hex][])("does not adopt credits with %s", async (_, data) => {
    await expect(
      witnessed(
        batch([credit, { to: addresses.router, data }]),
        addresses.executor,
        snapshot({ collateralIn: 0n, creditsToSpend: 7n }),
      ),
    ).resolves.toBe(false);
  });

  it("cannot witness credits when their manager is unavailable", async () => {
    await expect(
      witnessed(
        batch([credit, { to: addresses.router, data: native() }]),
        addresses.executor,
        snapshot({ collateralIn: 0n, creditsToSpend: 7n }),
        ctx({ credits: null }),
      ),
    ).resolves.toBe(false);
  });

  it("binds recovery reads to the owner, executor and pinned block", async () => {
    const snap = snapshot({ fromBlock: 4321n });
    const reader = fakeReader();
    reader.landedSince = vi.fn().mockResolvedValue([]);
    const step = planPredict(snap, { reader, quoter: fakeQuoter() }).find((each) => each.id === STEP_ID.deposit)!;
    await expect(step.canSkip!(ctx(), snap)).resolves.toBe(false);
    expect(reader.landedSince).toHaveBeenCalledExactlyOnceWith({
      owner: addresses.owner,
      executor: addresses.executor,
      fromBlock: 4321n,
    });
  });
});

describe("native deposit accounting", () => {
  const snap = snapshot({
    depositNative: true,
    deposit: 10n,
    collateralIn: 13n,
    collateralBefore: 3n,
    collateralAtStart: 3n,
  });
  it("adds the retained collateral to the witnessed mint", async () => {
    const data = encodeFunctionData({
      abi: parseAbi(["function depositXDAI(address) payable"]),
      functionName: "depositXDAI",
      args: [addresses.executor],
    });
    const reader = fakeReader({
      landed: [{ ...landedTx({ to: addresses.sDaiAdapter, data, value: 10n }), collateralReceived: 10n }],
    });
    await expect(depositMintPatch({ reader }, ctx(), snap)).resolves.toEqual({
      collateralIn: 13n,
      mintFinalized: true,
    });
  });
  it("refuses to finalize a deposit absent from the chain", async () => {
    await expect(depositMintPatch({ reader: fakeReader() }, ctx(), snap)).rejects.toThrow(
      "The deposit's transaction was not found on chain.",
    );
  });
  it("counts only collateral transfers into this executor", async () => {
    const incoming = mintLog(10n);
    const logs = [
      incoming,
      { ...incoming, address: other },
      {
        ...incoming,
        topics: encodeEventTopics({
          abi: erc20Abi,
          eventName: "Transfer",
          args: { from: addresses.sDaiAdapter, to: other },
        }),
      },
      {
        ...incoming,
        topics: encodeEventTopics({
          abi: erc20Abi,
          eventName: "Approval",
          args: { owner: addresses.owner, spender: addresses.executor },
        }),
        data: encodeAbiParameters([{ type: "uint256" }], [99n]),
      },
    ];
    // Only logs are consumed by this hook; the gateway owns the receipt envelope.
    const receipt = { logs } as unknown as TransactionReceipt;
    const result = await createPredictHooks({ reader: fakeReader() }).afterStep!({
      ctx: ctx(),
      snapshot: snap,
      completed: {
        stepId: STEP_ID.deposit,
        label: "Deposit",
        outcome: { status: "confirmed", hash: "0x1", blockNumber: 1n },
      },
      receipt,
      pending: [],
    });
    expect(result).toEqual({ snapshotPatch: { collateralIn: 13n, mintFinalized: true } });
  });
});

it("adopts a matching credits-only batch without a collateral split", async () => {
  await expect(
    witnessed(
      batch([credit, { to: addresses.router, data: native() }]),
      addresses.executor,
      snapshot({ collateralIn: 0n, creditsToSpend: 7n }),
    ),
  ).resolves.toBe(true);
});

it("does not adopt the executor's owner read as a landed batch", async () => {
  const data = encodeFunctionData({ abi: tradeExecutorAbi, functionName: "owner" });
  await expect(witnessed(data)).resolves.toBe(false);
});
