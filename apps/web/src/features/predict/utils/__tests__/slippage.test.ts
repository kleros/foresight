import { describe, expect, it } from "vitest";

import { DEFAULT_SLIPPAGE, HIGH_SLIPPAGE_BPS, LOW_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS } from "../../oracle/tolerances";
import {
  isHighSlippage,
  isLowSlippage,
  normalizeSlippageSettings,
  parseSlippagePercent,
  resolveSlippage,
  slippagePercent,
} from "../slippage";

describe("parseSlippagePercent", () => {
  it.each([
    ["1", 100],
    ["0.5", 50],
    ["0,25", 25],
    [".3", 30],
    ["2.", 200],
    [" 1.25 % ", 125],
    ["0.01", 1],
  ])("reads %j as %i basis points", (text, bps) => {
    expect(parseSlippagePercent(text)).toBe(bps);
  });

  it("reads empty text as Auto", () => {
    expect(parseSlippagePercent("  ")).toBeNull();
  });

  it.each(["abc", "1.234", "-1", "1e2", "1.2.3", "0", "0.00", ".0"])("refuses %j", (text) => {
    expect(parseSlippagePercent(text)).toBe("invalid");
  });

  it("takes the cap and refuses a hundredth over it", () => {
    expect(parseSlippagePercent(String(MAX_SLIPPAGE_BPS / 100))).toBe(MAX_SLIPPAGE_BPS);
    expect(parseSlippagePercent(String((MAX_SLIPPAGE_BPS + 1) / 100))).toBe("invalid");
  });
});

describe("slippagePercent", () => {
  it.each([
    [100, "1"],
    [20, "0.2"],
    [125, "1.25"],
    [0, "0"],
  ])("writes %i basis points as %s", (bps, text) => {
    expect(slippagePercent(bps)).toBe(text);
  });
});

describe("resolveSlippage", () => {
  it("uses the default for a kind left on Auto and the visitor's value for the other", () => {
    expect(resolveSlippage({ tradeBps: 300, creditsBps: null })).toEqual({
      tradeBps: 300,
      creditsBps: DEFAULT_SLIPPAGE.creditsBps,
    });
  });
});

describe("normalizeSlippageSettings", () => {
  it("keeps whole basis points in range", () => {
    expect(normalizeSlippageSettings({ tradeBps: 250, creditsBps: 1 })).toEqual({ tradeBps: 250, creditsBps: 1 });
  });

  it.each([
    ["a fraction", 1.5],
    ["a value over the cap", MAX_SLIPPAGE_BPS + 1],
    ["a negative value", -1],
    ["zero, which no swap can fill at", 0],
    ["a string", "100"],
  ])("reads %s as Auto", (_label, value) => {
    expect(normalizeSlippageSettings({ tradeBps: value, creditsBps: 50 })).toEqual({ tradeBps: null, creditsBps: 50 });
  });

  it("reads junk as Auto for both", () => {
    expect(normalizeSlippageSettings("junk")).toEqual({ tradeBps: null, creditsBps: null });
  });
});

describe("isHighSlippage", () => {
  it("warns only above each kind's threshold", () => {
    expect(isHighSlippage("tradeBps", HIGH_SLIPPAGE_BPS.tradeBps)).toBe(false);
    expect(isHighSlippage("tradeBps", HIGH_SLIPPAGE_BPS.tradeBps + 1)).toBe(true);
    expect(isHighSlippage("creditsBps", HIGH_SLIPPAGE_BPS.creditsBps + 1)).toBe(true);
  });
});

describe("isLowSlippage", () => {
  it("warns only below each kind's threshold", () => {
    expect(isLowSlippage("tradeBps", LOW_SLIPPAGE_BPS.tradeBps)).toBe(false);
    expect(isLowSlippage("tradeBps", LOW_SLIPPAGE_BPS.tradeBps - 1)).toBe(true);
    expect(isLowSlippage("creditsBps", LOW_SLIPPAGE_BPS.creditsBps)).toBe(false);
    expect(isLowSlippage("creditsBps", LOW_SLIPPAGE_BPS.creditsBps - 1)).toBe(true);
  });
});
