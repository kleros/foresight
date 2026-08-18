import { getAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { readDeployedMarkets } from "../receipts";
import { childAddress, childDeployedLog, FACTORY, minedReceipt, parentDeployedLog, PARENT } from "./support/chainLogs";

/**
 * A phased deploy cannot continue without the session id the parent
 * transaction emitted, and the wizard cannot link a market it did not read
 * back. These are real encoded logs, decoded through the shipped ABI, so a
 * change to the events fails here rather than at deploy time.
 */

describe("readDeployedMarkets", () => {
  it("reads the session id and parent address", () => {
    const found = readDeployedMarkets(minedReceipt([parentDeployedLog({ sessionId: 7n })]), FACTORY);

    expect(found.sessionId).toBe(7n);
    expect(found.parentMarket).toBe(PARENT);
  });

  it("reads children with the outcome index each is bound to", () => {
    const receipt = minedReceipt([
      parentDeployedLog({ sessionId: 0n }),
      childDeployedLog({ sessionId: 0n, outcomeIndex: 0n }),
      childDeployedLog({ sessionId: 0n, outcomeIndex: 1n }),
    ]);

    const found = readDeployedMarkets(receipt, FACTORY);

    expect(found.childMarkets).toEqual([
      { outcomeIndex: 0, address: getAddress(childAddress(10)) },
      { outcomeIndex: 1, address: getAddress(childAddress(11)) },
    ]);
  });

  it("sorts children by outcome index, not by log order", () => {
    const receipt = minedReceipt([
      childDeployedLog({ sessionId: 0n, outcomeIndex: 2n }),
      childDeployedLog({ sessionId: 0n, outcomeIndex: 0n }),
      childDeployedLog({ sessionId: 0n, outcomeIndex: 1n }),
    ]);

    const found = readDeployedMarkets(receipt, FACTORY);

    expect(found.childMarkets.map((c) => c.outcomeIndex)).toEqual([0, 1, 2]);
  });

  it("ignores logs from any other contract in the same transaction", () => {
    const impostor: Address = "0x9999999999999999999999999999999999999999";
    const receipt = minedReceipt([
      parentDeployedLog({ sessionId: 7n, emittedBy: impostor }),
      childDeployedLog({ sessionId: 0n, outcomeIndex: 0n }),
    ]);

    const found = readDeployedMarkets(receipt, FACTORY);

    expect(found.sessionId).toBeUndefined();
    expect(found.childMarkets).toHaveLength(1);
  });

  it("finds nothing in a receipt with no session events", () => {
    expect(readDeployedMarkets(minedReceipt([]), FACTORY)).toEqual({ childMarkets: [] });
  });
});
