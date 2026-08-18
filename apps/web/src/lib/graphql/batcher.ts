import { createBatchingExecutor } from "@graphql-tools/batch-execute";
import type { AsyncExecutor, ExecutionResult } from "@graphql-tools/utils";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { create, windowedFiniteBatchScheduler } from "@yornaath/batshit";
import { request, type Variables } from "graphql-request";

import { debouncedErrorToast } from "@/utils/toast";

import { env } from "@/config/env";

/**
 * Batches subgraph queries into a single HTTP request.
 */

type BatchedQuery = {
  id: string;
  document: TypedDocumentNode<unknown, Record<string, unknown>>;
  variables: Record<string, unknown>;
};

const SUBGRAPH_ERROR = "Could not load session data. Try again in a moment.";

const executor: AsyncExecutor = async ({ document, variables }) => {
  try {
    const data = await request<unknown, Variables>(
      env.SUBGRAPH_URL,
      document as TypedDocumentNode<unknown, Variables>,
      (variables ?? {}) as Variables,
    );

    return { data } as ExecutionResult;
  } catch (error) {
    console.error("Subgraph error:", error);
    debouncedErrorToast(SUBGRAPH_ERROR);

    throw error;
  }
};

const batchExecutor = createBatchingExecutor(executor);

const batcher = create<{ id: string; result: unknown }[], BatchedQuery, unknown>({
  fetcher: async (queries) => {
    const results = await Promise.all(queries.map(({ document, variables }) => batchExecutor({ document, variables })));

    return results.map((result, index) => ({
      id: queries[index]!.id,
      result: (result as ExecutionResult).data,
    }));
  },
  resolver: (results, query) => results.find(({ id }) => id === query.id)?.result,
  scheduler: windowedFiniteBatchScheduler({ windowMs: 100, maxBatchSize: 5 }),
});

/**
 * Queries the subgraph, batched with anything else asked for at
 * the same moment.
 * Use it as a react-query `queryFn`.
 *
 * @example
 * useQuery({ queryKey: ["sessions"], queryFn: () => fetchGraphql(sessionsQuery) })
 */
export const fetchGraphql = async <TResult, TVariables extends Record<string, unknown>>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables?: TVariables,
): Promise<TResult> =>
  batcher.fetch({
    // the id is how a batched result finds its way back to this caller
    id: crypto.randomUUID(),
    document: document as BatchedQuery["document"],
    variables: variables ?? {},
  }) as Promise<TResult>;

export type GraphqlFetch = typeof fetchGraphql;
