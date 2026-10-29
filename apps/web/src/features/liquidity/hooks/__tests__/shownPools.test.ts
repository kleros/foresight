import { describe, expect, it, vi } from "vitest";

import { createChain, owner, Q96, sortPair } from "../../api/__tests__/support/chain";
import { fetchLiquidityPools } from "../../api/getLiquidityPools";
import { fetchLiquidityPositions } from "../../api/getLiquidityPositions";
import { CHAIN_TIME, fullRange } from "../../flow/__tests__/support/session";
import { planRemove } from "../../flow/plan";
import { shownPools } from "../useSessionLiquidity";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const WAD = 10n ** 18n;
const NAMES = ["Movie A", "Movie B"];

/** Branch 0's UP and DOWN pools live; `held` places the wallet's positions, by token id, into them. */
async function shown(held: { tokenId: bigint; pool: "up" | "down"; liquidity: bigint; range?: [number, number] }[]) {
  const chain = createChain(2);
  const [first] = chain.branches as [(typeof chain.branches)[0]];
  chain.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 100n * WAD, tickSpacing: 60 });
  chain.setPool(first.downToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 100n * WAD, tickSpacing: 60 });
  const { tickLower, tickUpper } = fullRange(60);
  for (const each of held) {
    const [token0, token1] = sortPair(each.pool === "up" ? first.upToken : first.downToken, first.outcome);
    const [lower, upper] = each.range ?? [tickLower, tickUpper];
    chain.holdPosition(owner, {
      tokenId: each.tokenId,
      token0,
      token1,
      tickLower: lower,
      tickUpper: upper,
      liquidity: each.liquidity,
    });
  }
  const pools = await fetchLiquidityPools(chain.client, chain.markets);
  const positions = await fetchLiquidityPositions(chain.client, { pools, owner });
  return { positions, rows: shownPools({ pools, positions, owner, chainTime: CHAIN_TIME, names: NAMES }) };
}

const tokenIds = (row: { request: { kind: string; input: unknown } }) =>
  row.request.kind === "remove"
    ? (row.request.input as Parameters<typeof planRemove>[0]).positions.map((each) => each.tokenId)
    : [];

describe("the positions popup's rows", () => {
  it("lists a pool's positions as one row whose Remove withdraws all of them, showing their summed returns", async () => {
    const { positions, rows } = await shown([
      { tokenId: 7n, pool: "up", liquidity: 5n * WAD },
      { tokenId: 8n, pool: "down", liquidity: 5n * WAD },
      { tokenId: 9n, pool: "up", liquidity: WAD },
    ]);
    const up = positions.filter((each) => each.tokenId !== 8n);

    expect(rows.map((row) => [row.pool, row.count, tokenIds(row)])).toEqual([
      ["Movie A UP pool", 2, [7n, 9n]],
      ["Movie A DOWN pool", 1, [8n]],
    ]);
    expect(rows[0]!.returns.map((each) => each.amount)).toEqual([
      up.reduce((sum, each) => sum + each.amount0, 0n),
      up.reduce((sum, each) => sum + each.amount1, 0n),
    ]);
    const request = rows[0]!.request;
    if (request.kind !== "remove") throw new Error("not a remove");
    expect(request.input.sqrtPriceX96).toBe(Q96);
    expect(planRemove(request.input).amount0).toBe(rows[0]!.returns[0]!.amount);
  });

  it("gives a position the remove cannot plan a row of its own, so the rest of its pool still withdraws", async () => {
    // above the pool's tick 0: it holds only token0, too little of token1 for a non-zero minimum
    const { rows } = await shown([
      { tokenId: 7n, pool: "up", liquidity: 5n * WAD },
      { tokenId: 11n, pool: "up", liquidity: WAD, range: [600, 1_200] },
      { tokenId: 9n, pool: "up", liquidity: WAD },
    ]);

    expect(rows.map((row) => [row.pool, tokenIds(row)])).toEqual([
      ["Movie A UP pool", [7n, 9n]],
      ["Movie A UP pool", [11n]],
    ]);
    const request = rows[0]!.request;
    if (request.kind !== "remove") throw new Error("not a remove");
    expect(() => planRemove(request.input)).not.toThrow();
  });
});
