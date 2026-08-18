import {
  createFlowRunStore,
  createMemoryStorage,
  type FlowRunStore,
  type FlowTx,
  type TxGateway,
} from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { describe, expect, it, vi } from "vitest";

import type { MetadataUploader } from "@/lib/atlas/types";

import {
  childAddress,
  childDeployedLog,
  DEPLOYER,
  FACTORY,
  minedReceipt,
  PARENT,
  parentDeployedLog,
} from "../../flow/__tests__/support/chainLogs";
import { deployInput, metadataInput, NOW_MS } from "../../flow/__tests__/support/deployFixtures";
import { fakeIpfs } from "../../flow/__tests__/support/ipfs";
import { CHILD_BATCH_SIZE } from "../../flow/params";
import { STEP_ID } from "../../flow/plan";
import type { SessionDeployCtx, SessionLookup } from "../../flow/types";
import { createOrchestratedDeploy, type DeploySources } from "../orchestratedDriver";
import { IndexerNotReadyError } from "../sessionLookup";

const ctx: SessionDeployCtx = { chainId: 31337, factory: FACTORY, deployer: DEPLOYER };

const PHASED = CHILD_BATCH_SIZE + 1;

const FLOW_ID = "session-create-test";

const hashOf = (index: number): Hash => `0x${index.toString(16).padStart(64, "0")}`;

/** Confirms the nth transaction with the nth receipt, then mines nothing more. */
function gatewayConfirming(receipts: TransactionReceipt[]) {
  const sent: FlowTx[] = [];
  const stillMining = new Promise<never>(() => {});

  const gateway: TxGateway = {
    async sendTransaction(tx) {
      sent.push(tx);
      return hashOf(sent.length);
    },
    waitForReceipt: ({ hash }) => {
      const receipt = receipts[Number(BigInt(hash)) - 1];
      // Past the script, the transaction is out there and never answers.
      return receipt ? Promise.resolve(receipt) : stillMining;
    },
    async getReceipt() {
      return null;
    },
    async isKnown() {
      return true;
    },
  };

  return { gateway, sent };
}

/** Sends, then never answers: a tab that dies with a transaction in flight. */
function gatewayHolding() {
  const held = new Promise<never>(() => {});
  const sent: FlowTx[] = [];

  const gateway: TxGateway = {
    async sendTransaction(tx) {
      sent.push(tx);
      return hashOf(sent.length);
    },
    waitForReceipt: () => held,
    async getReceipt() {
      return null;
    },
    async isKnown() {
      return true;
    },
  };

  return { gateway, sent };
}

function sources(): DeploySources {
  return {
    deploy: deployInput(PHASED),
    metadata: metadataInput(PHASED),
    images: { hero: "/ipfs/QmHero" },
  };
}

function deployDriver(overrides: {
  gateway: TxGateway;
  uploader?: MetadataUploader;
  store?: FlowRunStore;
  findSession?: SessionLookup;
}) {
  return createOrchestratedDeploy({
    gateway: overrides.gateway,
    uploader: overrides.uploader ?? fakeIpfs().uploader,
    ctx: () => ctx,
    flowId: FLOW_ID,
    outcomeCount: PHASED,
    sources,
    store: overrides.store,
    findSession: overrides.findSession,
    now: () => NOW_MS,
  });
}

describe("The orchestrated deploy, when a run stops", () => {
  it("reports a parent receipt with no session id", async () => {
    // Confirmed, but carrying no ParentMarketDeployed log for the factory.
    const { gateway, sent } = gatewayConfirming([minedReceipt([])]);
    const driver = deployDriver({ gateway });

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(driver.getProgress().failure?.message).toMatch(/session id/i);
    // Parent only: the batch is never signed.
    expect(sent).toHaveLength(1);
  });

  it("marks a fatal failure not retryable", async () => {
    const { gateway } = gatewayConfirming([minedReceipt([])]);
    const driver = deployDriver({ gateway });

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(driver.getProgress().failure?.retryable).toBe(false);
  });

  it("reports a draft that went stale before signing", async () => {
    const { gateway, sent } = gatewayConfirming([]);
    const afterTradingClosed = (sources().deploy.parent.openingTime + 1) * 1000;
    const driver = createOrchestratedDeploy({
      gateway,
      uploader: fakeIpfs().uploader,
      ctx: () => ctx,
      flowId: FLOW_ID,
      outcomeCount: PHASED,
      sources,
      now: () => afterTradingClosed,
    });

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().failure).toBeDefined());

    expect(driver.getProgress().failure?.message).toMatch(/already closed/i);
    expect(sent).toHaveLength(0);
  });

  it("pauses on an indexer that is behind, rather than failing", async () => {
    const { gateway } = gatewayConfirming([minedReceipt([parentDeployedLog({ sessionId: 7n })])]);
    const findSession: SessionLookup = async () => {
      throw new IndexerNotReadyError("The indexer is 20 blocks behind the chain.");
    };
    const driver = createOrchestratedDeploy({
      gateway,
      uploader: fakeIpfs().uploader,
      ctx: () => ctx,
      flowId: FLOW_ID,
      outcomeCount: PHASED,
      sources,
      now: () => NOW_MS,
      findSession,
    });

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().failure).toBeDefined());

    expect(driver.getProgress().failure).toMatchObject({
      message: "The indexer is 20 blocks behind the chain.",
      retryable: true,
    });
  });

  it("looks for its own session from the chain's clock, not this browser's", async () => {
    // `since` is matched against block timestamps, not the browser's clock.
    const chainSeconds = Math.floor(NOW_MS / 1000) - 600;
    const asked: number[] = [];
    const { gateway } = gatewayConfirming([minedReceipt([parentDeployedLog({ sessionId: 7n })])]);
    const driver = createOrchestratedDeploy({
      gateway,
      uploader: fakeIpfs().uploader,
      ctx: () => ctx,
      flowId: FLOW_ID,
      outcomeCount: PHASED,
      sources,
      now: () => NOW_MS,
      chainTime: () => Promise.resolve(chainSeconds),
      findSession: async ({ since }) => {
        asked.push(since);
        return null;
      },
    });

    driver.start();
    await vi.waitFor(() => expect(asked).not.toHaveLength(0));

    expect(asked[0]).toBe(chainSeconds);
  });

  it("reports a draft that cannot be read", async () => {
    const { gateway, sent } = gatewayConfirming([]);
    const driver = createOrchestratedDeploy({
      gateway,
      uploader: fakeIpfs().uploader,
      ctx: () => ctx,
      flowId: FLOW_ID,
      outcomeCount: PHASED,
      sources: () => {
        throw new Error("Pick a hero image before deploying.");
      },
      now: () => NOW_MS,
    });

    driver.start();

    await vi.waitFor(() => expect(driver.getProgress().failure).toBeDefined());
    expect(driver.getProgress().failure).toMatchObject({
      message: "Pick a hero image before deploying.",
      retryable: true,
    });
    expect(sent).toHaveLength(0);
  });

  it("refuses a deploy it has no wallet for, before anything is uploaded", async () => {
    const { gateway, sent } = gatewayConfirming([]);
    const ipfs = fakeIpfs();
    const driver = createOrchestratedDeploy({
      gateway,
      uploader: ipfs.uploader,
      ctx: () => {
        throw new Error("Connect the wallet you want to deploy from.");
      },
      flowId: FLOW_ID,
      outcomeCount: PHASED,
      sources,
      now: () => NOW_MS,
    });

    driver.start();

    await vi.waitFor(() => expect(driver.getProgress().failure).toBeDefined());
    expect(driver.getProgress().failure).toMatchObject({
      message: "Connect the wallet you want to deploy from.",
      retryable: true,
    });
    // Nothing on IPFS to pay for or point at, and nothing signed.
    expect(ipfs.stored.size).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("marks the decision market as the thing that failed", async () => {
    const gateway: TxGateway = {
      ...gatewayConfirming([]).gateway,
      sendTransaction: () => Promise.reject(new Error("User rejected the request.")),
    };
    const driver = deployDriver({ gateway });

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(driver.getProgress().parent.state).toBe("error");
  });

  it("reports an upload failure as retryable", async () => {
    const { gateway, sent } = gatewayConfirming([]);
    const uploader: MetadataUploader = {
      ...fakeIpfs().uploader,
      async uploadJson() {
        throw new Error("Atlas rejected the upload.");
      },
    };
    const driver = deployDriver({ gateway, uploader });

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().failure).toBeDefined());

    expect(driver.getProgress().failure).toMatchObject({
      message: "Atlas rejected the upload.",
      retryable: true,
    });
    expect(sent).toHaveLength(0);
  });

  it("ignores a second deploy while the first is under way", async () => {
    const { gateway, sent } = gatewayConfirming([]);
    const working = fakeIpfs().uploader;
    let uploads = 0;
    const uploader: MetadataUploader = {
      ...working,
      async uploadJson(name, value) {
        uploads += 1;
        return working.uploadJson(name, value);
      },
    };
    const driver = deployDriver({ gateway, uploader });

    driver.start();
    driver.start();

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    // A second document would be a second metadata uri, and a second session.
    expect(uploads).toBe(1);
  });

  it("uploads again when a failed upload is retried", async () => {
    const { gateway, sent } = gatewayConfirming([]);
    const working = fakeIpfs().uploader;
    let attempts = 0;
    const uploader: MetadataUploader = {
      ...working,
      async uploadJson(name, value) {
        attempts += 1;
        if (attempts === 1) throw new Error("Atlas rejected the upload.");
        return working.uploadJson(name, value);
      },
    };
    const driver = deployDriver({ gateway, uploader });
    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().failure).toBeDefined());

    driver.retry();

    // Past the upload this time, and asking for the parent signature.
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });
});

/** A second `openPhasedSession` mints a second session id, so it is not idempotent. */
describe("The orchestrated deploy, recovering a stored run", () => {
  it("offers a stored run back", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
    const first = gatewayConfirming([
      minedReceipt([parentDeployedLog({ sessionId: 7n })]),
      minedReceipt(
        Array.from({ length: CHILD_BATCH_SIZE }, (_, i) =>
          childDeployedLog({ sessionId: 7n, outcomeIndex: BigInt(i) }),
        ),
      ),
    ]);
    const before = deployDriver({ gateway: first.gateway, store });

    // Parent, first batch, then the last batch out there unmined.
    before.start();
    await vi.waitFor(() => expect(first.sent).toHaveLength(3));
    before.dispose();

    const second = gatewayConfirming([]);
    const after = deployDriver({ gateway: second.gateway, store });
    after.recover();

    await vi.waitFor(() => expect(after.getProgress().resume).toBeDefined());
    expect(after.getProgress().resume?.stepId).toBe(STEP_ID.batch(2));
    // Settled before the reload, so not signed again.
    expect(second.sent).toHaveLength(0);
  });

  it("signs each batch in turn without being asked", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
    const lastOutcome = BigInt(PHASED - 1);
    const { gateway, sent } = gatewayConfirming([
      minedReceipt([parentDeployedLog({ sessionId: 7n })]),
      minedReceipt(
        Array.from({ length: CHILD_BATCH_SIZE }, (_, i) =>
          childDeployedLog({ sessionId: 7n, outcomeIndex: BigInt(i) }),
        ),
      ),
      minedReceipt([childDeployedLog({ sessionId: 7n, outcomeIndex: lastOutcome })]),
    ]);
    const driver = deployDriver({ gateway, store });

    driver.start();

    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    // The parent and both batches, with nothing in between to click.
    expect(sent).toHaveLength(3);
    expect(driver.getProgress().children.every((child) => child.state === "success")).toBe(true);
  });

  it("keeps a transaction per batch, and points every child at the one that created it", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
    const lastOutcome = BigInt(PHASED - 1);
    // `minedReceipt` gives every receipt one hash; each is mined by its own
    // transaction here, which is the whole point of the assertion.
    const mined = (hash: Hash, logs: Parameters<typeof minedReceipt>[0]) => ({
      ...minedReceipt(logs),
      transactionHash: hash,
    });
    const { gateway } = gatewayConfirming([
      mined(hashOf(1), [parentDeployedLog({ sessionId: 7n })]),
      mined(
        hashOf(2),
        Array.from({ length: CHILD_BATCH_SIZE }, (_, i) =>
          childDeployedLog({ sessionId: 7n, outcomeIndex: BigInt(i) }),
        ),
      ),
      mined(hashOf(3), [childDeployedLog({ sessionId: 7n, outcomeIndex: lastOutcome })]),
    ]);
    const driver = deployDriver({ gateway, store });

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    const progress = driver.getProgress();
    expect(progress.parent.hash).toBe(hashOf(1));
    expect(progress.batchSteps.map((batch) => batch.hash)).toEqual([hashOf(2), hashOf(3)]);
    expect(progress.children.map((child) => child.hash)).toEqual([
      ...Array.from({ length: CHILD_BATCH_SIZE }, () => hashOf(2)),
      hashOf(3),
    ]);
    // The document is on IPFS, and so is what it points at.
    expect(progress.images).toEqual({ hero: "/ipfs/QmHero" });
  });

  it("reports canSelfCheck false when the tab died awaiting a signature", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
    // Never resolves: the entry stays `awaiting-signature`.
    const held = new Promise<never>(() => {});
    const gateway: TxGateway = { ...gatewayConfirming([]).gateway, sendTransaction: () => held };
    const before = deployDriver({ gateway, store });

    before.start();
    await vi.waitFor(() => expect(before.getProgress().stage).toBe("signing"));

    const after = deployDriver({ gateway: gatewayConfirming([]).gateway, store });
    after.recover();

    await vi.waitFor(() => expect(after.getProgress().resume).toBeDefined());
    const resume = after.getProgress().resume;
    expect(resume?.outcome).toBe("unknown");
    // No hash to reconcile, and no lookup on this driver, so no skip test.
    expect(resume?.canSelfCheck).toBe(false);
  });

  /** Leaves a run in storage with its parent transaction still in flight. */
  async function interruptedRun(store: FlowRunStore) {
    const driver = deployDriver({ gateway: gatewayHolding().gateway, store });
    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("confirming"));
    driver.dispose();
  }

  it("refuses a stored run whose plan can no longer be built", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
    await interruptedRun(store);

    // Back the next day: the decision the stored run was planned for has closed.
    const afterTradingClosed = (sources().deploy.parent.openingTime + 1) * 1000;
    const tooLate = createOrchestratedDeploy({
      gateway: gatewayConfirming([]).gateway,
      uploader: fakeIpfs().uploader,
      ctx: () => ctx,
      flowId: FLOW_ID,
      outcomeCount: PHASED,
      sources,
      store,
      now: () => afterTradingClosed,
    });

    tooLate.recover();

    await vi.waitFor(() => expect(tooLate.getProgress().failure).toBeDefined());
    expect(tooLate.getProgress().failure).toMatchObject({ message: /already closed/, retryable: false });
    expect(tooLate.getProgress().resume).toBeUndefined();
  });

  it("frees the next deploy once a run it could not re-plan is discarded", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
    await interruptedRun(store);

    const afterTradingClosed = (sources().deploy.parent.openingTime + 1) * 1000;
    const tooLate = createOrchestratedDeploy({
      gateway: gatewayConfirming([]).gateway,
      uploader: fakeIpfs().uploader,
      ctx: () => ctx,
      flowId: FLOW_ID,
      outcomeCount: PHASED,
      sources,
      store,
      now: () => afterTradingClosed,
    });
    tooLate.recover();
    await vi.waitFor(() => expect(tooLate.getProgress().failure).toBeDefined());

    tooLate.reset();

    // The dates fixed, on a screen that has forgotten the old run.
    const next = gatewayConfirming([]);
    const again = deployDriver({ gateway: next.gateway, store });
    again.start();
    await vi.waitFor(() => expect(next.sent).toHaveLength(1));
  });

  it("reports a chain it could not reach instead of offering the run back", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
    await interruptedRun(store);

    const offline: TxGateway = {
      ...gatewayConfirming([]).gateway,
      async getReceipt() {
        throw new Error("The RPC did not answer.");
      },
    };
    const driver = deployDriver({ gateway: offline, store });

    driver.recover();

    await vi.waitFor(() => expect(driver.getProgress().failure).toBeDefined());
    expect(driver.getProgress().failure).toMatchObject({ message: "The RPC did not answer.", retryable: true });
    // Nothing may be offered to continue: what is on chain is still unknown.
    expect(driver.getProgress().resume).toBeUndefined();
  });

  it("offers the run back when the chain answers on a second attempt", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
    await interruptedRun(store);

    let asked = 0;
    const flaky: TxGateway = {
      ...gatewayConfirming([]).gateway,
      async getReceipt() {
        asked += 1;
        if (asked === 1) throw new Error("The RPC did not answer.");
        return null;
      },
      async isKnown() {
        return false;
      },
    };
    const driver = deployDriver({ gateway: flaky, store });
    driver.recover();
    await vi.waitFor(() => expect(driver.getProgress().failure).toBeDefined());

    driver.retry();

    await vi.waitFor(() => expect(driver.getProgress().resume).toBeDefined());
    expect(driver.getProgress().resume).toMatchObject({ stepId: STEP_ID.parent, outcome: "dropped" });
    expect(driver.getProgress().failure).toBeUndefined();
  });

  it("does not offer back a run it let go of mid-check", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
    await interruptedRun(store);

    let answer: ((receipt: TransactionReceipt | null) => void) | undefined;
    const slow: TxGateway = {
      ...gatewayConfirming([]).gateway,
      getReceipt: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    };
    const driver = deployDriver({ gateway: slow, store });
    driver.recover();
    await vi.waitFor(() => expect(answer).toBeDefined());

    driver.dispose();
    answer?.(null);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(driver.getProgress().resume).toBeUndefined();
  });

  it("stops driving when it is let go of", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
    let mineParent: (receipt: TransactionReceipt) => void = () => {};
    const parentMined = new Promise<TransactionReceipt>((resolve) => {
      mineParent = resolve;
    });

    const sent: FlowTx[] = [];
    const gateway: TxGateway = {
      ...gatewayHolding().gateway,
      async sendTransaction(tx) {
        sent.push(tx);
        return hashOf(sent.length);
      },
      waitForReceipt: () => parentMined,
    };
    const driver = deployDriver({ gateway, store });
    driver.start();
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    driver.dispose();
    mineParent(minedReceipt([parentDeployedLog({ sessionId: 7n })]));

    // Two turns is more than the loop needs to reach the first batch.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toHaveLength(1);
  });

  /**
   * A tab that closed over the wallet leaves no hash to ask the chain about, so
   * the indexer is the only thing that can say what landed anyway.
   */
  describe("with an indexer that saw what the tab missed", () => {
    const OPENED_BY = `0x${"e1".repeat(32)}`;
    const FIRST_BATCH_BY = `0x${"e2".repeat(32)}`;

    /** Reports the session opened, and `children` branches created by one batch. */
    const indexerHolding = (children: number): SessionLookup => {
      return async () => ({
        sessionId: 7n,
        parentMarket: PARENT,
        transactionHash: OPENED_BY,
        childMarkets: Array.from({ length: children }, (_, index) => ({
          outcomeIndex: index,
          address: childAddress(index + 10),
          transactionHash: FIRST_BATCH_BY,
        })),
      });
    };

    /**
     * Leaves a run in storage with the wallet still open over its parent
     * transaction. Nothing is on chain while that tab is alive, so its own
     * lookup finds nothing; what lands does so after it is gone.
     */
    async function tabClosedOverTheWallet(store: FlowRunStore) {
      const held = new Promise<never>(() => {});
      const gateway: TxGateway = { ...gatewayConfirming([]).gateway, sendTransaction: () => held };
      const driver = deployDriver({ gateway, store, findSession: async () => null });
      driver.start();
      await vi.waitFor(() => expect(driver.getProgress().stage).toBe("signing"));
      driver.dispose();
    }

    it("marks the decision market created, with the transaction that opened it", async () => {
      const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
      await tabClosedOverTheWallet(store);

      const driver = deployDriver({
        gateway: gatewayConfirming([]).gateway,
        store,
        findSession: indexerHolding(0),
      });
      driver.recover();

      await vi.waitFor(() => expect(driver.getProgress().parent.state).toBe("success"));
      expect(driver.getProgress().parent.hash).toBe(OPENED_BY);
    });

    it("points the recovered run at the transaction it could not ask the chain about", async () => {
      const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
      await tabClosedOverTheWallet(store);

      const driver = deployDriver({
        gateway: gatewayConfirming([]).gateway,
        store,
        findSession: indexerHolding(0),
      });
      driver.recover();

      await vi.waitFor(() => expect(driver.getProgress().resume?.hash).toBeDefined());
      expect(driver.getProgress().resume).toMatchObject({ outcome: "unknown", hash: OPENED_BY });
    });

    /** Leaves a run in storage with the wallet open over its first batch. */
    async function tabClosedOverTheBatchWallet(store: FlowRunStore) {
      const held = new Promise<never>(() => {});
      let sends = 0;
      const confirming = gatewayConfirming([minedReceipt([parentDeployedLog({ sessionId: 7n })])]);
      const gateway: TxGateway = {
        ...confirming.gateway,
        sendTransaction: (tx) => (++sends > 1 ? held : confirming.gateway.sendTransaction(tx)),
      };
      const driver = deployDriver({ gateway, store, findSession: async () => null });
      driver.start();
      await vi.waitFor(() => expect(driver.getProgress().batchSteps[0]?.state).toBe("running"));
      driver.dispose();
    }

    it("points a recovered batch at the transaction the indexer saw create its branches", async () => {
      const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
      await tabClosedOverTheBatchWallet(store);

      const driver = deployDriver({
        gateway: gatewayConfirming([]).gateway,
        store,
        findSession: indexerHolding(CHILD_BATCH_SIZE),
      });
      driver.recover();

      await vi.waitFor(() => expect(driver.getProgress().resume?.hash).toBeDefined());
      expect(driver.getProgress().resume).toMatchObject({
        stepId: STEP_ID.batch(1),
        outcome: "unknown",
        hash: FIRST_BATCH_BY,
      });
    });

    it("leaves a recovered batch the indexer has not seen without a transaction", async () => {
      const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
      await tabClosedOverTheBatchWallet(store);

      // The session is open; its branches are not there yet.
      const driver = deployDriver({
        gateway: gatewayConfirming([]).gateway,
        store,
        findSession: indexerHolding(0),
      });
      driver.recover();

      await vi.waitFor(() => expect(driver.getProgress().resume).toBeDefined());
      expect(driver.getProgress().resume?.hash).toBeUndefined();
    });

    it("marks the branches of a batch that landed, and leaves the rest missing", async () => {
      const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
      await tabClosedOverTheWallet(store);

      const driver = deployDriver({
        gateway: gatewayConfirming([]).gateway,
        store,
        findSession: indexerHolding(CHILD_BATCH_SIZE),
      });
      driver.recover();

      await vi.waitFor(() => expect(driver.getProgress().children[0]?.state).toBe("success"));
      const progress = driver.getProgress();
      expect(progress.children.map((child) => child.state)).toEqual([
        ...Array.from({ length: CHILD_BATCH_SIZE }, () => "success"),
        // `PHASED` is one branch past a full batch.
        "pending",
      ]);
      expect(progress.batchSteps.map((batch) => batch.state)).toEqual(["success", "pending"]);
      expect(progress.batchSteps[0]?.hash).toBe(FIRST_BATCH_BY);
      // The batch to sign next, rather than the first one again.
      expect(progress.batch).toBe(2);
    });

    it("leaves the run as the chain left it when the indexer will not answer", async () => {
      const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
      await tabClosedOverTheWallet(store);

      const driver = deployDriver({
        gateway: gatewayConfirming([]).gateway,
        store,
        findSession: async () => {
          throw new IndexerNotReadyError("The indexer is 20 blocks behind the chain.");
        },
      });
      driver.recover();

      await vi.waitFor(() => expect(driver.getProgress().resume).toBeDefined());
      expect(driver.getProgress().parent.state).toBe("pending");
      // The run is still offered back: continuing is what the skip tests are for.
      expect(driver.getProgress().failure).toBeUndefined();
    });
  });

  it("offers nothing when storage is empty", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage(), now: () => NOW_MS });
    const gateway = gatewayConfirming([]).gateway;
    const driver = deployDriver({ gateway, store });

    driver.recover();

    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("idle"));
    expect(driver.getProgress().resume).toBeUndefined();
  });
});
