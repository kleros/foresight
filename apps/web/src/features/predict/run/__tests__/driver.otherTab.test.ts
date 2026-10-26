import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot } from "../../flow/__tests__/support/fakes";
import { createPredictRun } from "../driver";
import { predictFlowId } from "../interrupted";
import { createRunOwnership, type RunLocks, type RunOwnership } from "../ownership";
import type { PredictDriver } from "../types";

const FLOW_ID = predictFlowId("session-1", addresses.owner);

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

/** One origin's Web Locks, shared by its tabs: a lock is held until its callback's promise settles. */
function origin() {
  const held = new Set<string>();
  const locks: RunLocks = {
    request: (async (name: string, _options: LockOptions, callback: (lock: Lock | null) => unknown) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name, mode: "exclusive" } as Lock);
      } finally {
        held.delete(name);
      }
    }) as RunLocks["request"],
    query: () => Promise.resolve({ held: [...held].map((name) => ({ name, mode: "exclusive", clientId: "" })) }),
  };
  /** One browser tab of this origin. */
  return { tab: (): RunOwnership => createRunOwnership(locks) };
}

/** A wallet whose prompts stay open when `hold` is set, as a visitor leaves one unanswered, until `decline()`. */
function wallet(hold: boolean) {
  const sends: FlowTx[] = [];
  const open: Array<(error: Error) => void> = [];
  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n, logs: [] }) as unknown as TransactionReceipt;
  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sends.push(tx);
      if (hold) return new Promise<Hash>((_, reject) => open.push(reject));
      return Promise.resolve(`0x${sends.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
  const decline = () => {
    for (const reject of open.splice(0)) reject(Object.assign(new Error("User rejected the request."), { code: 4001 }));
  };
  return { gateway, sends, decline };
}

function driverIn(ownership: RunOwnership, gateway: TxGateway, store: ReturnType<typeof createFlowRunStore>) {
  const driver = createPredictRun({
    gateway,
    reader: fakeReader({ deployed: true }),
    quoter: fakeQuoter(),
    flowId: FLOW_ID,
    ctx: () => ctx(),
    snapshot: () => snapshot(),
    store,
    ownership,
  });
  drivers.push(driver);
  return driver;
}

describe("run ownership across tabs", () => {
  it("tells another tab a claimed run is held, never this one, and lets it go on release", async () => {
    const site = origin();
    const [a, b] = [site.tab(), site.tab()];

    const release = await a.claim(FLOW_ID);
    expect(release).not.toBeNull();
    expect(await b.claim(FLOW_ID)).toBeNull();
    expect(await b.heldElsewhere(FLOW_ID)).toBe(true);
    expect(await a.heldElsewhere(FLOW_ID)).toBe(false);

    release!();
    await vi.waitFor(async () => expect(await b.heldElsewhere(FLOW_ID)).toBe(false));
  });
});

describe("createPredictRun with the run live in another tab", () => {
  it("neither resumes nor discards it, and signs nothing until that tab lets go", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const site = origin();
    const [ownA, ownB] = [site.tab(), site.tab()];
    const walletA = wallet(true);
    const walletB = wallet(false);

    const a = driverIn(ownA, walletA.gateway, store);
    a.start();
    await vi.waitFor(() => expect(a.getProgress().stage).toBe("signing"));

    const b = driverIn(ownB, walletB.gateway, store);
    b.recover();
    await vi.waitFor(() => expect(b.getProgress().failure?.reason).toBe("elsewhere"));
    b.retry();
    b.reset();
    b.start();
    await vi.waitFor(() => expect(b.getProgress().failure?.reason).toBe("elsewhere"));

    expect(walletB.sends).toEqual([]);
    expect(store.load(FLOW_ID)).not.toBeNull();
    expect(a.getProgress().stage).toBe("signing");

    // the tab lets go once the prompt it left open is answered
    a.dispose();
    walletA.decline();
    await vi.waitFor(async () => expect(await ownB.heldElsewhere(FLOW_ID)).toBe(false));
    b.reset();
    b.start();
    await vi.waitFor(() => expect(b.getProgress().recovered).toBeDefined());
    expect(b.getProgress().failure?.reason).not.toBe("elsewhere");
  });

  it("holds the run while a wallet prompt it opened stays open after the popup is disposed", async () => {
    const site = origin();
    let answer: ((hash: Hash) => void) | undefined;
    const gateway: TxGateway = {
      ...wallet(false).gateway,
      sendTransaction: () => new Promise<Hash>((resolve) => (answer = resolve)),
    };
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const driver = driverIn(site.tab(), gateway, store);
    driver.start();
    await vi.waitFor(() => expect(answer).toBeDefined());

    driver.dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const other = site.tab();
    expect(await other.heldElsewhere(FLOW_ID)).toBe(true);

    answer!(`0x${"1".padStart(64, "0")}`);
    await vi.waitFor(async () => expect(await other.heldElsewhere(FLOW_ID)).toBe(false));
  });
});

describe("createPredictRun reopened in the tab whose closed popup left a wallet prompt open", () => {
  it("says the prompt is still open here, not that another tab runs it, and recovers once it is answered", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const tab = origin().tab();
    const walletA = wallet(true);
    const closed = driverIn(tab, walletA.gateway, store);
    closed.start();
    await vi.waitFor(() => expect(closed.getProgress().stage).toBe("signing"));
    closed.dispose();

    const reopened = driverIn(tab, wallet(false).gateway, store);
    reopened.recover();
    await vi.waitFor(() => expect(reopened.getProgress().failure?.reason).toBe("prompt-open"));

    walletA.decline();
    await vi.waitFor(() => expect(tab.heldHere(FLOW_ID)).toBe(false));
    reopened.retry();
    await vi.waitFor(() => expect(reopened.getProgress().recovered).toBeDefined());
  });
});

describe("createPredictRun whose recover is run, disposed and run again, as React's StrictMode does", () => {
  it("recovers the stored run rather than report it held in another tab", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    // a run left by an earlier popup, its deposit not yet signed
    const earlier = driverIn(origin().tab(), wallet(true).gateway, store);
    earlier.start();
    await vi.waitFor(() => expect(earlier.getProgress().stage).toBe("signing"));
    earlier.dispose();

    const driver = driverIn(origin().tab(), wallet(false).gateway, store);
    driver.recover();
    driver.dispose();
    driver.recover();

    await vi.waitFor(() => expect(driver.getProgress().recovered).toBeDefined());
    expect(driver.getProgress().failure?.reason).not.toBe("elsewhere");
  });
});
