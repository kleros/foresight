import { describe, expect, it } from "vitest";

import { sessionShare, type ParentMove } from "../sharedHoldings";

/** One parent token sessions 7 and 8 share; the same moves as the indexer's replayHoldings tests. */
const TOKEN = "0xe000000000000000000000000000000000000000";
const sessionsOf = new Map([[TOKEN, ["8", "7"]]]);

const move = (transactionHash: string, blockNumber: bigint, logIndex: number, amount: bigint): ParentMove => ({
  transactionHash,
  token: TOKEN,
  amount,
  blockNumber,
  logIndex,
});
const predicted = (entries: [string, string[]][]) => new Map(entries.map(([tx, own]) => [tx, new Set(own)]));

/** Each session's part of `balance` and of each deposit. */
function shares(
  moves: ParentMove[],
  predictedIn: Map<string, Set<string>>,
  balance: bigint,
  deposits: [string, bigint][] = [],
) {
  return Object.fromEntries(
    ["7", "8"].map((session) => {
      const { splits, parent } = sessionShare(
        session,
        { sessionsOf, predictedIn, moves },
        {
          deposits: deposits.map(([transactionHash, amount]) => ({ transactionHash, amount })),
          balances: new Map([[TOKEN, balance]]),
        },
        [TOKEN],
      );
      return [session, { held: parent[0], splits: splits.map(({ amount }) => amount) }];
    }),
  );
}

describe("sessionShare", () => {
  it("replays the moves in block and log order, whatever order the rows come in", () => {
    const trade = move("0xb1", 2n, 0, 300n);
    const later = move("0xb2", 3n, 9, 100n);
    const merge = move("0xc1", 3n, 4, -300n);
    const predictedIn = predicted([
      ["0xb1", ["7"]],
      ["0xb2", ["8"]],
    ]);

    expect(
      shares([trade, later, merge], predictedIn, 100n, [
        ["0xb1", 300n],
        ["0xc1", -300n],
        ["0xb2", 100n],
      ]),
    ).toEqual({
      7: { held: 0n, splits: [300n, -300n, 0n] },
      8: { held: 100n, splits: [0n, 0n, 100n] },
    });
  });

  it("splits a transaction predicting in both sessions evenly, and other moves pro rata", () => {
    const moves = [move("0xb1", 2n, 0, 301n), move("0xb2", 3n, 0, 100n), move("0xe1", 4n, 0, -201n)];
    const predictedIn = predicted([
      ["0xb1", ["8", "7"]],
      ["0xb2", ["7"]],
    ]);

    // 150/151, then 250/151; 201 out pro rata takes 125/76, and the deposit it carried goes the same way
    expect(
      shares([...moves, move("0xe2", 5n, 0, 30n)], predictedIn, 230n, [
        ["0xb1", 301n],
        ["0xe1", -201n],
      ]),
    ).toEqual({
      7: { held: 143n, splits: [150n, -125n] },
      8: { held: 87n, splits: [151n, -76n] },
    });
  });

  it("files a balance no session holds on net under the lowest session it predicted in", () => {
    const moves = [move("0xe0", 1n, 0, 500n), move("0xb1", 2n, 0, -100n)];

    expect(shares(moves, predicted([["0xb1", ["8"]]]), 400n)).toEqual({
      7: { held: 0n, splits: [] },
      8: { held: 400n, splits: [] },
    });
  });
});
