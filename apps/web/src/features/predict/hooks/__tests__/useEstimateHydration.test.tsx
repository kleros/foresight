import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";

import { ESTIMATES_STORAGE_KEY, useEstimateStore } from "../../stores/estimateStore";
import { useEstimateHydration } from "../useEstimateHydration";

const PARENT = addresses.parentMarket;
const [FIRST] = addresses.childMarkets;

/** What another tab leaves in storage after setting one estimate. */
const savedByOtherTab = (value: number) =>
  JSON.stringify({ state: { estimates: { [PARENT]: { [FIRST]: value } } }, version: 0 });

beforeEach(() => {
  localStorage.clear();
  useEstimateStore.setState({ estimates: {} });
});

describe("useEstimateHydration", () => {
  it("loads what was saved once mounted", async () => {
    localStorage.setItem(ESTIMATES_STORAGE_KEY, savedByOtherTab(250));

    renderHook(() => useEstimateHydration());
    await act(async () => {});

    expect(useEstimateStore.getState().estimates[PARENT]).toEqual({ [FIRST]: 250 });
  });

  it("takes another tab's write instead of overwriting it later", async () => {
    renderHook(() => useEstimateHydration());
    await act(async () => {});

    localStorage.setItem(ESTIMATES_STORAGE_KEY, savedByOtherTab(300));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: ESTIMATES_STORAGE_KEY }));
    });

    expect(useEstimateStore.getState().estimates[PARENT]).toEqual({ [FIRST]: 300 });
  });

  it("lets storage being cleared elsewhere clear this tab too", async () => {
    localStorage.setItem(ESTIMATES_STORAGE_KEY, savedByOtherTab(250));
    renderHook(() => useEstimateHydration());
    await act(async () => {});

    localStorage.clear();
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });

    expect(useEstimateStore.getState().estimates).toEqual({});
  });

  it("ignores writes to other keys", async () => {
    renderHook(() => useEstimateHydration());
    await act(async () => {});

    localStorage.setItem(ESTIMATES_STORAGE_KEY, savedByOtherTab(300));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    });

    expect(useEstimateStore.getState().estimates).toEqual({});
  });
});
