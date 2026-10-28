import { createFlowRunStore, DEFAULT_RUN_TTL_MS, type FlowRunStorage } from "@foresight/tx-orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import { seedRequest } from "./support/requests";
import { chain, disposeDrivers, driverOn, gateway, progressOf, wallet } from "./support/world";
import { owner } from "../../flow/__tests__/support/session";
import { unsettledLiquidityRun } from "../store";

afterEach(disposeDrivers);

const FLOW = "liquidity-session-1";

/** `storage` read once the run's expiry has passed, with and without the liquidity rule. */
const afterExpiry = (storage: FlowRunStorage) => {
  const late = () => Date.now() + DEFAULT_RUN_TTL_MS + 60_000;
  return {
    kept: createFlowRunStore({ storage, now: late, unsettled: unsettledLiquidityRun }).load(FLOW),
    plain: createFlowRunStore({ storage, now: late }).load(FLOW),
  };
};

describe("unsettledLiquidityRun keeping a run past its expiry (L8, L9)", () => {
  it("keeps a run whose batch id is stored and whose batch has not settled", async () => {
    const fake = chain();
    const batch = wallet(fake, owner, { atomic: "supported", status: "pending" });
    const tab = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: batch, request: seedRequest() });
    tab.driver.start();
    await batch.sent();
    tab.driver.dispose();
    // reconciling turns the open prompt back to pending, so only the batch id says it may have landed
    const recovered = driverOn({
      world: fake,
      gateway: gateway(fake, owner),
      wallet: batch,
      request: seedRequest(),
      storage: tab.storage,
    });
    recovered.driver.recover();
    await vi.waitFor(() => expect(progressOf(recovered.driver).stage).toBe("review"));

    const { kept, plain } = afterExpiry(tab.storage);
    expect(plain).toBeNull();
    expect(kept?.flowId).toBe(FLOW);
  });

  it("keeps a run whose stored send's step has not settled", async () => {
    const fake = chain();
    const sends = gateway(fake, owner, { script: (index) => (index === 1 ? "hang" : "sign") });
    const tab = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });
    tab.driver.start();
    await sends.held();
    tab.driver.dispose();
    const recovered = driverOn({
      world: fake,
      gateway: gateway(fake, owner),
      wallet: wallet(fake, owner),
      request: seedRequest(),
      storage: tab.storage,
    });
    recovered.driver.recover();
    await vi.waitFor(() => expect(progressOf(recovered.driver).stage).toBe("review"));

    const { kept, plain } = afterExpiry(tab.storage);
    expect(plain).toBeNull();
    expect(kept?.flowId).toBe(FLOW);
  });

  it("lets a run expire once every stored send's step has settled", async () => {
    const fake = chain();
    const sends = gateway(fake, owner, { script: (index) => (index === 1 ? "reject" : "sign") });
    const tab = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });
    tab.driver.start();
    await vi.waitFor(() => expect(progressOf(tab.driver).stage).toBe("halted"));
    tab.driver.dispose();

    expect(afterExpiry(tab.storage).kept).toBeNull();
  });
});
