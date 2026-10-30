import { createTestIndexer } from "envio";
import { describe, it } from "vitest";

import {
  CHILD_MARKET,
  DOWN,
  EXECUTOR,
  executorDeployed,
  indexEvents,
  onlyPrediction,
  OTHER_DOWN,
  OTHER_EXECUTOR,
  OTHER_MARKET,
  OTHER_OWNER,
  OTHER_UNDERLYING,
  OTHER_UP,
  OWNER,
  POOL,
  ROUTER,
  SDAI,
  seedMarket,
  transfer,
  UNDERLYING,
  UNKNOWN_TOKEN,
  UP,
} from "../support/harness";

describe("executor transfer indexing", () => {
  it("signs a transfer by which way the token moved", async (t) => {
    const indexer = createTestIndexer();

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(UNDERLYING, EXECUTOR, POOL, 100n),
      transfer(UP, POOL, EXECUTOR, 250n),
    ]);

    const transfers = await indexer.Transfer.getAll();
    t.expect(transfers.map((row) => [row.token, row.amount, row.counterparty])).toEqual([
      [UNDERLYING, -100n, POOL],
      [UP, 250n, POOL],
    ]);
  });

  it("writes a row for each executor when both sides are ours", async (t) => {
    const indexer = createTestIndexer();

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      executorDeployed(OTHER_OWNER, OTHER_EXECUTOR),
      transfer(UP, EXECUTOR, OTHER_EXECUTOR, 40n),
    ]);

    const transfers = await indexer.Transfer.getAll();
    t.expect(transfers.map((row) => [row.executor_id, row.amount])).toEqual([
      [EXECUTOR, -40n],
      [OTHER_EXECUTOR, 40n],
    ]);
  });

  it("ignores self-transfers and zero amounts", async (t) => {
    const indexer = createTestIndexer();

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(SDAI, EXECUTOR, EXECUTOR, 100n),
      transfer(SDAI, OWNER, EXECUTOR, 0n),
    ]);

    t.expect(await indexer.Transfer.getAll()).toHaveLength(0);
    t.expect(await indexer.Position.getAll()).toHaveLength(0);
  });

  it("keys every row by the lowercase address, whatever case the chain hands back", async (t) => {
    const indexer = createTestIndexer();
    const upper = (address: string) => `0x${address.slice(2).toUpperCase()}` as `0x${string}`;

    // the executor's own case cannot vary here: the wildcard filter routes by the registered
    // address, which in production is compared as topic bytes rather than text
    await indexEvents(indexer, [
      executorDeployed(upper(OWNER), EXECUTOR),
      transfer(upper(SDAI), upper(OWNER), EXECUTOR, 100n),
    ]);

    t.expect((await indexer.Executor.getOrThrow(EXECUTOR)).owner).toBe(OWNER);
    t.expect((await indexer.Position.getOrThrow(`${EXECUTOR}-${SDAI}`)).balance).toBe(100n);
    const [row] = await indexer.Transfer.getAll();
    t.expect([row!.token, row!.counterparty]).toEqual([SDAI, OWNER]);
  });

  it("records an sDAI deposit as balance and history, never a prediction", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [executorDeployed(OWNER, EXECUTOR), transfer(SDAI, OWNER, EXECUTOR, 100n)]);

    t.expect((await indexer.Position.getOrThrow(`${EXECUTOR}-${SDAI}`)).balance).toBe(100n);
    t.expect((await indexer.Transfer.getAll()).map((row) => [row.token, row.amount, row.counterparty])).toEqual([
      [SDAI, 100n, OWNER],
    ]);
    t.expect(await indexer.Prediction.getAll()).toHaveLength(0);
  });

  it("groups one batch's transfers under its transaction", async (t) => {
    const indexer = createTestIndexer();

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(UNDERLYING, EXECUTOR, POOL, 100n),
      transfer(UP, POOL, EXECUTOR, 250n),
    ]);

    const transfers = await indexer.Transfer.getAll();
    const hashes = new Set(transfers.map((row) => row.transactionHash));

    t.expect(transfers).toHaveLength(2);
    t.expect(hashes.size).toBe(1);
  });
});

/** Bounds chosen so a price of 0.4 lands on a whole number either side of the scale. */
const LOWER_BOUND = 0n;
const UPPER_BOUND = 100n;

const MARKET = {
  id: CHILD_MARKET,
  down: DOWN,
  up: UP,
  underlying: UNDERLYING,
  lowerBound: LOWER_BOUND,
  upperBound: UPPER_BOUND,
};
const SECOND_MARKET = {
  id: OTHER_MARKET,
  down: OTHER_DOWN,
  up: OTHER_UP,
  underlying: OTHER_UNDERLYING,
  lowerBound: LOWER_BOUND,
  upperBound: UPPER_BOUND,
};

describe("prediction netting", () => {
  it("nets a buy from what the batch actually moved", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(UNDERLYING, EXECUTOR, POOL, 40n),
      transfer(UP, POOL, EXECUTOR, 100n),
    ]);

    const trade = await onlyPrediction(indexer);
    t.expect(trade.underlyingDelta).toBe(-40n);
    t.expect(trade.upDelta).toBe(100n);
    t.expect(trade.downDelta).toBe(0n);
    t.expect(trade.childMarket_id).toBe(CHILD_MARKET);
  });

  it("nets the transfers in either order", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(UP, POOL, EXECUTOR, 100n),
      transfer(UNDERLYING, EXECUTOR, POOL, 40n),
    ]);

    const trade = await onlyPrediction(indexer);
    t.expect(trade.underlyingDelta).toBe(-40n);
    t.expect(trade.upDelta).toBe(100n);
  });

  it("attributes a shared underlying to the market this transaction traded, whichever leg comes first", async (t) => {
    for (const legs of [
      [transfer(UNDERLYING, EXECUTOR, POOL, 40n), transfer(UP, POOL, EXECUTOR, 100n)],
      [transfer(UP, POOL, EXECUTOR, 100n), transfer(UNDERLYING, EXECUTOR, POOL, 40n)],
    ]) {
      const indexer = createTestIndexer();
      await seedMarket(indexer, MARKET);
      // a second child priced against the same parent outcome token
      await seedMarket(indexer, { ...SECOND_MARKET, underlying: UNDERLYING });

      await indexEvents(indexer, [executorDeployed(OWNER, EXECUTOR), ...legs]);

      const trade = await onlyPrediction(indexer);
      t.expect(trade.childMarket_id).toBe(CHILD_MARKET);
      t.expect([trade.underlyingDelta, trade.upDelta]).toEqual([-40n, 100n]);
    }
  });

  it("counts only the executor's own underlying, not what it paid another executor in the same transaction", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      executorDeployed(OTHER_OWNER, OTHER_EXECUTOR),
      transfer(UNDERLYING, EXECUTOR, OTHER_EXECUTOR, 30n),
      transfer(UNDERLYING, EXECUTOR, POOL, 40n),
      transfer(UP, POOL, EXECUTOR, 100n),
    ]);

    const trade = await onlyPrediction(indexer);
    t.expect(trade.executor_id).toBe(EXECUTOR);
    t.expect(trade.underlyingDelta).toBe(-70n);
  });

  it("writes a prediction row for each executor when one sends the other a market token", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    await indexer.Position.set({
      id: `${EXECUTOR}-${UP}`,
      executor_id: EXECUTOR,
      token: UP,
      balance: 40n,
      updatedAt: 0n,
    });

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      executorDeployed(OTHER_OWNER, OTHER_EXECUTOR),
      transfer(UP, EXECUTOR, OTHER_EXECUTOR, 40n),
    ]);

    const rows = await indexer.Prediction.getAll();
    t.expect(rows).toHaveLength(2);
    t.expect(rows.find((row) => row.executor_id === EXECUTOR)).toMatchObject({
      upDelta: -40n,
      upBalance: 0n,
      downDelta: 0n,
      underlyingDelta: 0n,
      upSwapTokens: 0n,
      upSwapUnderlying: 0n,
    });
    t.expect(rows.find((row) => row.executor_id === OTHER_EXECUTOR)).toMatchObject({
      upDelta: 40n,
      upBalance: 40n,
      downDelta: 0n,
      underlyingDelta: 0n,
      upSwapTokens: 0n,
      upSwapUnderlying: 0n,
    });
  });

  it("records a bare underlying move as balance and history, never a prediction", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [executorDeployed(OWNER, EXECUTOR), transfer(UNDERLYING, OWNER, EXECUTOR, 100n)]);

    t.expect((await indexer.Position.getOrThrow(`${EXECUTOR}-${UNDERLYING}`)).balance).toBe(100n);
    t.expect(await indexer.Transfer.getAll()).toHaveLength(1);
    t.expect(await indexer.Prediction.getAll()).toHaveLength(0);
  });

  it("keeps each market's trading in its own row", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    await seedMarket(indexer, SECOND_MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(UNDERLYING, EXECUTOR, POOL, 40n),
      transfer(UP, POOL, EXECUTOR, 100n),
      transfer(OTHER_UNDERLYING, EXECUTOR, POOL, 10n),
      transfer(OTHER_DOWN, POOL, EXECUTOR, 50n),
    ]);

    const predictions = await indexer.Prediction.getAll();
    t.expect(predictions).toHaveLength(2);

    const first = predictions.find((row) => row.childMarket_id === CHILD_MARKET);
    const second = predictions.find((row) => row.childMarket_id === OTHER_MARKET);
    t.expect([first!.underlyingDelta, first!.upDelta, first!.downDelta]).toEqual([-40n, 100n, 0n]);
    t.expect([second!.underlyingDelta, second!.upDelta, second!.downDelta]).toEqual([-10n, 0n, 50n]);
  });

  it("carries the balances the transaction left", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);
    await indexer.Position.set({
      id: `${EXECUTOR}-${UNDERLYING}`,
      executor_id: EXECUTOR,
      token: UNDERLYING,
      balance: 100n,
      updatedAt: 0n,
    });

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(UNDERLYING, EXECUTOR, POOL, 40n),
      transfer(UP, POOL, EXECUTOR, 100n),
    ]);

    const trade = await onlyPrediction(indexer);
    t.expect(trade.underlyingBalance).toBe(60n);
    t.expect(trade.upBalance).toBe(100n);
    t.expect(trade.downBalance).toBe(0n);
    t.expect((await indexer.Position.getOrThrow(`${EXECUTOR}-${UP}`)).balance).toBe(100n);
  });

  it("nets a mint-and-sell into the side the trade kept", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    // split 40 underlying into 40 UP + 40 DOWN, sell the DOWN for 16, buy 35 more UP with it
    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(UNDERLYING, EXECUTOR, ROUTER, 40n),
      transfer(UP, ROUTER, EXECUTOR, 40n),
      transfer(DOWN, ROUTER, EXECUTOR, 40n),
      transfer(DOWN, EXECUTOR, POOL, 40n),
      transfer(UNDERLYING, POOL, EXECUTOR, 16n),
      transfer(UNDERLYING, EXECUTOR, POOL, 16n),
      transfer(UP, POOL, EXECUTOR, 35n),
    ]);

    const trade = await onlyPrediction(indexer);
    t.expect(trade.downDelta).toBe(0n);
    t.expect(trade.upDelta).toBe(75n);
    t.expect(trade.underlyingDelta).toBe(-40n);
  });
});

describe("prediction netting on the way out", () => {
  it("signs a sell the other way round", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(UP, EXECUTOR, POOL, 100n),
      transfer(UNDERLYING, POOL, EXECUTOR, 40n),
    ]);

    const trade = await onlyPrediction(indexer);
    t.expect(trade.underlyingDelta).toBe(40n);
    t.expect(trade.upDelta).toBe(-100n);
  });

  it("leaves the underlying at zero when the token paid with is unclassified", async (t) => {
    const indexer = createTestIndexer();
    await seedMarket(indexer, MARKET);

    await indexEvents(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      transfer(UNKNOWN_TOKEN, EXECUTOR, POOL, 40n),
      transfer(UP, POOL, EXECUTOR, 100n),
    ]);

    const trade = await onlyPrediction(indexer);
    t.expect(trade.underlyingDelta).toBe(0n);
    t.expect(trade.upDelta).toBe(100n);
  });
});
