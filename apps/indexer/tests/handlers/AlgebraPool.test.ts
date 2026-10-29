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
  OTHER_UNDERLYING,
  OTHER_UP,
  OWNER,
  poolCreated,
  ROUTER,
  seedMarket,
  STRANGER_POOL,
  STRANGER_TOKEN,
  swapped,
  transfer,
  UNDERLYING,
  UP,
  UP_POOL,
} from "../support/harness";

const START_PRICE = 79228162514264337593543950336n;
const AFTER_FIRST = 80000000000000000000000000000n;
const AFTER_SECOND = 81000000000000000000000000000n;

const MARKET = { id: CHILD_MARKET, down: DOWN, up: UP, underlying: UNDERLYING, lowerBound: 0n, upperBound: 100n };
const SECOND_MARKET = {
  id: OTHER_MARKET,
  down: OTHER_DOWN,
  up: OTHER_UP,
  underlying: OTHER_UNDERLYING,
  lowerBound: 0n,
  upperBound: 100n,
};

describe("Algebra pool indexing", () => {
  it("follows a pool that pairs an outcome token with what its market prices against", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [poolCreated(UNDERLYING, UP, UP_POOL)]);

    const pool = await indexer.Pool.getOrThrow(UP_POOL);
    t.expect(pool.childMarket_id).toBe(CHILD_MARKET);
    t.expect(pool.outcomeIndex).toBe(1);
  });

  it("leaves a pool of tokens it does not recognise unfollowed", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [poolCreated(STRANGER_TOKEN, UNDERLYING, STRANGER_POOL)]);

    t.expect(await indexer.Pool.getAll()).toHaveLength(0);
  });

  it("leaves an outcome-against-outcome pool unfollowed", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [poolCreated(DOWN, UP, STRANGER_POOL)]);

    t.expect(await indexer.Pool.getAll()).toHaveLength(0);
  });

  it("follows a pool whose underlying is shared with a market indexed later", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    // a second child on the same parent outcome prices against the same token, and its
    // Token row now names that child
    await seedMarket(indexer, { ...SECOND_MARKET, underlying: UNDERLYING });

    await indexEvents(indexer, [poolCreated(UNDERLYING, UP, UP_POOL)]);

    const pool = await indexer.Pool.getOrThrow(UP_POOL);
    t.expect(pool.childMarket_id).toBe(CHILD_MARKET);
    t.expect(pool.underlyingToken).toBe(UNDERLYING);
  });

  it("leaves a pool pairing tokens of two different markets unfollowed", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    await seedMarket(indexer, SECOND_MARKET);

    await indexEvents(indexer, [poolCreated(OTHER_UNDERLYING, UP, STRANGER_POOL)]);

    t.expect(await indexer.Pool.getAll()).toHaveLength(0);
  });

  it("ignores swaps and prices from a pool it does not follow", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      poolCreated(STRANGER_TOKEN, UNDERLYING, STRANGER_POOL),
      initialized(STRANGER_POOL, START_PRICE),
      swapped(STRANGER_POOL, STRANGER_TOKEN, AFTER_FIRST, 120n),
    ]);

    t.expect(await indexer.Pool.getAll()).toHaveLength(0);
    t.expect(await indexer.Swap.getAll()).toHaveLength(0);
  });

  it("leaves a pool unpriced until it initializes", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [poolCreated(UNDERLYING, UP, UP_POOL)]);

    t.expect((await indexer.Pool.getOrThrow(UP_POOL)).underlyingPerOutcome).toBeUndefined();
  });

  it("prices the pool in underlying when it initializes", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    // UP is token1 here, and sqrt 2^97 is a token1-per-token0 ratio of 4
    await indexEvents(indexer, [poolCreated(UNDERLYING, UP, UP_POOL), initialized(UP_POOL, 2n ** 97n)]);

    t.expect((await indexer.Pool.getOrThrow(UP_POOL)).underlyingPerOutcome).toBe(WAD / 4n);
  });

  it("carries the underlying price a swap left onto the swap and the pool", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    // sqrt 2^95 is a token1-per-token0 ratio of 1/4, so the token1 outcome costs 4 underlying
    await indexEvents(indexer, [
      poolCreated(UNDERLYING, UP, UP_POOL),
      initialized(UP_POOL, START_PRICE),
      swapped(UP_POOL, STRANGER_TOKEN, 2n ** 95n, 120n),
    ]);

    const [swap] = await indexer.Swap.getAll();
    t.expect(swap!.underlyingPerOutcomeAfter).toBe(4n * WAD);
    t.expect((await indexer.Pool.getOrThrow(UP_POOL)).underlyingPerOutcome).toBe(4n * WAD);
  });

  it("records what a swap left the pool at, against what it started from", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      poolCreated(UNDERLYING, UP, UP_POOL),
      initialized(UP_POOL, START_PRICE),
      swapped(UP_POOL, STRANGER_TOKEN, AFTER_FIRST, 120n),
    ]);

    const [swap] = await indexer.Swap.getAll();
    t.expect(swap!.priceBefore).toBe(START_PRICE);
    t.expect(swap!.priceAfter).toBe(AFTER_FIRST);
    t.expect(swap!.tickAfter).toBe(120);
    t.expect(swap!.executor_id).toBeUndefined();
    t.expect((await indexer.Pool.getOrThrow(UP_POOL)).price).toBe(AFTER_FIRST);
  });

  it("chains consecutive swaps, so a trade's impact spans the first to the last", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      poolCreated(UNDERLYING, UP, UP_POOL),
      initialized(UP_POOL, START_PRICE),
      swapped(UP_POOL, STRANGER_TOKEN, AFTER_FIRST, 120n, BLOCK + 2),
      swapped(UP_POOL, STRANGER_TOKEN, AFTER_SECOND, 140n, BLOCK + 3),
    ]);

    const swaps = (await indexer.Swap.getAll()).sort((a, b) => Number(a.blockNumber - b.blockNumber));
    t.expect(swaps.map((swap) => [swap.priceBefore, swap.priceAfter])).toEqual([
      [START_PRICE, AFTER_FIRST],
      [AFTER_FIRST, AFTER_SECOND],
    ]);
  });

  it("records the transaction's sender, not the router the pool reports", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    const trader = "0x00000000000000000000000000000000000ABCDE";
    const swap = { ...swapped(UP_POOL, STRANGER_TOKEN, AFTER_FIRST, 120n), transaction: { from: trader } };

    await indexEvents(indexer, [poolCreated(UNDERLYING, UP, UP_POOL), initialized(UP_POOL, START_PRICE), swap]);

    const [indexed] = await indexer.Swap.getAll();
    t.expect(indexed!.sender).toBe(trader.toLowerCase());
  });

  it("attributes a swap to the executor it paid out to", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, UP_POOL),
      initialized(UP_POOL, START_PRICE),
      swapped(UP_POOL, EXECUTOR, AFTER_FIRST, 120n),
    ]);

    const [swap] = await indexer.Swap.getAll();
    t.expect(swap!.executor_id).toBe(EXECUTOR);
    t.expect(swap!.childMarket_id).toBe(CHILD_MARKET);
  });
});

const WAD = 10n ** 18n;

describe("prediction pricing", () => {
  it("takes the UP price off the swap and reads it as the forecast", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, UP_POOL),
      initialized(UP_POOL, START_PRICE),
      transfer(UNDERLYING, EXECUTOR, UP_POOL, 40n, BLOCK + 2),
      transfer(UP, UP_POOL, EXECUTOR, 100n, BLOCK + 2),
      swapped(UP_POOL, EXECUTOR, AFTER_FIRST, 120n, BLOCK + 2, bought(40n, 100n)),
    ]);

    const prediction = await onlyPrediction(indexer);
    t.expect(prediction.upAvgPrice).toBe((4n * WAD) / 10n);
    t.expect(prediction.downAvgPrice).toBeUndefined();
    t.expect(prediction.impliedPrediction).toBe(40n);
  });

  it("mirrors the forecast when only the DOWN side was swapped", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, DOWN, DOWN_POOL),
      initialized(DOWN_POOL, START_PRICE),
      transfer(UNDERLYING, EXECUTOR, DOWN_POOL, 40n, BLOCK + 2),
      transfer(DOWN, DOWN_POOL, EXECUTOR, 100n, BLOCK + 2),
      swapped(DOWN_POOL, EXECUTOR, AFTER_FIRST, 120n, BLOCK + 2, bought(40n, 100n)),
    ]);

    const prediction = await onlyPrediction(indexer);
    t.expect(prediction.downAvgPrice).toBe((4n * WAD) / 10n);
    t.expect(prediction.upAvgPrice).toBeUndefined();
    t.expect(prediction.impliedPrediction).toBe(60n);
  });

  it("keeps both prices when both sides were bought", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, UP_POOL),
      poolCreated(UNDERLYING, DOWN, DOWN_POOL),
      initialized(UP_POOL, START_PRICE),
      initialized(DOWN_POOL, START_PRICE),
      transfer(UNDERLYING, EXECUTOR, UP_POOL, 40n, BLOCK + 2),
      transfer(UP, UP_POOL, EXECUTOR, 100n, BLOCK + 2),
      swapped(UP_POOL, EXECUTOR, AFTER_FIRST, 120n, BLOCK + 2, bought(40n, 100n)),
      transfer(UNDERLYING, EXECUTOR, DOWN_POOL, 30n, BLOCK + 2),
      transfer(DOWN, DOWN_POOL, EXECUTOR, 100n, BLOCK + 2),
      swapped(DOWN_POOL, EXECUTOR, AFTER_FIRST, 120n, BLOCK + 2, bought(30n, 100n)),
    ]);

    const prediction = await onlyPrediction(indexer);
    t.expect(prediction.upAvgPrice).toBe((4n * WAD) / 10n);
    t.expect(prediction.downAvgPrice).toBe((3n * WAD) / 10n);
    t.expect(prediction.upDelta).toBe(100n);
    t.expect(prediction.downDelta).toBe(100n);
    // from the UP side; DOWN's mirror would say 70
    t.expect(prediction.impliedPrediction).toBe(40n);
  });

  it("banks a split-and-sell-both arbitrage as profit on a flat position", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    // split 40, then sell both sides above par: 22 + 21 back for the 40 spent
    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, UP_POOL),
      poolCreated(UNDERLYING, DOWN, DOWN_POOL),
      initialized(UP_POOL, START_PRICE),
      initialized(DOWN_POOL, START_PRICE),
      transfer(UNDERLYING, EXECUTOR, ROUTER, 40n, BLOCK + 2),
      transfer(UP, ROUTER, EXECUTOR, 40n, BLOCK + 2),
      transfer(DOWN, ROUTER, EXECUTOR, 40n, BLOCK + 2),
      transfer(UP, EXECUTOR, UP_POOL, 40n, BLOCK + 2),
      transfer(UNDERLYING, UP_POOL, EXECUTOR, 22n, BLOCK + 2),
      swapped(UP_POOL, EXECUTOR, AFTER_FIRST, 120n, BLOCK + 2, bought(-22n, -40n)),
      transfer(DOWN, EXECUTOR, DOWN_POOL, 40n, BLOCK + 2),
      transfer(UNDERLYING, DOWN_POOL, EXECUTOR, 21n, BLOCK + 2),
      swapped(DOWN_POOL, EXECUTOR, AFTER_FIRST, 120n, BLOCK + 2, bought(-21n, -40n)),
    ]);

    const prediction = await onlyPrediction(indexer);
    t.expect(prediction.underlyingDelta).toBe(3n);
    t.expect(prediction.upDelta).toBe(0n);
    t.expect(prediction.downDelta).toBe(0n);
    t.expect(prediction.upAvgPrice).toBe((55n * WAD) / 100n);
    t.expect(prediction.downAvgPrice).toBe((525n * WAD) / 1000n);
  });

  it("records the pool price either side of this side's swaps", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, UP_POOL),
      initialized(UP_POOL, START_PRICE),
      transfer(UNDERLYING, EXECUTOR, UP_POOL, 40n, BLOCK + 2),
      transfer(UP, UP_POOL, EXECUTOR, 100n, BLOCK + 2),
      swapped(UP_POOL, EXECUTOR, 2n ** 97n, 120n, BLOCK + 2, bought(40n, 60n)),
      transfer(UNDERLYING, EXECUTOR, UP_POOL, 20n, BLOCK + 2),
      transfer(UP, UP_POOL, EXECUTOR, 40n, BLOCK + 2),
      swapped(UP_POOL, EXECUTOR, 2n ** 98n, 140n, BLOCK + 2, bought(20n, 40n)),
    ]);

    // 2^96 is a ratio of one, and each doubling of the sqrt price quarters the underlying per UP
    const prediction = await onlyPrediction(indexer);
    t.expect(prediction.upPriceBefore).toBe(WAD);
    t.expect(prediction.upPriceAfter).toBe(WAD / 16n);
    t.expect(prediction.downPriceBefore).toBeUndefined();
  });

  it("follows the pool's own token order when reading the price", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UP, UNDERLYING, UP_POOL),
      initialized(UP_POOL, START_PRICE),
      transfer(UNDERLYING, EXECUTOR, UP_POOL, 40n, BLOCK + 2),
      transfer(UP, UP_POOL, EXECUTOR, 100n, BLOCK + 2),
      swapped(UP_POOL, EXECUTOR, 2n ** 97n, 120n, BLOCK + 2, { amount0: -100n, amount1: 40n }),
    ]);

    const prediction = await onlyPrediction(indexer);
    t.expect(prediction.upPriceAfter).toBe(4n * WAD);
    t.expect(prediction.upAvgPrice).toBe((4n * WAD) / 10n);
  });

  it("averages several swaps on one side", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, UP_POOL),
      initialized(UP_POOL, START_PRICE),
      transfer(UNDERLYING, EXECUTOR, UP_POOL, 40n, BLOCK + 2),
      transfer(UP, UP_POOL, EXECUTOR, 100n, BLOCK + 2),
      swapped(UP_POOL, EXECUTOR, AFTER_FIRST, 120n, BLOCK + 2, bought(40n, 100n)),
      swapped(UP_POOL, EXECUTOR, AFTER_SECOND, 140n, BLOCK + 2, bought(60n, 100n)),
    ]);

    // 100 underlying for 200 UP, so 0.5 even though neither fill was
    t.expect((await onlyPrediction(indexer)).upAvgPrice).toBe(WAD / 2n);
  });
});

describe("pool statistics", () => {
  it("carries liquidity and lifetime volume off the swaps", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      poolCreated(UNDERLYING, UP, UP_POOL),
      initialized(UP_POOL, START_PRICE),
      swapped(UP_POOL, STRANGER_TOKEN, AFTER_FIRST, 120n, BLOCK + 2, bought(40n, 100n)),
      swapped(UP_POOL, STRANGER_TOKEN, AFTER_SECOND, 140n, BLOCK + 3, bought(-25n, -60n)),
    ]);

    const pool = await indexer.Pool.getOrThrow(UP_POOL);
    t.expect(pool.liquidity).toBe(1_000n);
    t.expect(pool.volumeUnderlying).toBe(65n);
    t.expect(pool.volumeOutcome).toBe(160n);
  });
});
