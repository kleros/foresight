// Envio 3.4.0 modules that parse an onEvent `where`; the package ships no types for them.

declare module "envio/src/LogSelection.res.mjs" {
  type TopicGetter = (filter: Record<string, unknown>) => string[];
  export function parseWhereOrThrow(
    where: unknown,
    sighash: string,
    params: string[],
    contractName: string,
    chainId: number,
    onEventBlockFilterSchema: unknown,
    topic1?: TopicGetter,
    topic2?: TopicGetter,
    topic3?: TopicGetter,
  ): { resolvedWhere: { topicSelections: unknown[] }; filterByAddresses: boolean };
  export function materializeTopicSelections(
    topicSelections: unknown[],
    addresses: string[],
  ): { topic0: string[]; topic1: string[]; topic2: string[]; topic3: string[] }[];
}

declare module "envio/src/EventConfigBuilder.res.mjs" {
  export function buildTopicGetter(param: {
    name: string;
    abiType: string;
  }): (filter: Record<string, unknown>) => string[];
}

declare module "envio/src/sources/Evm.res.mjs" {
  export function make(logger: unknown): { onEventBlockFilterSchema: unknown };
}
