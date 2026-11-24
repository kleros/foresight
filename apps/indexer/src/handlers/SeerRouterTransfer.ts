import { indexer } from "envio";

import { notePull, noteReturn } from "../utils/redeem";
import { isRouter, ROUTER_TRANSFERS } from "../utils/routers";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// A registration of its own: the trade wallets' `where` names the executors, these name the routers.
indexer.onEvent(
  { contract: "TradeExecutor", event: "Transfer", wildcard: true, where: ROUTER_TRANSFERS },
  async ({ event, context }) => {
    const [from, to] = [event.params.from.toLowerCase(), event.params.to.toLowerCase()];
    // mints to and burns from a router are its own wrapping, not an account's
    const pull = isRouter(to) && !isRouter(from) && from !== ZERO_ADDRESS;
    const answer = isRouter(from) && !isRouter(to) && to !== ZERO_ADDRESS;
    if (!pull && !answer) return;

    const [account, router] = pull ? [from, to] : [to, from];
    // a trade wallet's transfers are its own handler's, which keeps its ledger in step
    if ((await context.Executor.get(account)) !== undefined || context.isPreload) return;

    const move = {
      account,
      router,
      token: event.srcAddress.toLowerCase(),
      value: event.params.value,
      hash: event.transaction.hash,
      logIndex: event.logIndex,
      block: event.block,
      tradeWallet: false,
    };
    await (pull ? notePull : noteReturn)(context, move);
  },
);
