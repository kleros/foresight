import { useSyncExternalStore } from "react";

import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decodeFunctionData, erc20Abi, type Hash, type TransactionReceipt } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addresses,
  chainState,
  ctx,
  fakeCreditsQuoter,
  fakeReader,
  gasLimitFor,
  option,
  poolQuoter,
  snapshot,
  WAD,
} from "@/features/predict/flow/__tests__/support/fakes";
import { previewCreditsSwap } from "@/features/predict/flow/plan";
import type { CreditsSwapPreview, PredictSlippage } from "@/features/predict/flow/types";
import { createPredictRun } from "@/features/predict/run/driver";
import type { PredictDriver } from "@/features/predict/run/types";
import { useSlippageStore } from "@/features/predict/stores/slippageStore";
import { creditLines, creditsOffer } from "@/features/predict/utils/credits";
import { fundingRequest, planFunding, shownAmount, type Funding } from "@/features/predict/utils/funding";
import { previewTrades } from "@/features/predict/utils/plan";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { creditsManagerAbi, gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

import { PredictRunner } from "@/app/market/[parentMarket]/_components/PredictRunner";
import { toPredictOptions } from "@/app/market/[parentMarket]/_components/toPredictOptions";

vi.hoisted(() => vi.stubEnv("NEXT_PUBLIC_ENABLE_LOCAL_CHAIN", "false"));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: addresses.owner, chainId: 100 }) }));
vi.mock("@/features/trade-executor/api/getExecutor", () => ({
  useExecutor: () => ({ data: { predicted: addresses.executor, deployed: true } }),
}));
vi.mock("@/app/market/[parentMarket]/_components/useHasPredicted", () => ({ useHasPredicted: () => false }));

let driver: PredictDriver;
let latestFunding: Funding;
let latestSlippage: PredictSlippage;
let eoaCredits: bigint;
let walletCredits: bigint;
let deposit: bigint;
let nominal: bigint;
let minted: bigint;
let firstLanded: boolean;
let tradeCollateral: bigint;
let swaps: CreditsSwapPreview;
let quoteReady = true;
let lossBps = 1_000n;
let native = false;
const OPTIONS = [option(1), option(2)];
const STATE = chainState();

vi.mock("@/app/market/[parentMarket]/_components/usePredictFunding", () => ({
  usePredictFunding: ({ amount }: { amount: bigint }) => {
    const held = { wallet: eoaCredits, tradeWallet: walletCredits, manager: 1000n * WAD };
    latestFunding = planFunding({
      amount,
      ownWallet: deposit,
      tradeWallet: tradeCollateral,
      ...(native ? { tokenPerCollateralWad: (WAD * 5n) / 4n } : {}),
      credits: creditLines(held, creditsOffer(held)),
    });
    return {
      funding: latestFunding,
      credits: creditsOffer(held),
      token: native ? "native" : "collateral",
      available: () => latestFunding.available,
      canPayNative: native,
    };
  },
}));
vi.mock("@/app/market/[parentMarket]/_components/useCreditsSwapPreview", () => ({
  useCreditsSwapPreview: ({ credits }: { credits: bigint }) => ({
    preview: credits > 0n && quoteReady ? swaps : undefined,
    failed: false,
  }),
}));
vi.mock("@/app/market/[parentMarket]/_components/usePricePreview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/market/[parentMarket]/_components/usePricePreview")>()),
  usePricePreview: ({ collateralIn, slippageBps }: { collateralIn: bigint; slippageBps: number }) => {
    const plans = Object.fromEntries(
      OPTIONS.map((o) => [
        o.childMarket.toLowerCase(),
        previewTrades(
          { pools: STATE.pools, held: STATE.held, splitAmount: collateralIn ?? 0n, targetPriceWad: o.targetPriceWad },
          slippageBps,
        )!,
      ]),
    );
    const moves = Object.fromEntries(
      Object.entries(plans).map(([key, p]) => [key, { from: 312, to: 125, plan: { ...p, held: 0n } }]),
    );
    return { plans, moves, held: {}, ready: true, failed: false, failedAgain: false, retrying: false };
  },
}));
vi.mock("@/app/market/[parentMarket]/_components/usePredictExecution", () => ({
  usePredictExecution: (args: { slippage: PredictSlippage }) => {
    latestSlippage = args.slippage;
    return { driver, progress: useSyncExternalStore(driver.subscribe, driver.getProgress), ready: true };
  },
}));

const detail = toSessionDetail(
  {
    ...sessionDetailColumns,
    parentMarket: addresses.parentMarket,
    collateralToken: addresses.collateral,
    children: OPTIONS.map((o, i) =>
      sessionChildRow({
        id: o.childMarket,
        displayName: `Option ${i + 1}`,
        lowerBound: "0",
        upperBound: String(500n * WAD),
        underlyingToken: o.underlying,
        upToken: o.upToken,
        downToken: o.downToken,
        invalidToken: o.invalidToken,
      }),
    ),
  },
  "https://example.test",
);
const selected = detail.options.map((scale) => ({
  scale,
  value: 125,
  marketEstimate: 312,
  direction: "lower" as const,
}));

function mount() {
  const onSuccess = vi.fn();
  const view = render(
    <PredictRunner session={detail} status="trading" selected={selected} onClose={vi.fn()} onSuccess={onSuccess} />,
  );
  return { ...view, onSuccess };
}

function setup({
  credits = 100n * WAD,
  ownDeposit = 0n,
  revertBatch = 2,
  alreadyHeld = false,
  collateralHeld = 0n,
  lostReceipt = false,
} = {}) {
  eoaCredits = alreadyHeld ? 0n : credits;
  walletCredits = alreadyHeld ? credits : 0n;
  deposit = ownDeposit;
  nominal = credits + ownDeposit + collateralHeld;
  tradeCollateral = collateralHeld;
  firstLanded = false;
  const sent: FlowTx[] = [];
  let batches = 0;
  const receipts = new Map<Hash, TransactionReceipt>();
  const store = createFlowRunStore({ storage: createMemoryStorage() });
  const state = () => chainState({ underlying: firstLanded ? minted : 0n });
  const reader = fakeReader({
    deployed: true,
    collateral: collateralHeld,
    state,
    blockGasLimit: gasLimitFor(1),
    credits: (holder) => (holder === addresses.owner ? eoaCredits : walletCredits),
  });
  const creditsQuoter = fakeCreditsQuoter({ lossBps: () => lossBps });
  const gateway: TxGateway = {
    async sendTransaction(tx) {
      sent.push(tx);
      const hash = `0x${sent.length.toString(16).padStart(64, "0")}` as Hash;
      let status: TransactionReceipt["status"] = "success";
      if (tx.to.toLowerCase() === addresses.credits.toLowerCase()) {
        const [, amount] = decodeFunctionData({ abi: erc20Abi, data: tx.data! }).args!;
        eoaCredits -= amount as bigint;
        walletCredits += amount as bigint;
      }
      if (tx.to === addresses.executor) {
        batches++;
        if (batches === revertBatch) status = "reverted";
        else if (!firstLanded) {
          walletCredits -= credits;
          tradeCollateral = 0n;
          firstLanded = true;
        }
      }
      receipts.set(hash, {
        transactionHash: hash,
        status,
        blockNumber: 2n,
        logs: [],
        blockHash: hash,
        contractAddress: null,
        cumulativeGasUsed: 1n,
        effectiveGasPrice: 1n,
        gasUsed: 1n,
        from: addresses.owner,
        to: tx.to,
        logsBloom: "0x",
        transactionIndex: 0,
        type: "eip1559",
      });
      return hash;
    },
    waitForReceipt: async ({ hash }) => {
      if (lostReceipt && receipts.get(hash)?.status === "reverted") return new Promise(() => {});
      return receipts.get(hash)!;
    },
    getReceipt: async (hash) => receipts.get(hash)!,
    isKnown: async () => true,
  };
  const make = () =>
    createPredictRun({
      gateway,
      reader,
      creditsQuoter,
      quoter: poolQuoter(OPTIONS, state),
      store,
      flowId: "funding-review",
      ctx: () => ctx(),
      snapshot: () =>
        snapshot({
          options: toPredictOptions(detail, selected),
          ...fundingRequest(latestFunding, native),
          slippage: latestSlippage,
        }),
      slippage: () => latestSlippage,
    });
  driver = make();
  return { sent, reader, creditsQuoter, store, make };
}

beforeEach(() => {
  native = false;
  quoteReady = true;
  lossBps = 1_000n;
  useSlippageStore.setState({ settings: { tradeBps: null, creditsBps: null } });
});
afterEach(() => driver?.dispose());

async function begin() {
  await userEvent.type(screen.getByRole("spinbutton"), (nominal / WAD).toString());
  await userEvent.click(screen.getByRole("button", { name: "Predict" }));
  await waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
  expect(driver.getProgress().failure?.reason).toBe("reverted");
}

function parentBase(tx: FlowTx): bigint {
  if (tx.to !== addresses.executor) return 0n;
  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
  if (decoded.functionName !== "batchValueExecute") return 0n;
  return decoded.args[0].find((call) => call.data.startsWith("0x50d9991c"))?.value ?? 0n;
}

describe("UI truth after a partial credits-funded run", () => {
  it("keeps the original credits amount and quote historical when retry pauses at changed trades", async () => {
    const { sent, reader, creditsQuoter } = setup();
    swaps = await previewCreditsSwap(ctx(), nominal, 20, { reader, creditsQuoter });
    minted = swaps.minted;
    expect(minted).toBe(89_811_018n * 10n ** 12n);
    mount();
    await begin();
    expect(driver.getProgress().batchesDone).toBe(1);
    expect(parentBase(sent.find((tx) => tx.to === addresses.executor)!)).toBe(swaps.floor);
    expect(screen.queryByTestId("trade-mint")).toBeNull();
    expect(screen.getByTestId("credits-swap")).toHaveTextContent("Credits swapped100 credits");

    act(() => useSlippageStore.getState().setSlippage("tradeBps", 1_000));
    await userEvent.click(screen.getByRole("button", { name: "Try the rest" }));
    await waitFor(() => expect(driver.getProgress().stage).toBe("moved"));
    expect(driver.getProgress().moved?.bySlippage).toBe(true);
    expect(screen.queryByTestId("trade-mint")).toBeNull();
    expect(screen.getByTestId("credits-swap")).toHaveTextContent("Credits swapped100 credits");
    const sentBefore = sent.length;
    await userEvent.click(screen.getByRole("button", { name: "Confirm trades" }));
    await waitFor(() => expect(driver.getProgress().stage).toBe("idle"));
    expect(sent).toHaveLength(sentBefore + 1);
    expect(parentBase(sent.at(-1)!)).toBe(0n);
  });
});

describe("reviewed amount on Resume", () => {
  it("shows the saved credit spend and pending mint before Resume", async () => {
    const { sent, reader, creditsQuoter, make } = setup({ alreadyHeld: true, revertBatch: 1 });
    swaps = await previewCreditsSwap(ctx(), nominal, 20, { reader, creditsQuoter });
    minted = swaps.minted;
    const first = mount();
    await begin();
    expect(driver.getProgress().batchesDone).toBe(0);
    first.unmount();
    driver.dispose();
    driver = make();
    const resumed = mount();
    await waitFor(() => expect(driver.getProgress().stage).toBe("review"));
    expect(driver.getProgress().recovered).toMatchObject({
      deposit: 0n,
      creditsFromEoa: 0n,
      creditsToSpend: 100n * WAD,
    });
    expect(screen.getByRole("spinbutton")).toHaveValue("0");
    expect(screen.getByTestId("recovery-funding")).toHaveTextContent("Credits to spend100 credits");
    expect(screen.getByTestId("credits-swap")).toHaveTextContent("100 credits");
    expect(screen.getByTestId("trade-mint")).toHaveTextContent(shownAmount(minted, 18));
    const before = sent.length;
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(resumed.onSuccess).toHaveBeenCalledOnce());
    expect(parentBase(sent[before]!)).toBe(swaps.floor);
    const batch = decodeFunctionData({ abi: tradeExecutorAbi, data: sent[before]!.data! });
    if (batch.functionName !== "batchValueExecute") throw new Error("Expected a credits batch");
    const spend = batch.args[0].find((call) => call.to.toLowerCase() === addresses.manager.toLowerCase())!;
    const execute = decodeFunctionData({ abi: creditsManagerAbi, data: spend.data });
    if (execute.functionName !== "execute") throw new Error("Expected a credits spend");
    expect(execute.args[2]).toBe(100n * WAD);
    expect(walletCredits).toBe(0n);
    expect(sent.slice(before).filter((tx) => tx.to.toLowerCase() === addresses.credits.toLowerCase())).toHaveLength(0);
  });
});

it("shows reused trade-wallet collateral and the pending split before Resume", async () => {
  const { sent, make } = setup({ credits: 0n, collateralHeld: 100n * WAD, revertBatch: 1 });
  minted = 100n * WAD;
  const first = mount();
  await begin();
  first.unmount();
  driver.dispose();
  driver = make();
  const resumed = mount();
  await waitFor(() => expect(driver.getProgress().stage).toBe("review"));
  expect(driver.getProgress().recovered).toMatchObject({
    deposit: 0n,
    collateralIn: 100n * WAD,
    collateralBefore: 100n * WAD,
  });
  expect(screen.getByRole("spinbutton")).toHaveValue("0");
  expect(screen.getByTestId("trade-mint")).toHaveTextContent("100 sDAI");
  expect(screen.getByTestId("recovery-funding")).toHaveTextContent("Trade-wallet collateral100 sDAI");
  expect(screen.getByTestId("recovery-funding")).toHaveTextContent("New deposit0 sDAI");
  const before = sent.length;
  await userEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(resumed.onSuccess).toHaveBeenCalledOnce());
  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data: sent[before]!.data! });
  expect(decoded.functionName).toBe("batchExecute");
  if (decoded.functionName !== "batchExecute") throw new Error("Expected a collateral batch");
  const splits = decoded.args[0]
    .filter((call) => call.to.toLowerCase() === addresses.router.toLowerCase())
    .map((call) => decodeFunctionData({ abi: gnosisRouterAbi, data: call.data }))
    .filter((call) => call.functionName === "splitPosition" && call.args[1].toLowerCase() === addresses.parentMarket);
  expect(splits).toHaveLength(1);
  expect(splits[0]!.args[2]).toBe(100n * WAD);
});

it("waits for a recovered credits quote and shows its pending mint after a cold-cache read", async () => {
  const { reader, creditsQuoter, make } = setup({ alreadyHeld: true, revertBatch: 1 });
  swaps = await previewCreditsSwap(ctx(), nominal, 20, { reader, creditsQuoter });
  minted = swaps.minted;
  const first = mount();
  await begin();
  first.unmount();
  driver.dispose();
  driver = make();
  quoteReady = false;
  const resumed = mount();
  await waitFor(() => expect(driver.getProgress().stage).toBe("review"));
  expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
  quoteReady = true;
  resumed.rerender(
    <PredictRunner
      session={detail}
      status="trading"
      selected={selected}
      onClose={vi.fn()}
      onSuccess={resumed.onSuccess}
    />,
  );
  expect(screen.getByTestId("credits-swap")).toHaveTextContent("100 credits");
  expect(screen.getByTestId("trade-mint")).toHaveTextContent(shownAmount(minted, 18));
  expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
});

it.each([false, true])(
  "holds a resumed credits spend to the shown mint (revert found on recovery: %s)",
  async (lostReceipt) => {
    const { sent, reader, creditsQuoter, make } = setup({ alreadyHeld: true, revertBatch: 1, lostReceipt });
    swaps = await previewCreditsSwap(ctx(), nominal, 20, { reader, creditsQuoter });
    minted = swaps.minted;
    const first = mount();
    if (lostReceipt) {
      await userEvent.type(screen.getByRole("spinbutton"), (nominal / WAD).toString());
      await userEvent.click(screen.getByRole("button", { name: "Predict" }));
      await waitFor(() => expect(driver.getProgress().stage).toBe("confirming"));
      expect(driver.getProgress().sentHash).toBeDefined();
    } else await begin();
    first.unmount();
    driver.dispose();
    driver = make();
    const resumed = mount();
    await waitFor(() => expect(driver.getProgress().stage).toBe(lostReceipt ? "halted" : "review"));
    expect(screen.getByTestId("trade-mint")).toHaveTextContent(shownAmount(minted, 18));
    const before = sent.length;
    lossBps = 1_500n;
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(driver.getProgress().stage).toBe("moved"));
    expect(sent).toHaveLength(before);
    expect(screen.getByRole("button", { name: "Confirm new prices" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm new prices" }));
    await waitFor(() => expect(resumed.onSuccess).toHaveBeenCalledOnce());
    expect(parentBase(sent[before]!)).toBeLessThan(swaps.floor);
  },
);
