import { indexer } from "envio";

import { SEER_ROUTERS, trackRedeem } from "../utils/redeem";

// Its own registration: envio drops static address groups from a `where` that also filters on contract addresses.
indexer.onEvent(
  {
    contract: "TradeExecutor",
    event: "Transfer",
    wildcard: true,
    where: { params: [{ from: SEER_ROUTERS }, { to: SEER_ROUTERS }] },
  },
  async ({ event, context }) => {
    const { value } = event.params;
    const [from, to] = [event.params.from.toLowerCase(), event.params.to.toLowerCase()];
    if (from === to || value === 0n) return;

    await trackRedeem({ context, event, token: event.srcAddress.toLowerCase(), from, to, value });
  },
);
