import { describe, it } from "vitest";

import { replayHoldings } from "../../src/utils/redeem";

const SESSIONS = ["7", "8"];
const move = (transactionHash: string, blockNumber: bigint, logIndex: number, amount: bigint) => ({
  transactionHash,
  blockNumber,
  logIndex,
  amount,
});
const predicted = (entries: [string, string[]][]) => new Map(entries.map(([tx, own]) => [tx, new Set(own)]));

describe("replayHoldings", () => {
  it("replays the moves in block and log order, whatever order the rows come in", (t) => {
    const trade = move("0xb1", 2n, 0, 300n);
    const later = move("0xb2", 3n, 9, 100n);
    const merge = move("0xc1", 3n, 4, -300n);

    const held = replayHoldings(
      [trade, later, merge],
      predicted([
        ["0xb1", ["7"]],
        ["0xb2", ["8"]],
      ]),
      SESSIONS,
    );

    t.expect(Object.fromEntries(held)).toEqual({ 7: 0n, 8: 100n });
  });

  it("splits a transaction predicting in both sessions evenly, and other moves pro rata", (t) => {
    const held = replayHoldings(
      [move("0xb1", 2n, 0, 301n), move("0xb2", 3n, 0, 100n), move("0xe1", 4n, 0, -201n), move("0xe2", 5n, 0, 30n)],
      predicted([
        ["0xb1", ["8", "7"]],
        ["0xb2", ["7"]],
      ]),
      SESSIONS,
    );

    // 150/151, then 250/151; 201 out pro rata takes 125/76; 30 in pro rata adds 18/12
    t.expect(Object.fromEntries(held)).toEqual({ 7: 143n, 8: 87n });
  });

  it("empties the holders on an outflow beyond what they hold, and leaves a move no session holds unfiled", (t) => {
    const held = replayHoldings(
      [move("0xe0", 1n, 0, 500n), move("0xb1", 2n, 0, 100n), move("0xe1", 3n, 0, -400n)],
      predicted([["0xb1", ["7"]]]),
      SESSIONS,
    );

    t.expect(Object.fromEntries(held)).toEqual({ 7: 0n });
  });
});
