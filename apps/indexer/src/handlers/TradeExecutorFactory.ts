import { indexer } from "envio";

indexer.contractRegister(
  { contract: "TradeExecutorFactory", event: "ExecutorDeployed" },
  async ({ event, context }) => {
    context.chain.TradeExecutor.add(event.params.executor);
  },
);

indexer.onEvent({ contract: "TradeExecutorFactory", event: "ExecutorDeployed" }, async ({ event, context }) => {
  context.Executor.set({
    id: event.params.executor.toLowerCase(),
    owner: event.params.owner.toLowerCase(),
    deployedAt: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  });
});
