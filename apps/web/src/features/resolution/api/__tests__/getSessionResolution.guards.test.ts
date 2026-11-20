import { describe, expect, it, vi } from "vitest";

import { fetchSessionResolution } from "../getSessionResolution";
import { createChain } from "./support/chain";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

describe("fetchSessionResolution request guards", () => {
  it("rejects a session id the factory does not hold", async () => {
    const chain = createChain(2);

    await expect(fetchSessionResolution(chain.client, { ...chain.session, sessionId: 99n })).rejects.toThrow(
      "does not exist",
    );
  });

  it.each([[[2]], [[-1]], [[0.5]]])(
    "rejects parent outcomes %j outside the parent's options rather than calling them not deployed",
    async (parentOutcomes) => {
      const chain = createChain(2, { deployedChildren: 1 });

      await expect(fetchSessionResolution(chain.client, { ...chain.session, parentOutcomes })).rejects.toThrow(
        RangeError,
      );
    },
  );
});
