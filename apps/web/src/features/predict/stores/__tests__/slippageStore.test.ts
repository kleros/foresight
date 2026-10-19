import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SLIPPAGE_STORAGE_KEY, useSlippageStore } from "../slippageStore";

const store = () => useSlippageStore.getState();

beforeEach(() => {
  localStorage.clear();
  useSlippageStore.setState({ settings: { tradeBps: null, creditsBps: null } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("slippageStore", () => {
  it("saves a custom value per browser and reads it back on the next load", async () => {
    store().setSlippage("tradeBps", 250);
    const saved = localStorage.getItem(SLIPPAGE_STORAGE_KEY)!;

    // a fresh page: Auto in memory, the saved value in storage
    useSlippageStore.setState({ settings: { tradeBps: null, creditsBps: null } });
    localStorage.setItem(SLIPPAGE_STORAGE_KEY, saved);
    await useSlippageStore.persist.rehydrate();

    expect(store().settings).toEqual({ tradeBps: 250, creditsBps: null });
  });

  it("goes back to Auto for one kind without touching the other", () => {
    store().setSlippage("tradeBps", 250);
    store().setSlippage("creditsBps", 40);

    store().setSlippage("tradeBps", null);

    expect(store().settings).toEqual({ tradeBps: null, creditsBps: 40 });
  });

  it("reads a tampered saved value as Auto", async () => {
    localStorage.setItem(SLIPPAGE_STORAGE_KEY, JSON.stringify({ state: { settings: { tradeBps: 9e9, creditsBps: 30 } } }));

    await useSlippageStore.persist.rehydrate();

    expect(store().settings).toEqual({ tradeBps: null, creditsBps: 30 });
  });

  it("keeps a setting for the page's life where storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    store().setSlippage("creditsBps", 60);

    expect(store().settings.creditsBps).toBe(60);
  });
});
