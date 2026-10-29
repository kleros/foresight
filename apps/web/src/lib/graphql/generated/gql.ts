/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  query SessionPools($sessionId: String!) {\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } } }) {\n      id\n      childMarket_id\n      outcomeIndex\n      outcomeIsToken0\n    }\n  }\n": typeof types.SessionPoolsDocument,
    "\n  query SessionIndexed($id: String!) {\n    Session(where: { id: { _eq: $id } }, limit: 1) {\n      id\n      children {\n        id\n      }\n    }\n  }\n": typeof types.SessionIndexedDocument,
    "\n  query SessionByMetadata($deployer: String!, $metadataUri: String!, $since: numeric!) {\n    Session(\n      where: { deployer: { _eq: $deployer }, metadataUri: { _eq: $metadataUri }, openedAt: { _gte: $since } }\n      order_by: { openedAt: desc }\n      limit: 1\n    ) {\n      sessionId\n      parentMarket\n      transactionHash\n      children(order_by: { parentOutcomeIndex: asc }) {\n        id\n        parentOutcomeIndex\n        transactionHash\n      }\n    }\n    chain_metadata {\n      latest_processed_block\n      block_height\n    }\n  }\n": typeof types.SessionByMetadataDocument,
    "\n  query SessionDetail($parentMarket: String!) {\n    Session(where: { parentMarket: { _eq: $parentMarket } }, limit: 1) {\n      id\n      parentMarket\n      deployer\n      marketName\n      title\n      description\n      icon\n      heroImage\n      itemName\n      itemNamePlural\n      metadataResolved\n      outcomeCount\n      deployedChildCount\n      invalidToken\n      collateralToken\n      collateralDecimals\n      collateralSymbol\n      openedAt\n      completedAt\n      openingTime\n      blocks\n      children(order_by: { parentOutcomeIndex: asc }) {\n        id\n        parentOutcomeIndex\n        parentOutcome\n        marketName\n        lowerBound\n        upperBound\n        displayName\n        color\n        blocks\n        upToken\n        downToken\n        invalidToken\n        underlyingToken\n      }\n    }\n  }\n": typeof types.SessionDetailDocument,
    "\n  query SessionChart($sessionId: String!, $upOutcome: Int!) {\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } }, outcomeIndex: { _eq: $upOutcome } }) {\n      id\n      childMarket_id\n      underlyingPerOutcome\n      updatedAt\n      swaps(order_by: [{ timestamp: asc }, { logIndex: asc }]) {\n        underlyingPerOutcomeAfter\n        timestamp\n      }\n    }\n  }\n": typeof types.SessionChartDocument,
    "\n  query SessionStats($sessionId: String!) {\n    Prediction(\n      where: { childMarket: { session_id: { _eq: $sessionId } } }\n      distinct_on: executor_id\n      order_by: { executor_id: asc }\n    ) {\n      executor_id\n    }\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } } }) {\n      id\n      childMarket_id\n      outcomeToken\n      underlyingToken\n      outcomeIndex\n      underlyingPerOutcome\n      volumeUnderlying\n      volumeOutcome\n    }\n  }\n": typeof types.SessionStatsDocument,
    "\n  query Sessions($limit: Int!, $offset: Int!, $where: Session_bool_exp!) {\n    SessionCounter {\n      count\n    }\n    Session(where: $where, order_by: { openedAt: desc }, limit: $limit, offset: $offset) {\n      id\n      parentMarket\n      deployer\n      marketName\n      title\n      description\n      icon\n      heroImage\n      itemNamePlural\n      outcomeCount\n      keyword\n      openingTime\n    }\n  }\n": typeof types.SessionsDocument,
};
const documents: Documents = {
    "\n  query SessionPools($sessionId: String!) {\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } } }) {\n      id\n      childMarket_id\n      outcomeIndex\n      outcomeIsToken0\n    }\n  }\n": types.SessionPoolsDocument,
    "\n  query SessionIndexed($id: String!) {\n    Session(where: { id: { _eq: $id } }, limit: 1) {\n      id\n      children {\n        id\n      }\n    }\n  }\n": types.SessionIndexedDocument,
    "\n  query SessionByMetadata($deployer: String!, $metadataUri: String!, $since: numeric!) {\n    Session(\n      where: { deployer: { _eq: $deployer }, metadataUri: { _eq: $metadataUri }, openedAt: { _gte: $since } }\n      order_by: { openedAt: desc }\n      limit: 1\n    ) {\n      sessionId\n      parentMarket\n      transactionHash\n      children(order_by: { parentOutcomeIndex: asc }) {\n        id\n        parentOutcomeIndex\n        transactionHash\n      }\n    }\n    chain_metadata {\n      latest_processed_block\n      block_height\n    }\n  }\n": types.SessionByMetadataDocument,
    "\n  query SessionDetail($parentMarket: String!) {\n    Session(where: { parentMarket: { _eq: $parentMarket } }, limit: 1) {\n      id\n      parentMarket\n      deployer\n      marketName\n      title\n      description\n      icon\n      heroImage\n      itemName\n      itemNamePlural\n      metadataResolved\n      outcomeCount\n      deployedChildCount\n      invalidToken\n      collateralToken\n      collateralDecimals\n      collateralSymbol\n      openedAt\n      completedAt\n      openingTime\n      blocks\n      children(order_by: { parentOutcomeIndex: asc }) {\n        id\n        parentOutcomeIndex\n        parentOutcome\n        marketName\n        lowerBound\n        upperBound\n        displayName\n        color\n        blocks\n        upToken\n        downToken\n        invalidToken\n        underlyingToken\n      }\n    }\n  }\n": types.SessionDetailDocument,
    "\n  query SessionChart($sessionId: String!, $upOutcome: Int!) {\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } }, outcomeIndex: { _eq: $upOutcome } }) {\n      id\n      childMarket_id\n      underlyingPerOutcome\n      updatedAt\n      swaps(order_by: [{ timestamp: asc }, { logIndex: asc }]) {\n        underlyingPerOutcomeAfter\n        timestamp\n      }\n    }\n  }\n": types.SessionChartDocument,
    "\n  query SessionStats($sessionId: String!) {\n    Prediction(\n      where: { childMarket: { session_id: { _eq: $sessionId } } }\n      distinct_on: executor_id\n      order_by: { executor_id: asc }\n    ) {\n      executor_id\n    }\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } } }) {\n      id\n      childMarket_id\n      outcomeToken\n      underlyingToken\n      outcomeIndex\n      underlyingPerOutcome\n      volumeUnderlying\n      volumeOutcome\n    }\n  }\n": types.SessionStatsDocument,
    "\n  query Sessions($limit: Int!, $offset: Int!, $where: Session_bool_exp!) {\n    SessionCounter {\n      count\n    }\n    Session(where: $where, order_by: { openedAt: desc }, limit: $limit, offset: $offset) {\n      id\n      parentMarket\n      deployer\n      marketName\n      title\n      description\n      icon\n      heroImage\n      itemNamePlural\n      outcomeCount\n      keyword\n      openingTime\n    }\n  }\n": types.SessionsDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SessionPools($sessionId: String!) {\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } } }) {\n      id\n      childMarket_id\n      outcomeIndex\n      outcomeIsToken0\n    }\n  }\n"): (typeof documents)["\n  query SessionPools($sessionId: String!) {\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } } }) {\n      id\n      childMarket_id\n      outcomeIndex\n      outcomeIsToken0\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SessionIndexed($id: String!) {\n    Session(where: { id: { _eq: $id } }, limit: 1) {\n      id\n      children {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  query SessionIndexed($id: String!) {\n    Session(where: { id: { _eq: $id } }, limit: 1) {\n      id\n      children {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SessionByMetadata($deployer: String!, $metadataUri: String!, $since: numeric!) {\n    Session(\n      where: { deployer: { _eq: $deployer }, metadataUri: { _eq: $metadataUri }, openedAt: { _gte: $since } }\n      order_by: { openedAt: desc }\n      limit: 1\n    ) {\n      sessionId\n      parentMarket\n      transactionHash\n      children(order_by: { parentOutcomeIndex: asc }) {\n        id\n        parentOutcomeIndex\n        transactionHash\n      }\n    }\n    chain_metadata {\n      latest_processed_block\n      block_height\n    }\n  }\n"): (typeof documents)["\n  query SessionByMetadata($deployer: String!, $metadataUri: String!, $since: numeric!) {\n    Session(\n      where: { deployer: { _eq: $deployer }, metadataUri: { _eq: $metadataUri }, openedAt: { _gte: $since } }\n      order_by: { openedAt: desc }\n      limit: 1\n    ) {\n      sessionId\n      parentMarket\n      transactionHash\n      children(order_by: { parentOutcomeIndex: asc }) {\n        id\n        parentOutcomeIndex\n        transactionHash\n      }\n    }\n    chain_metadata {\n      latest_processed_block\n      block_height\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SessionDetail($parentMarket: String!) {\n    Session(where: { parentMarket: { _eq: $parentMarket } }, limit: 1) {\n      id\n      parentMarket\n      deployer\n      marketName\n      title\n      description\n      icon\n      heroImage\n      itemName\n      itemNamePlural\n      metadataResolved\n      outcomeCount\n      deployedChildCount\n      invalidToken\n      collateralToken\n      collateralDecimals\n      collateralSymbol\n      openedAt\n      completedAt\n      openingTime\n      blocks\n      children(order_by: { parentOutcomeIndex: asc }) {\n        id\n        parentOutcomeIndex\n        parentOutcome\n        marketName\n        lowerBound\n        upperBound\n        displayName\n        color\n        blocks\n        upToken\n        downToken\n        invalidToken\n        underlyingToken\n      }\n    }\n  }\n"): (typeof documents)["\n  query SessionDetail($parentMarket: String!) {\n    Session(where: { parentMarket: { _eq: $parentMarket } }, limit: 1) {\n      id\n      parentMarket\n      deployer\n      marketName\n      title\n      description\n      icon\n      heroImage\n      itemName\n      itemNamePlural\n      metadataResolved\n      outcomeCount\n      deployedChildCount\n      invalidToken\n      collateralToken\n      collateralDecimals\n      collateralSymbol\n      openedAt\n      completedAt\n      openingTime\n      blocks\n      children(order_by: { parentOutcomeIndex: asc }) {\n        id\n        parentOutcomeIndex\n        parentOutcome\n        marketName\n        lowerBound\n        upperBound\n        displayName\n        color\n        blocks\n        upToken\n        downToken\n        invalidToken\n        underlyingToken\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SessionChart($sessionId: String!, $upOutcome: Int!) {\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } }, outcomeIndex: { _eq: $upOutcome } }) {\n      id\n      childMarket_id\n      underlyingPerOutcome\n      updatedAt\n      swaps(order_by: [{ timestamp: asc }, { logIndex: asc }]) {\n        underlyingPerOutcomeAfter\n        timestamp\n      }\n    }\n  }\n"): (typeof documents)["\n  query SessionChart($sessionId: String!, $upOutcome: Int!) {\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } }, outcomeIndex: { _eq: $upOutcome } }) {\n      id\n      childMarket_id\n      underlyingPerOutcome\n      updatedAt\n      swaps(order_by: [{ timestamp: asc }, { logIndex: asc }]) {\n        underlyingPerOutcomeAfter\n        timestamp\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SessionStats($sessionId: String!) {\n    Prediction(\n      where: { childMarket: { session_id: { _eq: $sessionId } } }\n      distinct_on: executor_id\n      order_by: { executor_id: asc }\n    ) {\n      executor_id\n    }\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } } }) {\n      id\n      childMarket_id\n      outcomeToken\n      underlyingToken\n      outcomeIndex\n      underlyingPerOutcome\n      volumeUnderlying\n      volumeOutcome\n    }\n  }\n"): (typeof documents)["\n  query SessionStats($sessionId: String!) {\n    Prediction(\n      where: { childMarket: { session_id: { _eq: $sessionId } } }\n      distinct_on: executor_id\n      order_by: { executor_id: asc }\n    ) {\n      executor_id\n    }\n    Pool(where: { childMarket: { session_id: { _eq: $sessionId } } }) {\n      id\n      childMarket_id\n      outcomeToken\n      underlyingToken\n      outcomeIndex\n      underlyingPerOutcome\n      volumeUnderlying\n      volumeOutcome\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Sessions($limit: Int!, $offset: Int!, $where: Session_bool_exp!) {\n    SessionCounter {\n      count\n    }\n    Session(where: $where, order_by: { openedAt: desc }, limit: $limit, offset: $offset) {\n      id\n      parentMarket\n      deployer\n      marketName\n      title\n      description\n      icon\n      heroImage\n      itemNamePlural\n      outcomeCount\n      keyword\n      openingTime\n    }\n  }\n"): (typeof documents)["\n  query Sessions($limit: Int!, $offset: Int!, $where: Session_bool_exp!) {\n    SessionCounter {\n      count\n    }\n    Session(where: $where, order_by: { openedAt: desc }, limit: $limit, offset: $offset) {\n      id\n      parentMarket\n      deployer\n      marketName\n      title\n      description\n      icon\n      heroImage\n      itemNamePlural\n      outcomeCount\n      keyword\n      openingTime\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;