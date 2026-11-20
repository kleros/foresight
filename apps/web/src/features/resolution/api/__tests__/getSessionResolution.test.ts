import fc from "fast-check";
import { formatEther, parseEther, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";

import { fetchSessionResolution } from "../getSessionResolution";
import {
  createChain,
  MULTI_SELECT_TEMPLATE,
  REALITY_PROXY,
  SCALAR_TEMPLATE,
  SINGLE_SELECT_TEMPLATE,
  WAD,
  type Chain,
  type FailingRead,
} from "./support/chain";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const field = (value: object, key: string) => (value as Record<string, unknown>)[key];

/** The fields that would claim a resolution, a payout or a deployed market. */
const CLAIMS = ["winningOutcomes", "payoutNumerators", "payoutDenominator", "invalid", "finalValue", "market"];

function claimsOf(value: object, except: string[] = []) {
  return CLAIMS.filter((key) => {
    if (except.includes(key)) return false;
    const found = field(value, key);
    return found !== undefined && found !== null && !(Array.isArray(found) && found.length === 0);
  });
}

const childKeys = (children: object) =>
  Object.keys(children)
    .map(Number)
    .sort((a, b) => a - b);

const read = (chain: Chain, parentOutcomes?: number[]) =>
  fetchSessionResolution(chain.client, parentOutcomes ? { ...chain.session, parentOutcomes } : chain.session);

describe("fetchSessionResolution", () => {
  describe("A1 a session part resolved", () => {
    it("returns the parent's winners, a valued child, an INVALID child and an unresolved child, with the chain's payouts", async () => {
      const chain = createChain(3);
      chain.resolveParent([0, 1, 2]);
      chain.resolveChild(0, { value: parseEther("42") });
      chain.resolveChild(2, "invalid");
      const [valued, waiting, invalid] = chain.childMarkets as [Address, Address, Address];

      const resolution = await read(chain);

      expect(resolution.parent).toMatchObject({
        resolved: true,
        invalid: false,
        winningOutcomes: [0, 1, 2],
        ...chain.payouts(chain.parentMarket),
      });
      expect(chain.payouts(chain.parentMarket).payoutNumerators).toEqual([1n, 1n, 1n, 0n]);
      expect(childKeys(resolution.children)).toEqual([0, 1, 2]);
      expect(resolution.children[0]).toMatchObject({
        deployed: true,
        market: valued,
        resolved: true,
        invalid: false,
        finalValue: 42,
        ...chain.payouts(valued),
      });
      expect(chain.payouts(valued).payoutNumerators).toEqual([parseEther("58"), parseEther("42"), 0n]);
      expect(resolution.children[2]).toMatchObject({
        deployed: true,
        market: invalid,
        resolved: true,
        invalid: true,
        finalValue: null,
        payoutNumerators: [0n, 0n, 1n],
        payoutDenominator: 1n,
      });
      expect(resolution.children[1]).toMatchObject({ deployed: true, market: waiting, resolved: false });
      expect(claimsOf(resolution.children[1]!, ["market"])).toEqual([]);
    });

    it("names only the winning parent outcomes of a single-winner parent", async () => {
      const chain = createChain(4);
      chain.resolveParent([2]);

      const resolution = await read(chain);

      expect(resolution.parent).toMatchObject({
        resolved: true,
        invalid: false,
        winningOutcomes: [2],
        payoutNumerators: [0n, 0n, 1n, 0n, 0n],
        payoutDenominator: 1n,
      });
      expect(childKeys(resolution.children)).toEqual([0, 1, 2, 3]);
      for (const child of Object.values(resolution.children)) {
        expect(child).toMatchObject({ deployed: true, resolved: false });
        expect(claimsOf(child!, ["market"])).toEqual([]);
      }
    });

    it("reports a child resolved before its parent, without inventing parent winners", async () => {
      const chain = createChain(2);
      chain.resolveChild(1, { value: parseEther("7") });

      const resolution = await read(chain);

      expect(resolution.parent.resolved).toBe(false);
      expect(claimsOf(resolution.parent)).toEqual([]);
      expect(resolution.children[1]).toMatchObject({
        deployed: true,
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

            const resolution = await read(chain);

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

            const resolution = await read(chain);

            expect(resolution.parent).toMatchObject({
              resolved: true,
              invalid: false,
              winningOutcomes: [...winners].sort((a, b) => a - b),
              ...chain.payouts(chain.parentMarket),
            });
            expect(childKeys(resolution.children)).toEqual(chain.childMarkets.map((_, index) => index));
            chain.childMarkets.forEach((market, index) =>
              expect(resolution.children[index]).toMatchObject({ deployed: true, market }),
            );
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("A2 an unresolved session", () => {
    it.each([1, 2, 4])("reports nothing resolved and claims no payout, with %i options", async (count) => {
      const chain = createChain(count);

      const resolution = await read(chain);

      expect(resolution.parent.resolved).toBe(false);
      expect(claimsOf(resolution.parent)).toEqual([]);
      expect(childKeys(resolution.children)).toEqual(chain.childMarkets.map((_, index) => index));
      chain.childMarkets.forEach((market, index) => {
        const child = resolution.children[index]!;
        expect(child).toMatchObject({ deployed: true, market, resolved: false });
        expect(claimsOf(child, ["market"])).toEqual([]);
      });
    });

    it("claims nothing for a phased session with only some children deployed", async () => {
      const chain = createChain(3, { deployedChildren: 2 });

      const resolution = await read(chain);

      expect(resolution.parent.resolved).toBe(false);
      expect(claimsOf(resolution.parent)).toEqual([]);
      expect(resolution.children[2]).toEqual({ deployed: false });
      for (const index of [0, 1]) {
        expect(resolution.children[index]).toMatchObject({ deployed: true, resolved: false });
        expect(claimsOf(resolution.children[index]!, ["market"])).toEqual([]);
      }
    });
  });

  describe("A4 a failed read", () => {
    it("rejects when the node cannot be reached, rather than reading as unresolved", async () => {
      const chain = createChain(3);
      await expect(read(chain)).resolves.toBeDefined();
      chain.goOffline();

      await expect(read(chain)).rejects.toThrow();
    });

    it("rejects when the node cannot be reached even after the parent resolved", async () => {
      const chain = createChain(2);
      chain.resolveParent([1]);
      await expect(read(chain)).resolves.toBeDefined();
      chain.goOffline();

      await expect(read(chain)).rejects.toThrow();
    });

    const failures: { name: string; target: (chain: Chain) => Address; read: FailingRead }[] = [
      {
        name: "one unresolved child's denominator",
        target: (chain) => chain.childMarkets[1]!,
        read: "payoutDenominator",
      },
      { name: "the parent's denominator", target: (chain) => chain.parentMarket, read: "payoutDenominator" },
      { name: "a resolved child's numerators", target: (chain) => chain.childMarkets[0]!, read: "payoutNumerators" },
      { name: "the resolved parent's numerators", target: (chain) => chain.parentMarket, read: "payoutNumerators" },
      { name: "one child's conditionId", target: (chain) => chain.childMarkets[2]!, read: "conditionId" },
      { name: "the parent's conditionId", target: (chain) => chain.parentMarket, read: "conditionId" },
      { name: "the parent's realityProxy", target: (chain) => chain.parentMarket, read: "realityProxy" },
      { name: "the parent's numOutcomes", target: (chain) => chain.parentMarket, read: "numOutcomes" },
      { name: "the parent's templateId", target: (chain) => chain.parentMarket, read: "templateId" },
      { name: "the SessionFactory's getSession", target: (chain) => chain.sessionFactory, read: "getSession" },
    ];

    it.each(failures)("rejects when $name reverts while the other reads succeed", async ({ target, read: failing }) => {
      const chain = createChain(3);
      chain.resolveParent([0, 1, 2]);
      chain.resolveChild(0, { value: parseEther("42") });
      await expect(read(chain)).resolves.toBeDefined();
      chain.fail(target(chain), failing);

      await expect(read(chain)).rejects.toThrow();
    });
  });

  describe("A6 the parent's outcome count comes from the parent market", () => {
    it("reads a phased session with only child 0 deployed: parent winners [1,2] give winners [1,2] and four numerators", async () => {
      const chain = createChain(3, { deployedChildren: 1 });
      chain.resolveParent([1, 2]);

      const resolution = await read(chain);

      expect(resolution.parent).toMatchObject({
        resolved: true,
        invalid: false,
        winningOutcomes: [1, 2],
        payoutNumerators: [0n, 1n, 1n, 0n],
        payoutDenominator: 2n,
      });
      expect(childKeys(resolution.children)).toEqual([0, 1, 2]);
      expect(resolution.children[0]).toMatchObject({ deployed: true, market: chain.childMarkets[0], resolved: false });
      expect(resolution.children[1]).toEqual({ deployed: false });
      expect(resolution.children[2]).toEqual({ deployed: false });
    });

    it("reads a resolved child of a phased session next to its undeployed siblings", async () => {
      const chain = createChain(3, { deployedChildren: 1 });
      chain.resolveParent([0]);
      chain.resolveChild(0, { value: parseEther("30") });

      const resolution = await read(chain, [0, 2]);

      expect(childKeys(resolution.children)).toEqual([0, 2]);
      expect(resolution.children[0]).toMatchObject({ deployed: true, resolved: true, finalValue: 30 });
      expect(resolution.children[2]).toEqual({ deployed: false });
    });

    it("reads the whole parent for a zero-child read, without touching any child", async () => {
      const chain = createChain(3);
      chain.resolveParent([0, 2]);
      for (const market of chain.childMarkets) {
        for (const failing of ["conditionId", "payoutDenominator", "lowerBound", "upperBound"] as const) {
          chain.fail(market, failing);
        }
      }

      const resolution = await read(chain, []);

      expect(resolution.parent).toMatchObject({
        resolved: true,
        invalid: false,
        winningOutcomes: [0, 2],
        payoutNumerators: [1n, 0n, 1n, 0n],
        payoutDenominator: 2n,
      });
      expect(resolution.children).toEqual({});
    });

    it("reads the whole parent of a session the factory holds no child for yet", async () => {
      const chain = createChain(2, { deployedChildren: 0 });
      chain.resolveParent([1]);

      const resolution = await read(chain);

      expect(resolution.parent).toMatchObject({
        resolved: true,
        invalid: false,
        winningOutcomes: [1],
        payoutNumerators: [0n, 1n, 0n],
        payoutDenominator: 1n,
      });
      expect(resolution.children).toEqual({ 0: { deployed: false }, 1: { deployed: false } });
    });

    it.each([2, 3, 5])("reads a categorical-template parent with %i options and one winner", async (count) => {
      const chain = createChain(count, { parentTemplate: SINGLE_SELECT_TEMPLATE });
      const winner = count - 1;
      chain.resolveParent([winner]);

      const resolution = await read(chain);

      const numerators = Array.from({ length: count + 1 }, (_, index) => (index === winner ? 1n : 0n));
      expect(resolution.parent).toMatchObject({
        resolved: true,
        invalid: false,
        winningOutcomes: [winner],
        payoutNumerators: numerators,
        payoutDenominator: 1n,
      });
    });

    it.each([MULTI_SELECT_TEMPLATE, SINGLE_SELECT_TEMPLATE])(
      "keeps numOutcomes() + 1 parent slots when only some children are asked for (template %i)",
      async (parentTemplate) => {
        const chain = createChain(4, { parentTemplate });
        chain.resolveParent([3]);

        const resolution = await read(chain, [1]);

        expect(resolution.parent).toMatchObject({ winningOutcomes: [3], payoutNumerators: [0n, 0n, 0n, 1n, 0n] });
      },
    );

    it.each([0, SCALAR_TEMPLATE, 4])(
      "rejects a parent whose template %i is not categorical",
      async (parentTemplate) => {
        const chain = createChain(2, { parentTemplate });
        chain.resolveParent([0]);

        await expect(read(chain)).rejects.toThrow();
      },
    );

    it("leaves out a deployed child the caller did not ask for, rather than calling it not deployed", async () => {
      const chain = createChain(3);
      chain.resolveParent([0, 1]);
      chain.resolveChild(1, { value: parseEther("12") });

      const resolution = await read(chain, [1]);

      expect(childKeys(resolution.children)).toEqual([1]);
      expect(resolution.children[0]).toBeUndefined();
      expect(resolution.children[2]).toBeUndefined();
      expect(resolution.children[1]).toMatchObject({
        deployed: true,
        market: chain.childMarkets[1],
        resolved: true,
        finalValue: 12,
      });
    });

    it("rejects, rather than marking children not deployed, when the SessionFactory read fails", async () => {
      const chain = createChain(3, { deployedChildren: 1 });
      await expect(read(chain)).resolves.toBeDefined();
      chain.fail(chain.sessionFactory, "getSession");

      await expect(read(chain)).rejects.toThrow();
      await expect(read(chain, [])).rejects.toThrow();
    });
  });

  describe("A7 the reads that must each count", () => {
    it("values each child against its own bounds, not child 0's", async () => {
      const chain = createChain(3, {
        bounds: [
          { lowerBound: 0n, upperBound: 10n * WAD },
          { lowerBound: 100n * WAD, upperBound: 200n * WAD },
          { lowerBound: 1_000n * WAD, upperBound: 5_000n * WAD },
        ],
      });
      chain.resolveParent([0, 1, 2]);
      chain.resolveChild(0, { value: 4n * WAD });
      chain.resolveChild(1, { value: 150n * WAD });
      chain.resolveChild(2, { value: 2_000n * WAD });

      const resolution = await read(chain);

      expect(resolution.children[0]).toMatchObject({ resolved: true, finalValue: 4 });
      expect(resolution.children[1]).toMatchObject({ resolved: true, finalValue: 150 });
      expect(resolution.children[2]).toMatchObject({ resolved: true, finalValue: 2_000 });
    });

    it("values a lone requested child against its own bounds", async () => {
      const chain = createChain(2, {
        bounds: [
          { lowerBound: 0n, upperBound: 100n * WAD },
          { lowerBound: 20n * WAD, upperBound: 60n * WAD },
        ],
      });
      chain.resolveParent([1]);
      chain.resolveChild(1, { value: 50n * WAD });

      const resolution = await read(chain, [1]);

      expect(resolution.children[1]).toMatchObject({ resolved: true, finalValue: 50 });
    });

    it.each([
      { winners: [3], outcomes: 3, numerators: [0n, 0n, 0n, 1n] },
      { winners: [2], outcomes: 2, numerators: [0n, 0n, 1n] },
    ])(
      "reports a parent resolved INVALID through its invalid flag, with no winning option ($outcomes options)",
      async ({ winners, outcomes, numerators }) => {
        const chain = createChain(outcomes);
        chain.resolveParent(winners);

        const resolution = await read(chain);

        expect(resolution.parent).toMatchObject({
          resolved: true,
          invalid: true,
          winningOutcomes: [],
          payoutNumerators: numerators,
          payoutDenominator: 1n,
        });
      },
    );

    it("keeps a winning option and sets the invalid flag when INVALID also pays", async () => {
      const chain = createChain(3, { parentTemplate: MULTI_SELECT_TEMPLATE });
      chain.resolveParent([1, 3]);

      const resolution = await read(chain);

      expect(resolution.parent).toMatchObject({ resolved: true, invalid: true, winningOutcomes: [1] });
    });

    it.each([
      { lower: 50n, upper: 150n, value: 120n },
      { lower: 1_000n, upper: 1_100n, value: 1_001n },
      { lower: 7n, upper: 9n, value: 8n },
    ])("adds the lower bound to the final value ($lower to $upper, value $value)", async ({ lower, upper, value }) => {
      const chain = createChain(1, { bounds: [{ lowerBound: lower * WAD, upperBound: upper * WAD }] });
      chain.resolveParent([0]);
      chain.resolveChild(0, { value: value * WAD });

      const resolution = await read(chain);

      expect(resolution.children[0]).toMatchObject({ resolved: true, finalValue: Number(value) });
    });

    it("rejects when the RealityProxy's conditionalTokens read fails, for a resolved and an unresolved session", async () => {
      for (const resolve of [true, false]) {
        const chain = createChain(2);
        if (resolve) {
          chain.resolveParent([0]);
          chain.resolveChild(0, { value: parseEther("5") });
        }
        await expect(read(chain)).resolves.toBeDefined();
        chain.fail(REALITY_PROXY, "conditionalTokens");

        await expect(read(chain)).rejects.toThrow();
      }
    });

    it.each(["lowerBound", "upperBound"] as const)(
      "rejects when a resolved child's %s read fails, rather than valuing it from zero",
      async (bound) => {
        const chain = createChain(2, {
          bounds: [
            { lowerBound: 10n * WAD, upperBound: 20n * WAD },
            { lowerBound: 30n * WAD, upperBound: 90n * WAD },
          ],
        });
        chain.resolveParent([0, 1]);
        chain.resolveChild(1, { value: 60n * WAD });
        await expect(read(chain)).resolves.toBeDefined();
        chain.fail(chain.childMarkets[1]!, bound);

        await expect(read(chain)).rejects.toThrow();
        await expect(read(chain, [1])).rejects.toThrow();
      },
    );
  });
});
