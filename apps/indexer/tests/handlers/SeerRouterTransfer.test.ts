import { describe, it, vi } from "vitest";

import { CONDITIONAL_ROUTER, GNOSIS_ROUTER } from "../support/redeem";

// The test indexer feeds simulated events straight to the handler, so the registration's `where` is read here.
const registered = vi.hoisted(() => [] as { where?: { params: Record<string, readonly string[]>[] } }[]);
vi.mock("envio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("envio")>()),
  indexer: { onEvent: (options: (typeof registered)[number]) => registered.push(options) },
}));

await import("../../src/handlers/SeerRouterTransfer");

const HOLDER = "0x00000000000000000000000000000000000000e1";
const STRANGER = "0x0000000000000000000000000000000000000e02";

/** Whether a Transfer from `from` to `to` passes the registration's filter: any one group of params matching. */
const passes = (from: string, to: string) =>
  registered[0]!.where!.params.some((group) =>
    Object.entries(group).every(([param, addresses]) => addresses.includes(param === "from" ? from : to)),
  );

describe("the Seer router Transfer registration", () => {
  it.for([GNOSIS_ROUTER, CONDITIONAL_ROUTER])("lets through a pull into and a payout from %s", (router, t) => {
    t.expect(registered).toHaveLength(1);
    t.expect(passes(HOLDER, router)).toBe(true);
    t.expect(passes(router, HOLDER)).toBe(true);
  });

  it("filters out a transfer that touches no router", (t) => {
    t.expect(passes(HOLDER, STRANGER)).toBe(false);
  });
});
