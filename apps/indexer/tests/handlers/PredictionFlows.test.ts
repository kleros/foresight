import { createTestIndexer } from "envio";
import { describe, it } from "vitest";

import {
  BLOCK,
  bought,
  CHILD_MARKET,
  DOWN,
  DOWN_POOL,
  EXECUTOR,
  executorDeployed,
  indexEvents,
  initialized,
  onlyPrediction,
  OTHER_DOWN,
  OTHER_MARKET,
  OTHER_POOL,
  OTHER_UNDERLYING,
  OTHER_UP,
  OWNER,
  poolCreated,
  ROUTER,
  seedMarket,
  swapped,
  transfer,
  UNDERLYING,
  UP,
  UP_POOL,
} from "../support/harness";

// 2^96 is a price of one; each doubling of a sqrt price quarters what the underlying buys
const PAR = 2n ** 96n;
const AFTER = 80000000000000000000000000000n;
const WAD = 10n ** 18n;

const MARKET = { id: CHILD_MARKET, down: DOWN, up: UP, underlying: UNDERLYING, lowerBound: 0n, upperBound: 100n };
const SECOND_MARKET = {
  id: OTHER_MARKET,
  down: OTHER_DOWN,
  up: OTHER_UP,
  underlying: OTHER_UNDERLYING,
  lowerBound: 0n,
  upperBound: 100n,
};

/** Every trade flow the predict planner can emit, told end to end as one transaction each. */
describe("prediction flows", () => {
  it("rebalances by selling one side to fund buying the other", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    await indexer.Position.set({
      id: `${EXECUTOR}-${UP}`,
      executor_id: EXECUTOR,
      token: UP,
      balance: 100n,
      updatedAt: 0n,
    });

    // sell 100 UP at 0.55, buy 100 DOWN at 0.50 with the proceeds
    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, UP_POOL),
      poolCreated(UNDERLYING, DOWN, DOWN_POOL),
      initialized(UP_POOL, PAR),
      initialized(DOWN_POOL, 2n ** 97n),
      transfer(UP, EXECUTOR, UP_POOL, 100n, BLOCK + 2),
      transfer(UNDERLYING, UP_POOL, EXECUTOR, 55n, BLOCK + 2),
      swapped(UP_POOL, EXECUTOR, 2n ** 97n, 120n, BLOCK + 2, bought(-55n, -100n)),
      transfer(UNDERLYING, EXECUTOR, DOWN_POOL, 50n, BLOCK + 2),
      transfer(DOWN, DOWN_POOL, EXECUTOR, 100n, BLOCK + 2),
      swapped(DOWN_POOL, EXECUTOR, 3n * 2n ** 95n, 120n, BLOCK + 2, bought(50n, 100n)),
    ]);

    const row = await onlyPrediction(indexer);
    t.expect([row.upDelta, row.downDelta, row.underlyingDelta]).toEqual([-100n, 100n, 5n]);
    t.expect([row.upBalance, row.downBalance, row.underlyingBalance]).toEqual([0n, 100n, 5n]);
    t.expect(row.upAvgPrice).toBe((55n * WAD) / 100n);
    t.expect(row.downAvgPrice).toBe((50n * WAD) / 100n);
    t.expect(row.impliedPrediction).toBe(55n);
    // the sale pushed UP from one to a quarter; the buy lifted DOWN from a quarter to 4/9
    t.expect([row.upPriceBefore, row.upPriceAfter]).toEqual([WAD, WAD / 4n]);
    t.expect([row.downPriceBefore, row.downPriceAfter]).toEqual([WAD / 4n, (4n * WAD) / 9n]);
  });

  it("banks an under-par arbitrage by buying both sides and merging", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    // 40 UP for 18 plus 40 DOWN for 19 costs 37; merging the pair returns 40
    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, UP_POOL),
      poolCreated(UNDERLYING, DOWN, DOWN_POOL),
      initialized(UP_POOL, PAR),
      initialized(DOWN_POOL, PAR),
      transfer(UNDERLYING, EXECUTOR, UP_POOL, 18n, BLOCK + 2),
      transfer(UP, UP_POOL, EXECUTOR, 40n, BLOCK + 2),
      swapped(UP_POOL, EXECUTOR, AFTER, 120n, BLOCK + 2, bought(18n, 40n)),
      transfer(UNDERLYING, EXECUTOR, DOWN_POOL, 19n, BLOCK + 2),
      transfer(DOWN, DOWN_POOL, EXECUTOR, 40n, BLOCK + 2),
      swapped(DOWN_POOL, EXECUTOR, AFTER, 120n, BLOCK + 2, bought(19n, 40n)),
      transfer(UP, EXECUTOR, ROUTER, 40n, BLOCK + 2),
      transfer(DOWN, EXECUTOR, ROUTER, 40n, BLOCK + 2),
      transfer(UNDERLYING, ROUTER, EXECUTOR, 40n, BLOCK + 2),
    ]);

    const row = await onlyPrediction(indexer);
    t.expect([row.upDelta, row.downDelta, row.underlyingDelta]).toEqual([0n, 0n, 3n]);
    t.expect(row.upAvgPrice).toBe((18n * WAD) / 40n);
    t.expect(row.downAvgPrice).toBe((19n * WAD) / 40n);
    t.expect(row.impliedPrediction).toBe(45n);
  });

  it("keeps a merge without swaps priceless", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    await indexer.Position.set({
      id: `${EXECUTOR}-${UP}`,
      executor_id: EXECUTOR,
      token: UP,
      balance: 40n,
      updatedAt: 0n,
    });
    await indexer.Position.set({
      id: `${EXECUTOR}-${DOWN}`,
      executor_id: EXECUTOR,
      token: DOWN,
      balance: 40n,
      updatedAt: 0n,
    });

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(UP, EXECUTOR, ROUTER, 40n),
      transfer(DOWN, EXECUTOR, ROUTER, 40n),
      transfer(UNDERLYING, ROUTER, EXECUTOR, 40n),
    ]);

    const row = await onlyPrediction(indexer);
    t.expect([row.upDelta, row.downDelta, row.underlyingDelta]).toEqual([-40n, -40n, 40n]);
    t.expect([row.upBalance, row.downBalance, row.underlyingBalance]).toEqual([0n, 0n, 40n]);
    t.expect(row.upAvgPrice).toBeUndefined();
    t.expect(row.downAvgPrice).toBeUndefined();
    t.expect(row.impliedPrediction).toBeUndefined();
  });

  it("keeps a split without swaps priceless", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    await indexer.Position.set({
      id: `${EXECUTOR}-${UNDERLYING}`,
      executor_id: EXECUTOR,
      token: UNDERLYING,
      balance: 40n,
      updatedAt: 0n,
    });

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(UNDERLYING, EXECUTOR, ROUTER, 40n),
      transfer(UP, ROUTER, EXECUTOR, 40n),
      transfer(DOWN, ROUTER, EXECUTOR, 40n),
    ]);

    const row = await onlyPrediction(indexer);
    t.expect([row.upDelta, row.downDelta, row.underlyingDelta]).toEqual([40n, 40n, -40n]);
    t.expect([row.upBalance, row.downBalance, row.underlyingBalance]).toEqual([40n, 40n, 0n]);
    t.expect(row.upAvgPrice).toBeUndefined();
    t.expect(row.impliedPrediction).toBeUndefined();
  });

  it("counts a market token leaving for the owner's wallet", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    await indexer.Position.set({
      id: `${EXECUTOR}-${UP}`,
      executor_id: EXECUTOR,
      token: UP,
      balance: 100n,
      updatedAt: 0n,
    });

    await indexEvents(indexer, [executorDeployed(OWNER, EXECUTOR), transfer(UP, EXECUTOR, OWNER, 40n)]);

    const row = await onlyPrediction(indexer);
    t.expect([row.upDelta, row.upBalance]).toEqual([-40n, 60n]);
    t.expect(row.upAvgPrice).toBeUndefined();
  });

  it("counts a market token arriving from the owner's wallet with no swap or underlying", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    await indexer.Position.set({
      id: `${EXECUTOR}-${UP}`,
      executor_id: EXECUTOR,
      token: UP,
      balance: 100n,
      updatedAt: 0n,
    });

    await indexEvents(indexer, [executorDeployed(OWNER, EXECUTOR), transfer(UP, OWNER, EXECUTOR, 20n)]);

    const row = await onlyPrediction(indexer);
    t.expect([row.upDelta, row.downDelta, row.underlyingDelta]).toEqual([20n, 0n, 0n]);
    t.expect([row.upSwapTokens, row.upSwapUnderlying, row.downSwapTokens, row.downSwapUnderlying]).toEqual([
      0n,
      0n,
      0n,
      0n,
    ]);
    t.expect(row.upBalance).toBe(120n);
    t.expect(row.upAvgPrice).toBeUndefined();
  });

  it("gives each transaction of a chunked predict its own row", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    // chunk one buys 60 UP at 0.40, chunk two buys 40 more at 0.50 in its own transaction
    const CHUNK_TWO = { transaction: { hash: "0xc2" } };
    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, UP_POOL),
      initialized(UP_POOL, PAR),
      transfer(UNDERLYING, EXECUTOR, UP_POOL, 24n, BLOCK + 2),
      transfer(UP, UP_POOL, EXECUTOR, 60n, BLOCK + 2),
      swapped(UP_POOL, EXECUTOR, 2n ** 97n, 120n, BLOCK + 2, bought(24n, 60n)),
      { ...transfer(UNDERLYING, EXECUTOR, UP_POOL, 20n, BLOCK + 3), ...CHUNK_TWO },
      { ...transfer(UP, UP_POOL, EXECUTOR, 40n, BLOCK + 3), ...CHUNK_TWO },
      { ...swapped(UP_POOL, EXECUTOR, 2n ** 98n, 140n, BLOCK + 3, bought(20n, 40n)), ...CHUNK_TWO },
    ]);

    const rows = await indexer.Prediction.getAll();
    const chunks = rows.map((row) => [row.upDelta, row.upAvgPrice]).sort();

    t.expect(rows).toHaveLength(2);
    t.expect(chunks).toEqual([
      [40n, (5n * WAD) / 10n],
      [60n, (4n * WAD) / 10n],
    ]);
    t.expect(new Set(rows.map((row) => row.transactionHash)).size).toBe(2);
  });

  it("leaves prices off a swap that paid out through a middleman", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    // the pool pays the router, the router forwards to the executor
    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, UP_POOL),
      initialized(UP_POOL, PAR),
      transfer(UNDERLYING, EXECUTOR, ROUTER, 40n, BLOCK + 2),
      transfer(UP, ROUTER, EXECUTOR, 100n, BLOCK + 2),
      swapped(UP_POOL, ROUTER, 2n ** 97n, 120n, BLOCK + 2, bought(40n, 100n)),
    ]);

    const row = await onlyPrediction(indexer);
    t.expect([row.upDelta, row.underlyingDelta]).toEqual([100n, -40n]);
    t.expect(row.upAvgPrice).toBeUndefined();
    t.expect(row.upPriceAfter).toBeUndefined();
  });

  it("prices each market's trading separately within one transaction", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    await seedMarket(indexer, SECOND_MARKET);

    // buy 100 UP at 0.40 in the first market, 100 DOWN at 0.30 in the second
    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, UP_POOL),
      poolCreated(OTHER_UNDERLYING, OTHER_DOWN, OTHER_POOL),
      initialized(UP_POOL, PAR),
      initialized(OTHER_POOL, 2n ** 97n),
      transfer(UNDERLYING, EXECUTOR, UP_POOL, 40n, BLOCK + 2),
      transfer(UP, UP_POOL, EXECUTOR, 100n, BLOCK + 2),
      swapped(UP_POOL, EXECUTOR, 2n ** 97n, 120n, BLOCK + 2, bought(40n, 100n)),
      transfer(OTHER_UNDERLYING, EXECUTOR, OTHER_POOL, 30n, BLOCK + 2),
      transfer(OTHER_DOWN, OTHER_POOL, EXECUTOR, 100n, BLOCK + 2),
      swapped(OTHER_POOL, EXECUTOR, 3n * 2n ** 95n, 120n, BLOCK + 2, bought(30n, 100n)),
    ]);

    const rows = await indexer.Prediction.getAll();
    const first = rows.find((row) => row.childMarket_id === CHILD_MARKET);
    const second = rows.find((row) => row.childMarket_id === OTHER_MARKET);

    t.expect(rows).toHaveLength(2);
    t.expect([first!.upDelta, first!.impliedPrediction]).toEqual([100n, 40n]);
    t.expect([second!.downDelta, second!.impliedPrediction]).toEqual([100n, 70n]);
    // each row carries only its own pool's prices
    t.expect([first!.upPriceAfter, first!.downPriceAfter]).toEqual([WAD / 4n, undefined]);
    t.expect([second!.upPriceAfter, second!.downPriceAfter]).toEqual([undefined, (4n * WAD) / 9n]);
  });
});
