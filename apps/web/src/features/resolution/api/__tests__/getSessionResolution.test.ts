import fc from "fast-check";
import { formatEther, parseEther } from "viem";
import { describe, expect, it, vi } from "vitest";

import { fetchSessionResolution } from "../getSessionResolution";
import { createChain, WAD, type FailingRead } from "./support/chain";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const field = (value: object, key: string) => (value as Record<string, unknown>)[key];

/** The fields that would claim a resolution or a payout. */
const CLAIMS = ["winningOutcomes", "payoutNumerators", "payoutDenominator", "invalid", "finalValue"];

function claimsOf(value: object) {
  return CLAIMS.filter((key) => {
    const found = field(value, key);
    return found !== undefined && found !== null && !(Array.isArray(found) && found.length === 0);
  });
}

describe("fetchSessionResolution", () => {
  describe("A1 a session part resolved", () => {
    it("returns the parent's winners, a valued child, an INVALID child and an unresolved child, with the chain's payouts", async () => {
      const chain = createChain(3);
      chain.resolveParent([0, 1, 2]);
      chain.resolveChild(0, { value: parseEther("42") });
      chain.resolveChild(2, "invalid");
      const [valued, waiting, invalid] = chain.childMarkets as [`0x${string}`, `0x${string}`, `0x${string}`];

      const resolution = await fetchSessionResolution(chain.client, chain.markets);

      expect(resolution.parent).toMatchObject({
        resolved: true,
        winningOutcomes: [0, 1, 2],
        ...chain.payouts(chain.parentMarket),
      });
      expect(chain.payouts(chain.parentMarket).payoutNumerators).toEqual([1n, 1n, 1n, 0n]);
      expect(resolution.children).toHaveLength(3);
      expect(resolution.children[0]).toMatchObject({
        market: valued,
        resolved: true,
        invalid: false,
        finalValue: 42,
        ...chain.payouts(valued),
      });
      expect(chain.payouts(valued).payoutNumerators).toEqual([parseEther("58"), parseEther("42"), 0n]);
      expect(resolution.children[2]).toMatchObject({
        market: invalid,
        resolved: true,
        invalid: true,
        finalValue: null,
        payoutNumerators: [0n, 0n, 1n],
        payoutDenominator: 1n,
      });
      expect(resolution.children[1]).toMatchObject({ market: waiting, resolved: false });
      expect(claimsOf(resolution.children[1]!)).toEqual([]);
    });

    it("names only the winning parent outcomes of a single-winner parent", async () => {
      const chain = createChain(4);
      chain.resolveParent([2]);

      const resolution = await fetchSessionResolution(chain.client, chain.markets);

      expect(resolution.parent).toMatchObject({
        resolved: true,
        winningOutcomes: [2],
        payoutNumerators: [0n, 0n, 1n, 0n, 0n],
        payoutDenominator: 1n,
      });
      for (const child of resolution.children) {
        expect(child.resolved).toBe(false);
        expect(claimsOf(child)).toEqual([]);
      }
    });

    it("reports a child resolved before its parent, without inventing parent winners", async () => {
      const chain = createChain(2);
      chain.resolveChild(1, { value: parseEther("7") });

      const resolution = await fetchSessionResolution(chain.client, chain.markets);

      expect(resolution.parent.resolved).toBe(false);
      expect(claimsOf(resolution.parent)).toEqual([]);
      expect(resolution.children[1]).toMatchObject({
        market: chain.childMarkets[1],
        resolved: true,
        invalid: false,
        finalValue: 7,
        payoutNumerators: [parseEther("93"), parseEther("7"), 0n],
        payoutDenominator: parseEther("100"),
      });
    });

    it("reads a child's final value against that child's own bounds, at and between them", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 0n, max: 1_000_000n * WAD }),
          fc.bigInt({ min: 1n, max: 1_000_000n * WAD }),
          fc.oneof(
            fc.constant("lower" as const),
            fc.constant("upper" as const),
            fc.bigInt({ min: 0n, max: 1n << 80n }),
          ),
          async (lowerBound, span, at) => {
            const upperBound = lowerBound + span;
            const value = at === "lower" ? lowerBound : at === "upper" ? upperBound : lowerBound + (at % (span + 1n));
            const chain = createChain(1, { bounds: [{ lowerBound, upperBound }] });
            chain.resolveParent([0]);
            chain.resolveChild(0, { value });

            const resolution = await fetchSessionResolution(chain.client, chain.markets);

            const child = resolution.children[0]!;
            expect(child).toMatchObject({ resolved: true, invalid: false, ...chain.payouts(chain.childMarkets[0]!) });
            const finalValue = field(child, "finalValue");
            expect(typeof finalValue).toBe("number");
            const expected = Number(formatEther(value));
            expect(Math.abs((finalValue as number) - expected)).toBeLessThanOrEqual(1e-9 * Math.max(1, expected));
          },
        ),
        { numRuns: 200 },
      );
    });

    it("returns every token's numerator as the chain holds it, for any set of parent winners", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc
            .integer({ min: 2, max: 4 })
            .chain((count) =>
              fc.tuple(fc.constant(count), fc.uniqueArray(fc.integer({ min: 0, max: count - 1 }), { minLength: 1 })),
            ),
          async ([count, winners]) => {
            const chain = createChain(count);
            chain.resolveParent(winners);

            const resolution = await fetchSessionResolution(chain.client, chain.markets);

            expect(resolution.parent).toMatchObject({
              resolved: true,
              winningOutcomes: [...winners].sort((a, b) => a - b),
              ...chain.payouts(chain.parentMarket),
            });
            expect(resolution.children.map((child) => child.market)).toEqual(chain.childMarkets);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("A2 an unresolved session", () => {
    it.each([1, 2, 4])("reports nothing resolved and claims no payout, with %i options", async (count) => {
      const chain = createChain(count);

      const resolution = await fetchSessionResolution(chain.client, chain.markets);

      expect(resolution.parent.resolved).toBe(false);
      expect(claimsOf(resolution.parent)).toEqual([]);
      expect(resolution.children.map((child) => child.market)).toEqual(chain.childMarkets);
      for (const child of resolution.children) {
        expect(child.resolved).toBe(false);
        expect(claimsOf(child)).toEqual([]);
      }
    });
  });

  describe("A4 a failed read", () => {
    it("rejects when the node cannot be reached, rather than reading as unresolved", async () => {
      const chain = createChain(3);
      chain.goOffline();

      await expect(fetchSessionResolution(chain.client, chain.markets)).rejects.toThrow();
    });

    it("rejects when the node cannot be reached even after the parent resolved", async () => {
      const chain = createChain(2);
      chain.resolveParent([1]);
      chain.goOffline();

      await expect(fetchSessionResolution(chain.client, chain.markets)).rejects.toThrow();
    });

    const failures: {
      name: string;
      market: (chain: ReturnType<typeof createChain>) => `0x${string}`;
      read: FailingRead;
    }[] = [
      {
        name: "one unresolved child's denominator",
        market: (chain) => chain.childMarkets[1]!,
        read: "payoutDenominator",
      },
      { name: "the parent's denominator", market: (chain) => chain.parentMarket, read: "payoutDenominator" },
      { name: "a resolved child's numerators", market: (chain) => chain.childMarkets[0]!, read: "payoutNumerators" },
      { name: "the resolved parent's numerators", market: (chain) => chain.parentMarket, read: "payoutNumerators" },
      { name: "one child's conditionId", market: (chain) => chain.childMarkets[2]!, read: "conditionId" },
    ];

    it.each(failures)("rejects when $name reverts while the other reads succeed", async ({ market, read }) => {
      const chain = createChain(3);
      chain.resolveParent([0, 1, 2]);
      chain.resolveChild(0, { value: parseEther("42") });
      chain.fail(market(chain), read);

      await expect(fetchSessionResolution(chain.client, chain.markets)).rejects.toThrow();
    });
  });
});
