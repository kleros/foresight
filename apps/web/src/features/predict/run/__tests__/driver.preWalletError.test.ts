import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import {
  ConnectorAccountNotFoundError,
  ConnectorNotConnectedError,
  ConnectorUnavailableReconnectingError,
} from "@wagmi/core";
import {
  ChainDisconnectedError,
  ChainMismatchError,
  ProviderDisconnectedError,
  TransactionExecutionError,
  UnauthorizedProviderError,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { gnosis } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot } from "../../flow/__tests__/support/fakes";
import type { SentTx } from "../../flow/types";
import { createPredictRun } from "../driver";
import { discardRun, hasPendingTransaction, predictFlowId } from "../interrupted";
import type { PredictDriver, PredictFailureReason } from "../types";

const SESSION = "session-1";
const FLOW_ID = predictFlowId(SESSION, addresses.owner);
const connector = { name: "Injected" } as never;

/** viem's sendTransaction throws it with no account, and does not export its class. */
const accountNotFound = () =>
  Object.assign(new Error("Could not find an Account to execute with this Action."), { name: "AccountNotFoundError" });

/** As viem's sendTransaction wraps what it throws before the wallet is asked. */
const executing = (cause: Error) => new TransactionExecutionError(cause as never, { account: null, chain: gnosis });

const PRE_WALLET: Array<[string, () => Error, PredictFailureReason]> = [
  ["ChainMismatchError", () => executing(new ChainMismatchError({ chain: gnosis, currentChainId: 1 })), "wrong-chain"],
  ["AccountNotFoundError", () => executing(accountNotFound()), "wrong-wallet"],
  ["ConnectorNotConnectedError", () => new ConnectorNotConnectedError(), "wrong-wallet"],
  [
    "ConnectorAccountNotFoundError",
    () => new ConnectorAccountNotFoundError({ address: addresses.owner, connector }),
    "wrong-wallet",
  ],
  [
    "ConnectorUnavailableReconnectingError",
    () => new ConnectorUnavailableReconnectingError({ connector }),
    "wrong-wallet",
  ],
  ["EIP-1193 4100", () => executing(new UnauthorizedProviderError(new Error("unauthorized"))), "wrong-wallet"],
  ["EIP-1193 4900", () => executing(new ProviderDisconnectedError(new Error("disconnected"))), "wrong-wallet"],
  ["EIP-1193 4901", () => executing(new ChainDisconnectedError(new Error("chain disconnected"))), "wrong-chain"],
];

const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral;

/** A chain that mines each send at once, whose first deposit the client refuses before the wallet sees it. */
function chain(error: () => Error) {
  const mined: Array<{ hash: Hash; tx: FlowTx }> = [];
  const sends: FlowTx[] = [];
  let refused = false;

  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 2n, logs: [] }) as unknown as TransactionReceipt;

  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sends.push(tx);
      if (isDeposit(tx) && !refused) {
        refused = true;
        return Promise.reject(error());
      }
      const hash = `0x${(mined.length + 1).toString(16).padStart(64, "0")}` as Hash;
      mined.push({ hash, tx });
      return Promise.resolve(hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };

  const sentWithNonce = ({ nonce }: { nonce: number }): Promise<SentTx> => {
    const sent = mined[nonce];
    if (!sent) return Promise.resolve({ status: "none" });
    const { to, value = 0n, data = "0x" } = sent.tx;
    return Promise.resolve({ status: "mined", hash: sent.hash, to, value, input: data, success: true });
  };

  return {
    gateway,
    deposits: () => sends.filter(isDeposit).length,
    reader: {
      ...fakeReader({ deployed: true }),
      nextNonce: () => Promise.resolve(mined.length),
      sentWithNonce,
    },
  };
}

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

describe("createPredictRun when the client refuses a send before the wallet is asked", () => {
  it.each(PRE_WALLET)("%s holds nothing, says why, and the next press signs", async (_name, error, reason) => {
    const fake = chain(error);
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const driver = createPredictRun({
      gateway: fake.gateway,
      reader: fake.reader,
      quoter: fakeQuoter(),
      flowId: FLOW_ID,
      ctx: () => ctx(),
      snapshot: () => snapshot(),
      store,
      unansweredSend: { waitMs: 20, pollMs: 5 },
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(driver.getProgress().failure).toEqual({ reason, retryable: true });
    expect(driver.getProgress().unanswered).toBeUndefined();
    expect(driver.getProgress().moneyMoved).toBeUndefined();
    expect(hasPendingTransaction(store, SESSION, addresses.owner)).toBe(false);

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(fake.deposits()).toBe(2);
  });

  it("lets Close and the card's Discard drop the run it stopped", async () => {
    const fake = chain(() => new ConnectorNotConnectedError());
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const driver = createPredictRun({
      gateway: fake.gateway,
      reader: fake.reader,
      quoter: fakeQuoter(),
      flowId: FLOW_ID,
      ctx: () => ctx(),
      snapshot: () => snapshot(),
      store,
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    discardRun(store, SESSION, addresses.owner);
    expect(store.load(FLOW_ID)).toBeNull();
  });
});
