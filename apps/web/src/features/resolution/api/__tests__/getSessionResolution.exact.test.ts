import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { fetchSessionResolution } from "../getSessionResolution";
import { createChain, SINGLE_SELECT_TEMPLATE, WAD, type Chain } from "./support/chain";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const read = (chain: Chain, parentOutcomes?: number[]) =>
  fetchSessionResolution(chain.client, parentOutcomes ? { ...chain.session, parentOutcomes } : chain.session);

describe("fetchSessionResolution, exact shapes", () => {
  describe("A6 / A9 the parent's outcome count is numOutcomes(), not the factory's expectedChildCount", () => {
    it.each([0, 1, 2, 4, 5])(
      "reads 3 options and 4 numerators when the factory reports expectedChildCount %i",
      async (expectedChildCount) => {
        const chain = createChain(3, { expectedChildCount });
        chain.resolveParent([1, 2]);

        const resolution = await read(chain);

        expect(resolution.parent).toStrictEqual({
          resolved: true,
          invalid: false,
          winningOutcomes: [1, 2],
          payoutNumerators: [0n, 1n, 1n, 0n],
          payoutDenominator: 2n,
        });
        expect(Object.keys(resolution.children).sort()).toEqual(["0", "1", "2"]);
      },
    );

    it("reads a phased categorical parent's last option as a winner when expectedChildCount is lower", async () => {
      const chain = createChain(4, { deployedChildren: 1, expectedChildCount: 2, parentTemplate: SINGLE_SELECT_TEMPLATE });
      chain.resolveParent([3]);

      const resolution = await read(chain, []);

      expect(resolution.parent).toStrictEqual({
        resolved: true,
        invalid: false,
        winningOutcomes: [3],
        payoutNumerators: [0n, 0n, 0n, 1n, 0n],
        payoutDenominator: 1n,
      });
      expect(resolution.children).toStrictEqual({});
    });
  });

  describe("A2 / A9 an unresolved session carries no payout fields at all", () => {
    it.each([1, 2, 4])("returns the parent as exactly { resolved: false }, with %i options", async (count) => {
      const chain = createChain(count);

      const resolution = await read(chain);

      expect(resolution.parent).toStrictEqual({ resolved: false });
      chain.childMarkets.forEach((market, index) =>
        expect(resolution.children[index]).toStrictEqual({ deployed: true, market, resolved: false }),
      );
    });

    it("returns an unresolved parent as exactly { resolved: false } while a child has resolved", async () => {
      const chain = createChain(2);
      chain.resolveChild(0, { value: 30n * WAD });

      const resolution = await read(chain);

      expect(resolution.parent).toStrictEqual({ resolved: false });
      expect(resolution.children[1]).toStrictEqual({ deployed: true, market: chain.childMarkets[1], resolved: false });
    });

    it("returns undeployed children of a phased session as exactly { deployed: false }", async () => {
      const chain = createChain(3, { deployedChildren: 1 });

      const resolution = await read(chain);

      expect(resolution.parent).toStrictEqual({ resolved: false });
      expect(resolution.children).toStrictEqual({
        0: { deployed: true, market: chain.childMarkets[0], resolved: false },
        1: { deployed: false },
        2: { deployed: false },
      });
    });
  });

  describe("A7 / A9 the final value starts at the child's lower bound", () => {
    it("values three children with non-zero lower bounds at their exact answers", async () => {
      const chain = createChain(3, {
        bounds: [
          { lowerBound: 40n * WAD, upperBound: 60n * WAD },
          { lowerBound: 1n * WAD, upperBound: 3n * WAD },
          { lowerBound: 900n * WAD, upperBound: 1_000n * WAD },
        ],
      });
      chain.resolveParent([0, 1, 2]);
      chain.resolveChild(0, { value: 55n * WAD });
      chain.resolveChild(1, { value: 2n * WAD });
      chain.resolveChild(2, { value: 901n * WAD });

      const resolution = await read(chain);

      expect(resolution.children[0]).toMatchObject({ resolved: true, invalid: false, finalValue: 55 });
      expect(resolution.children[1]).toMatchObject({ resolved: true, invalid: false, finalValue: 2 });
      expect(resolution.children[2]).toMatchObject({ resolved: true, invalid: false, finalValue: 901 });
    });

    it("values a child at its lower bound as the lower bound, not zero", async () => {
      const chain = createChain(1, { bounds: [{ lowerBound: 25n * WAD, upperBound: 75n * WAD }] });
      chain.resolveParent([0]);
      chain.resolveChild(0, { value: 25n * WAD });

      const resolution = await read(chain);

      expect(resolution.children[0]).toMatchObject({ resolved: true, invalid: false, finalValue: 25 });
    });

    it("shifts the final value by exactly the shift applied to both bounds and the answer", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 1n, max: 1_000n }),
          fc.bigInt({ min: 0n, max: 1_000n }),
          fc.bigInt({ min: 1n, max: 1_000n }),
          async (span, offset, shift) => {
            const value = offset % (span + 1n);
            const base = createChain(1, { bounds: [{ lowerBound: 0n, upperBound: span * WAD }] });
            const shifted = createChain(1, {
              bounds: [{ lowerBound: shift * WAD, upperBound: (shift + span) * WAD }],
            });
            for (const [chain, answer] of [
              [base, value],
              [shifted, shift + value],
            ] as const) {
              chain.resolveParent([0]);
              chain.resolveChild(0, { value: answer * WAD });
            }

            const [atZero, atShift] = await Promise.all([read(base), read(shifted)]);

            const finalValue = (child: unknown) => (child as { finalValue: number }).finalValue;
            expect(finalValue(atZero.children[0])).toBe(Number(value));
            expect(finalValue(atShift.children[0])).toBe(Number(shift + value));
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
