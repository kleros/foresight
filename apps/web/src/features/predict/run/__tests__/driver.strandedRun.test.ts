import {
  createFlowRunStore,
  createMemoryStorage,
  DEFAULT_RUN_TTL_MS,
  type FlowTx,
  type StepSummary,
  type TxGateway,
} from "@foresight/tx-orchestrator";
import type { Address, Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, option, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { PredictCtx, PredictOption, PredictSnapshot, SentTx, UnansweredSend } from "../../flow/types";
import { createPredictRun, SEND_HOLD_MS } from "../driver";
import { discardRun, findInterruptedRun, hasPendingTransaction, predictFlowId, unsettledRun } from "../interrupted";
import type { PredictDriver } from "../types";

const SESSION = "session-7";
const FLOW_ID = predictFlowId(SESSION, addresses.owner);
const ATTACKER = "0x00000000000000000000000000000000000000ad" as Address;
const DEPOSIT_HASH = `0x${"d".repeat(64)}` as Hash;
const REPLACEMENT = `0x${"a".repeat(64)}` as Hash;
const DEPOSIT_TX: FlowTx = { to: addresses.collateral, data: "0x1234", value: 0n };

const clock = { at: 1_700_000_000_000 };

const label = "Add money to your trade wallet";
const depositAs = (outcome: StepSummary["outcome"]): StepSummary[] => [
  { stepId: STEP_ID.createExecutor, label: "Set up your trade wallet", outcome: { status: "skipped" } },
  { stepId: STEP_ID.deposit, label, outcome },
  { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
];

const send = (heldAt = clock.at): UnansweredSend => ({
  owner: addresses.owner,
  nonce: 4,
  fromBlock: 100n,
  tx: DEPOSIT_TX,
  heldAt,
});

/** A run stored under A's key that names another trade wallet than the app, which can never resume. */
function stored(args: {
  steps: StepSummary[];
  sent?: UnansweredSend;
  unanswered?: UnansweredSend;
  savedCtx?: PredictCtx;
  options?: PredictOption[];
}) {
  const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => clock.at, unsettled: unsettledRun });
  store.save<PredictSnapshot, PredictCtx>({
    flowId: FLOW_ID,
    adapterId: "predict-flow",
    status: "paused",
    reason: "rejected",
    ctx: args.savedCtx ?? ctx({ executor: ATTACKER }),
    snapshot: {
      ...snapshot({ deposit: WAD, collateralIn: WAD, collateralBefore: 0n }),
      ...(args.options ? { options: args.options } : {}),
      ...(args.sent ? { sent: { [STEP_ID.deposit]: args.sent } } : {}),
      ...(args.unanswered ? { unanswered: { [STEP_ID.deposit]: args.unanswered } } : {}),
    },
    steps: args.steps,
  });
  return store;
}

const receiptOf = (hash: Hash, status: "success" | "reverted" = "success") =>
  ({ transactionHash: hash, status, blockNumber: 19_000_000n }) as TransactionReceipt;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function recover(
  store: ReturnType<typeof stored>,
  chain: {
    receipts?: Partial<Record<Hash, TransactionReceipt>>;
    known?: boolean;
    sentWithNonce?: () => Promise<SentTx>;
    sessionOptions?: () => PredictOption[];
  },
) {
  const signRequests: FlowTx[] = [];
  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      signRequests.push(tx);
      return Promise.reject(new Error("nothing is signed for a run that cannot resume"));
    },
    waitForReceipt: () => new Promise(() => undefined),
    getReceipt: (hash) => Promise.resolve(chain.receipts?.[hash] ?? null),
    isKnown: () => Promise.resolve(chain.known ?? false),
  };
  const reader = {
    ...fakeReader({ deployed: true, collateral: WAD }),
    ...(chain.sentWithNonce ? { sentWithNonce: chain.sentWithNonce } : {}),
  };
  const driver = createPredictRun({
    gateway,
    reader,
    quoter: fakeQuoter(),
    store,
    flowId: FLOW_ID,
    ctx: () => ctx(),
    snapshot: () => snapshot(),
    now: () => clock.at,
    sessionOptions: chain.sessionOptions,
  });
  drivers.push(driver);
  return { driver, signRequests };
}

async function recovered(driver: PredictDriver) {
  driver.start();
  await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("unknown"));
}

/** Close resets the popup; the card's Discard runs once the popup is gone. */
function closeAndDiscard(driver: PredictDriver, store: ReturnType<typeof stored>) {
  driver.reset();
  discardRun(store, SESSION, addresses.owner);
}

const depositOutcome = (store: ReturnType<typeof stored>) =>
  store.load<PredictSnapshot, PredictCtx>(FLOW_ID)?.steps.find((step) => step.stepId === STEP_ID.deposit)?.outcome;

describe("createPredictRun recovering a run that names other contracts and still holds a send", () => {
  it("lets Close forget a hash no node finds once another transaction took its nonce", async () => {
    const store = stored({ steps: depositAs({ status: "submitted", hash: DEPOSIT_HASH }), sent: send() });
    const { driver, signRequests } = recover(store, { sentWithNonce: () => Promise.resolve({ status: "taken" }) });

    await recovered(driver);
    driver.reset();

    expect(store.load(FLOW_ID)).toBeNull();
    expect(signRequests).toEqual([]);
  });

  it("lets the card's Discard forget a hash no node finds once its nonce stayed unused past the hold", async () => {
    const store = stored({
      steps: depositAs({ status: "submitted", hash: DEPOSIT_HASH }),
      sent: send(clock.at - SEND_HOLD_MS),
    });
    const { driver } = recover(store, {});

    await recovered(driver);
    driver.dispose();
    expect(hasPendingTransaction(store, SESSION, addresses.owner)).toBe(false);
    discardRun(store, SESSION, addresses.owner);

    expect(findInterruptedRun(store, SESSION, addresses.owner)).toBeNull();
  });

  it("keeps a hash no node finds while its nonce reads unused within the hold", async () => {
    const store = stored({ steps: depositAs({ status: "submitted", hash: DEPOSIT_HASH }), sent: send() });
    const { driver } = recover(store, {});

    await recovered(driver);
    closeAndDiscard(driver, store);

    expect(store.load(FLOW_ID)).not.toBeNull();
  });

  it("keeps a hash no node finds while its nonce reads pending", async () => {
    const store = stored({
      steps: depositAs({ status: "submitted", hash: DEPOSIT_HASH }),
      sent: send(clock.at - SEND_HOLD_MS),
    });
    const { driver } = recover(store, { sentWithNonce: () => Promise.resolve({ status: "pending" }) });

    await recovered(driver);
    closeAndDiscard(driver, store);

    expect(store.load(FLOW_ID)).not.toBeNull();
  });

  it("stores the step confirmed under the hash its nonce mined, then lets Close forget the run", async () => {
    const store = stored({ steps: depositAs({ status: "submitted", hash: DEPOSIT_HASH }), sent: send() });
    const { driver } = recover(store, {
      receipts: { [REPLACEMENT]: receiptOf(REPLACEMENT) },
      sentWithNonce: () =>
        Promise.resolve({
          status: "mined",
          hash: REPLACEMENT,
          to: DEPOSIT_TX.to,
          value: 0n,
          input: "0x1234",
          success: true,
        }),
    });

    await recovered(driver);
    expect(depositOutcome(store)).toEqual({ status: "confirmed", hash: REPLACEMENT, blockNumber: 19_000_000n });
    driver.reset();

    expect(store.load(FLOW_ID)).toBeNull();
  });

  it("lets Close forget a held send with no hash once another transaction took its nonce", async () => {
    const store = stored({ steps: depositAs({ status: "pending" }), unanswered: send() });
    const { driver } = recover(store, { sentWithNonce: () => Promise.resolve({ status: "taken" }) });

    await recovered(driver);
    closeAndDiscard(driver, store);

    expect(store.load(FLOW_ID)).toBeNull();
  });

  it("keeps a held send with no hash while its nonce reads unused within the hold", async () => {
    const store = stored({ steps: depositAs({ status: "pending" }), unanswered: send() });
    const { driver } = recover(store, {});

    await recovered(driver);
    closeAndDiscard(driver, store);

    expect(store.load(FLOW_ID)).not.toBeNull();
  });

  it("drops the send kept beside a hash whose receipt reads mined, so the run awaits nothing", async () => {
    const store = stored({
      steps: depositAs({ status: "submitted", hash: DEPOSIT_HASH }),
      sent: send(),
      unanswered: send(),
    });
    const { driver } = recover(store, { receipts: { [DEPOSIT_HASH]: receiptOf(DEPOSIT_HASH) } });

    await recovered(driver);
    driver.dispose();
    expect(hasPendingTransaction(store, SESSION, addresses.owner)).toBe(false);
    discardRun(store, SESSION, addresses.owner);

    expect(store.load(FLOW_ID)).toBeNull();
  });

  it("lets Close forget a hash stored with no send once no node knows it and the record is past the old expiry", async () => {
    const store = stored({ steps: depositAs({ status: "submitted", hash: DEPOSIT_HASH }) });
    clock.at += DEFAULT_RUN_TTL_MS + 1;
    const { driver } = recover(store, {});

    await recovered(driver);
    driver.reset();

    expect(store.load(FLOW_ID)).toBeNull();
  });

  it.each([
    ["a node still knows it", true, DEFAULT_RUN_TTL_MS + 1],
    ["the record is within the old expiry", false, DEFAULT_RUN_TTL_MS - 1],
  ])("keeps a hash stored with no send while %s", async (_, known, age) => {
    const store = stored({ steps: depositAs({ status: "submitted", hash: DEPOSIT_HASH }) });
    clock.at += age;
    const { driver } = recover(store, { known });

    await recovered(driver);
    closeAndDiscard(driver, store);

    expect(store.load(FLOW_ID)).not.toBeNull();
  });
});

describe("createPredictRun recovering a run whose options differ from the session's and still holds a send", () => {
  it("lets Close forget a hash no node finds once another transaction took its nonce", async () => {
    const store = stored({
      steps: depositAs({ status: "submitted", hash: DEPOSIT_HASH }),
      sent: send(),
      savedCtx: ctx(),
      options: [{ ...option(1), downToken: ATTACKER }],
    });
    const { driver } = recover(store, {
      sentWithNonce: () => Promise.resolve({ status: "taken" }),
      sessionOptions: () => [option(1)],
    });

    await recovered(driver);
    driver.reset();

    expect(store.load(FLOW_ID)).toBeNull();
  });
});
