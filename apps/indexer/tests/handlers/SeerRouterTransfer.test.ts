import { buildTopicGetter } from "envio/src/EventConfigBuilder.res.mjs";
import { materializeTopicSelections, parseWhereOrThrow } from "envio/src/LogSelection.res.mjs";
import { make as evmEcosystem } from "envio/src/sources/Evm.res.mjs";
import { pad, toEventSelector } from "viem";
import { describe, it, vi } from "vitest";

import { SEER_ROUTERS } from "../../src/utils/routers";

const registered = vi.hoisted(() => [] as { contract: string; event: string; wildcard?: boolean; where?: unknown }[]);

vi.mock("envio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("envio")>()),
  indexer: { onEvent: (options: (typeof registered)[number]) => registered.push(options) },
}));

await import("../../src/handlers/SeerRouterTransfer");

const TRANSFER = toEventSelector("Transfer(address,address,uint256)");
const ROUTER_TOPICS = SEER_ROUTERS.map((router) => pad(router).toLowerCase());

/** Envio's own reading of a `where`: one topic selection per entry, `[]` matching any value. */
function topicSelections(where: unknown) {
  const { resolvedWhere } = parseWhereOrThrow(
    where,
    TRANSFER,
    ["from", "to"],
    "TradeExecutor",
    100,
    evmEcosystem(undefined).onEventBlockFilterSchema,
    buildTopicGetter({ name: "from", abiType: "address" }),
    buildTopicGetter({ name: "to", abiType: "address" }),
  );
  return materializeTopicSelections(resolvedWhere.topicSelections, []).map(({ topic1, topic2 }) => ({
    from: topic1.map((topic) => topic.toLowerCase()),
    to: topic2.map((topic) => topic.toLowerCase()),
  }));
}

describe("the router registration", () => {
  it("follows every ERC-20 transfer into and out of both of Seer's routers", (t) => {
    t.expect(registered).toHaveLength(1);
    const [options] = registered;
    t.expect(options).toMatchObject({ contract: "TradeExecutor", event: "Transfer", wildcard: true });

    const selections = topicSelections(options!.where);
    t.expect(selections).toHaveLength(2);
    t.expect(selections).toContainEqual({ from: ROUTER_TOPICS, to: [] });
    t.expect(selections).toContainEqual({ from: [], to: ROUTER_TOPICS });
  });
});
