import { describe, expect, it } from "vitest";

import { decodeState, encodeState } from "../codec";

describe("encodeState / decodeState", () => {
  it("round-trips a bigint that JSON alone cannot represent", () => {
    const snapshot = { lowerBound: 0n, upperBound: 500000000000000000000n };

    expect(() => JSON.stringify(snapshot)).toThrow();
    expect(decodeState(encodeState(snapshot))).toEqual(snapshot);
  });

  it("keeps bigint and its decimal string distinct", () => {
    const decoded = decodeState<{ bond: bigint; label: string }>(encodeState({ bond: 10n, label: "10" }));

    expect(decoded.bond).toBe(10n);
    expect(decoded.label).toBe("10");
  });

  it("reaches bigints nested in arrays and objects", () => {
    const snapshot = {
      children: [{ bounds: { lower: 1n } }, { bounds: { lower: 2n } }],
    };

    expect(decodeState(encodeState(snapshot))).toEqual(snapshot);
  });

  it("leaves ordinary JSON values alone", () => {
    const snapshot = { title: "Dune", count: 3, ok: true, missing: null, tags: ["a", "b"] };

    expect(decodeState(encodeState(snapshot))).toEqual(snapshot);
  });

  it("does not mistake a domain object for the bigint envelope", () => {
    // A snapshot is free to contain any shape; only the codec's own tag decodes.
    const snapshot = { note: { $bigint: "7" } };

    expect(decodeState(encodeState(snapshot))).toEqual(snapshot);
  });
});
