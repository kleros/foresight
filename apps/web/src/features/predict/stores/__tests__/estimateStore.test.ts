import { beforeEach, describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";

import { ESTIMATES_STORAGE_KEY, normalizeEstimates, useEstimateStore } from "../estimateStore";

const PARENT = addresses.parentMarket;
const [FIRST, SECOND] = addresses.childMarkets;

const store = () => useEstimateStore.getState();

beforeEach(() => {
  localStorage.clear();
  useEstimateStore.setState({ estimates: {} });
});

describe("estimateStore", () => {
  it("keeps one estimate per option per session", () => {
    store().setEstimate(PARENT, FIRST, 250);
    store().setEstimate(PARENT, SECOND, 300);
    store().setEstimate(addresses.deployer, FIRST, 1);

    expect(store().estimates[PARENT]).toEqual({ [FIRST]: 250, [SECOND]: 300 });
  });

  it("stores under lowercased addresses whatever casing it is given", () => {
    store().setEstimate(PARENT.toUpperCase(), FIRST.replace("0xc", "0xC"), 250);

    expect(store().estimates[PARENT]).toEqual({ [FIRST]: 250 });
  });

  it("clears one option and forgets the session once it is empty", () => {
    store().setEstimate(PARENT, FIRST, 250);
    store().setEstimate(PARENT, SECOND, 300);

    store().clearEstimate(PARENT, FIRST);
    expect(store().estimates[PARENT]).toEqual({ [SECOND]: 300 });

    store().clearEstimate(PARENT, SECOND);
    expect(store().estimates).toEqual({});
  });

  it("resets one session and leaves the others alone", () => {
    store().setEstimate(PARENT, FIRST, 250);
    store().setEstimate(addresses.deployer, FIRST, 1);

    store().resetEstimates(PARENT);

    expect(store().estimates).toEqual({ [addresses.deployer]: { [FIRST]: 1 } });
  });

  it("comes back from storage after an explicit rehydrate", async () => {
    store().setEstimate(PARENT, FIRST, 250);
    // the store writes on every set, so the saved copy is taken before the state is emptied
    const saved = localStorage.getItem(ESTIMATES_STORAGE_KEY)!;
    useEstimateStore.setState({ estimates: {} });
    localStorage.setItem(ESTIMATES_STORAGE_KEY, saved);

    await useEstimateStore.persist.rehydrate();

    expect(store().estimates[PARENT]).toEqual({ [FIRST]: 250 });
  });

  it("drops a saved shape it cannot trust rather than crashing", async () => {
    localStorage.setItem(
      ESTIMATES_STORAGE_KEY,
      JSON.stringify({ state: { estimates: { [PARENT]: { [FIRST]: "250" }, junk: 1 } }, version: 0 }),
    );

    await useEstimateStore.persist.rehydrate();

    expect(store().estimates).toEqual({});
  });
});

describe("normalizeEstimates", () => {
  it("keeps finite numbers under address-shaped keys", () => {
    expect(normalizeEstimates({ [PARENT]: { [FIRST]: 250 } })).toEqual({ [PARENT]: { [FIRST]: 250 } });
  });

  it("drops anything that is not a finite number under an address", () => {
    const junk = {
      [PARENT]: { [FIRST]: "250", [SECOND]: Number.NaN, notAnAddress: 1 },
      notAnAddress: { [FIRST]: 1 },
      [addresses.deployer]: null,
    };

    expect(normalizeEstimates(junk)).toEqual({});
  });

  it("lowercases keys that were saved in checksum form", () => {
    const upper = { [PARENT.replace("0xf", "0xF")]: { [FIRST.replace("0xc", "0xC")]: 250 } };

    expect(normalizeEstimates(upper)).toEqual({ [PARENT]: { [FIRST]: 250 } });
  });

  it("returns nothing for a shape that is not an object", () => {
    expect(normalizeEstimates(undefined)).toEqual({});
    expect(normalizeEstimates("estimates")).toEqual({});
  });
});
