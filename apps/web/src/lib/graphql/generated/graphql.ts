/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  bigint: { input: string; output: string; }
  jsonb: { input: unknown; output: unknown; }
  numeric: { input: string; output: string; }
  timestamptz: { input: string; output: string; }
};

/** Boolean expression to compare columns of type "Boolean". All fields are combined with logical 'AND'. */
export type Boolean_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['Boolean']['input']>;
  _gt?: InputMaybe<Scalars['Boolean']['input']>;
  _gte?: InputMaybe<Scalars['Boolean']['input']>;
  _in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Boolean']['input']>;
  _lte?: InputMaybe<Scalars['Boolean']['input']>;
  _neq?: InputMaybe<Scalars['Boolean']['input']>;
  _nin?: InputMaybe<Array<Scalars['Boolean']['input']>>;
};

/** columns and relationships of "ChildMarket" */
export type ChildMarket = {
  __typename?: 'ChildMarket';
  /** everything a child says beyond its name and colour */
  blocks: Scalars['jsonb']['output'];
  color?: Maybe<Scalars['String']['output']>;
  deployedAt: Scalars['numeric']['output'];
  /** resolved from the session's metadata document, keyed by parentOutcomeIndex */
  displayName?: Maybe<Scalars['String']['output']>;
  downToken: Scalars['String']['output'];
  /** child market address */
  id: Scalars['String']['output'];
  keyword: Scalars['String']['output'];
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound: Scalars['numeric']['output'];
  /** read from the Seer child market */
  marketName: Scalars['String']['output'];
  parentOutcome: Scalars['String']['output'];
  parentOutcomeIndex: Scalars['numeric']['output'];
  /** An array relationship */
  pools: Array<Pool>;
  /** An array relationship */
  predictions: Array<Prediction>;
  /** An object relationship */
  session?: Maybe<Session>;
  session_id: Scalars['String']['output'];
  /** An array relationship */
  tokens: Array<Token>;
  transactionHash: Scalars['String']['output'];
  underlyingToken: Scalars['String']['output'];
  upToken: Scalars['String']['output'];
  upperBound: Scalars['numeric']['output'];
};


/** columns and relationships of "ChildMarket" */
export type ChildMarketBlocksArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};


/** columns and relationships of "ChildMarket" */
export type ChildMarketPoolsArgs = {
  distinct_on?: InputMaybe<Array<Pool_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Pool_Order_By>>;
  where?: InputMaybe<Pool_Bool_Exp>;
};


/** columns and relationships of "ChildMarket" */
export type ChildMarketPredictionsArgs = {
  distinct_on?: InputMaybe<Array<Prediction_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Prediction_Order_By>>;
  where?: InputMaybe<Prediction_Bool_Exp>;
};


/** columns and relationships of "ChildMarket" */
export type ChildMarketTokensArgs = {
  distinct_on?: InputMaybe<Array<Token_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Token_Order_By>>;
  where?: InputMaybe<Token_Bool_Exp>;
};

/** order by aggregate values of table "ChildMarket" */
export type ChildMarket_Aggregate_Order_By = {
  avg?: InputMaybe<ChildMarket_Avg_Order_By>;
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<ChildMarket_Max_Order_By>;
  min?: InputMaybe<ChildMarket_Min_Order_By>;
  stddev?: InputMaybe<ChildMarket_Stddev_Order_By>;
  stddev_pop?: InputMaybe<ChildMarket_Stddev_Pop_Order_By>;
  stddev_samp?: InputMaybe<ChildMarket_Stddev_Samp_Order_By>;
  sum?: InputMaybe<ChildMarket_Sum_Order_By>;
  var_pop?: InputMaybe<ChildMarket_Var_Pop_Order_By>;
  var_samp?: InputMaybe<ChildMarket_Var_Samp_Order_By>;
  variance?: InputMaybe<ChildMarket_Variance_Order_By>;
};

/** order by avg() on columns of table "ChildMarket" */
export type ChildMarket_Avg_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** Boolean expression to filter rows from the table "ChildMarket". All fields are combined with a logical 'AND'. */
export type ChildMarket_Bool_Exp = {
  _and?: InputMaybe<Array<ChildMarket_Bool_Exp>>;
  _not?: InputMaybe<ChildMarket_Bool_Exp>;
  _or?: InputMaybe<Array<ChildMarket_Bool_Exp>>;
  blocks?: InputMaybe<Jsonb_Comparison_Exp>;
  color?: InputMaybe<String_Comparison_Exp>;
  deployedAt?: InputMaybe<Numeric_Comparison_Exp>;
  displayName?: InputMaybe<String_Comparison_Exp>;
  downToken?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  keyword?: InputMaybe<String_Comparison_Exp>;
  lowerBound?: InputMaybe<Numeric_Comparison_Exp>;
  marketName?: InputMaybe<String_Comparison_Exp>;
  parentOutcome?: InputMaybe<String_Comparison_Exp>;
  parentOutcomeIndex?: InputMaybe<Numeric_Comparison_Exp>;
  pools?: InputMaybe<Pool_Bool_Exp>;
  predictions?: InputMaybe<Prediction_Bool_Exp>;
  session?: InputMaybe<Session_Bool_Exp>;
  session_id?: InputMaybe<String_Comparison_Exp>;
  tokens?: InputMaybe<Token_Bool_Exp>;
  transactionHash?: InputMaybe<String_Comparison_Exp>;
  underlyingToken?: InputMaybe<String_Comparison_Exp>;
  upToken?: InputMaybe<String_Comparison_Exp>;
  upperBound?: InputMaybe<Numeric_Comparison_Exp>;
};

/** order by max() on columns of table "ChildMarket" */
export type ChildMarket_Max_Order_By = {
  color?: InputMaybe<Order_By>;
  deployedAt?: InputMaybe<Order_By>;
  /** resolved from the session's metadata document, keyed by parentOutcomeIndex */
  displayName?: InputMaybe<Order_By>;
  downToken?: InputMaybe<Order_By>;
  /** child market address */
  id?: InputMaybe<Order_By>;
  keyword?: InputMaybe<Order_By>;
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound?: InputMaybe<Order_By>;
  /** read from the Seer child market */
  marketName?: InputMaybe<Order_By>;
  parentOutcome?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  session_id?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
  underlyingToken?: InputMaybe<Order_By>;
  upToken?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by min() on columns of table "ChildMarket" */
export type ChildMarket_Min_Order_By = {
  color?: InputMaybe<Order_By>;
  deployedAt?: InputMaybe<Order_By>;
  /** resolved from the session's metadata document, keyed by parentOutcomeIndex */
  displayName?: InputMaybe<Order_By>;
  downToken?: InputMaybe<Order_By>;
  /** child market address */
  id?: InputMaybe<Order_By>;
  keyword?: InputMaybe<Order_By>;
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound?: InputMaybe<Order_By>;
  /** read from the Seer child market */
  marketName?: InputMaybe<Order_By>;
  parentOutcome?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  session_id?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
  underlyingToken?: InputMaybe<Order_By>;
  upToken?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** Ordering options when selecting data from "ChildMarket". */
export type ChildMarket_Order_By = {
  blocks?: InputMaybe<Order_By>;
  color?: InputMaybe<Order_By>;
  deployedAt?: InputMaybe<Order_By>;
  displayName?: InputMaybe<Order_By>;
  downToken?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  keyword?: InputMaybe<Order_By>;
  lowerBound?: InputMaybe<Order_By>;
  marketName?: InputMaybe<Order_By>;
  parentOutcome?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  pools_aggregate?: InputMaybe<Pool_Aggregate_Order_By>;
  predictions_aggregate?: InputMaybe<Prediction_Aggregate_Order_By>;
  session?: InputMaybe<Session_Order_By>;
  session_id?: InputMaybe<Order_By>;
  tokens_aggregate?: InputMaybe<Token_Aggregate_Order_By>;
  transactionHash?: InputMaybe<Order_By>;
  underlyingToken?: InputMaybe<Order_By>;
  upToken?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** select columns of table "ChildMarket" */
export enum ChildMarket_Select_Column {
  /** column name */
  Blocks = 'blocks',
  /** column name */
  Color = 'color',
  /** column name */
  DeployedAt = 'deployedAt',
  /** column name */
  DisplayName = 'displayName',
  /** column name */
  DownToken = 'downToken',
  /** column name */
  Id = 'id',
  /** column name */
  Keyword = 'keyword',
  /** column name */
  LowerBound = 'lowerBound',
  /** column name */
  MarketName = 'marketName',
  /** column name */
  ParentOutcome = 'parentOutcome',
  /** column name */
  ParentOutcomeIndex = 'parentOutcomeIndex',
  /** column name */
  SessionId = 'session_id',
  /** column name */
  TransactionHash = 'transactionHash',
  /** column name */
  UnderlyingToken = 'underlyingToken',
  /** column name */
  UpToken = 'upToken',
  /** column name */
  UpperBound = 'upperBound'
}

/** order by stddev() on columns of table "ChildMarket" */
export type ChildMarket_Stddev_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by stddev_pop() on columns of table "ChildMarket" */
export type ChildMarket_Stddev_Pop_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by stddev_samp() on columns of table "ChildMarket" */
export type ChildMarket_Stddev_Samp_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** Streaming cursor of the table "ChildMarket" */
export type ChildMarket_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: ChildMarket_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type ChildMarket_Stream_Cursor_Value_Input = {
  /** everything a child says beyond its name and colour */
  blocks?: InputMaybe<Scalars['jsonb']['input']>;
  color?: InputMaybe<Scalars['String']['input']>;
  deployedAt?: InputMaybe<Scalars['numeric']['input']>;
  /** resolved from the session's metadata document, keyed by parentOutcomeIndex */
  displayName?: InputMaybe<Scalars['String']['input']>;
  downToken?: InputMaybe<Scalars['String']['input']>;
  /** child market address */
  id?: InputMaybe<Scalars['String']['input']>;
  keyword?: InputMaybe<Scalars['String']['input']>;
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound?: InputMaybe<Scalars['numeric']['input']>;
  /** read from the Seer child market */
  marketName?: InputMaybe<Scalars['String']['input']>;
  parentOutcome?: InputMaybe<Scalars['String']['input']>;
  parentOutcomeIndex?: InputMaybe<Scalars['numeric']['input']>;
  session_id?: InputMaybe<Scalars['String']['input']>;
  transactionHash?: InputMaybe<Scalars['String']['input']>;
  underlyingToken?: InputMaybe<Scalars['String']['input']>;
  upToken?: InputMaybe<Scalars['String']['input']>;
  upperBound?: InputMaybe<Scalars['numeric']['input']>;
};

/** order by sum() on columns of table "ChildMarket" */
export type ChildMarket_Sum_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by var_pop() on columns of table "ChildMarket" */
export type ChildMarket_Var_Pop_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by var_samp() on columns of table "ChildMarket" */
export type ChildMarket_Var_Samp_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by variance() on columns of table "ChildMarket" */
export type ChildMarket_Variance_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  /** the scalar range, 1e18-scaled like Reality's answers */
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** columns and relationships of "Executor" */
export type Executor = {
  __typename?: 'Executor';
  deployedAt: Scalars['numeric']['output'];
  /** executor address */
  id: Scalars['String']['output'];
  owner: Scalars['String']['output'];
  /** An array relationship */
  positions: Array<Position>;
  /** An array relationship */
  predictions: Array<Prediction>;
  transactionHash: Scalars['String']['output'];
};


/** columns and relationships of "Executor" */
export type ExecutorPositionsArgs = {
  distinct_on?: InputMaybe<Array<Position_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Position_Order_By>>;
  where?: InputMaybe<Position_Bool_Exp>;
};


/** columns and relationships of "Executor" */
export type ExecutorPredictionsArgs = {
  distinct_on?: InputMaybe<Array<Prediction_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Prediction_Order_By>>;
  where?: InputMaybe<Prediction_Bool_Exp>;
};

/** Boolean expression to filter rows from the table "Executor". All fields are combined with a logical 'AND'. */
export type Executor_Bool_Exp = {
  _and?: InputMaybe<Array<Executor_Bool_Exp>>;
  _not?: InputMaybe<Executor_Bool_Exp>;
  _or?: InputMaybe<Array<Executor_Bool_Exp>>;
  deployedAt?: InputMaybe<Numeric_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  owner?: InputMaybe<String_Comparison_Exp>;
  positions?: InputMaybe<Position_Bool_Exp>;
  predictions?: InputMaybe<Prediction_Bool_Exp>;
  transactionHash?: InputMaybe<String_Comparison_Exp>;
};

/** Ordering options when selecting data from "Executor". */
export type Executor_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  owner?: InputMaybe<Order_By>;
  positions_aggregate?: InputMaybe<Position_Aggregate_Order_By>;
  predictions_aggregate?: InputMaybe<Prediction_Aggregate_Order_By>;
  transactionHash?: InputMaybe<Order_By>;
};

/** select columns of table "Executor" */
export enum Executor_Select_Column {
  /** column name */
  DeployedAt = 'deployedAt',
  /** column name */
  Id = 'id',
  /** column name */
  Owner = 'owner',
  /** column name */
  TransactionHash = 'transactionHash'
}

/** Streaming cursor of the table "Executor" */
export type Executor_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Executor_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Executor_Stream_Cursor_Value_Input = {
  deployedAt?: InputMaybe<Scalars['numeric']['input']>;
  /** executor address */
  id?: InputMaybe<Scalars['String']['input']>;
  owner?: InputMaybe<Scalars['String']['input']>;
  transactionHash?: InputMaybe<Scalars['String']['input']>;
};

/** Boolean expression to compare columns of type "Float". All fields are combined with logical 'AND'. */
export type Float_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['Float']['input']>;
  _gt?: InputMaybe<Scalars['Float']['input']>;
  _gte?: InputMaybe<Scalars['Float']['input']>;
  _in?: InputMaybe<Array<Scalars['Float']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Float']['input']>;
  _lte?: InputMaybe<Scalars['Float']['input']>;
  _neq?: InputMaybe<Scalars['Float']['input']>;
  _nin?: InputMaybe<Array<Scalars['Float']['input']>>;
};

/** Boolean expression to compare columns of type "Int". All fields are combined with logical 'AND'. */
export type Int_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['Int']['input']>;
  _gt?: InputMaybe<Scalars['Int']['input']>;
  _gte?: InputMaybe<Scalars['Int']['input']>;
  _in?: InputMaybe<Array<Scalars['Int']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Int']['input']>;
  _lte?: InputMaybe<Scalars['Int']['input']>;
  _neq?: InputMaybe<Scalars['Int']['input']>;
  _nin?: InputMaybe<Array<Scalars['Int']['input']>>;
};

/** An Algebra pool trading one side of a child market. */
export type Pool = {
  __typename?: 'Pool';
  /** An object relationship */
  childMarket?: Maybe<ChildMarket>;
  childMarket_id: Scalars['String']['output'];
  /** pool address */
  id: Scalars['String']['output'];
  /** the concentrated-liquidity L the last swap reported */
  liquidity: Scalars['numeric']['output'];
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex: Scalars['Int']['output'];
  /** whether the outcome token is token0 */
  outcomeIsToken0: Scalars['Boolean']['output'];
  outcomeToken: Scalars['String']['output'];
  /** sqrt price the pool was last left at, X96 */
  price: Scalars['numeric']['output'];
  /** An array relationship */
  swaps: Array<Swap>;
  tick: Scalars['Int']['output'];
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: Maybe<Scalars['numeric']['output']>;
  underlyingToken: Scalars['String']['output'];
  updatedAt: Scalars['numeric']['output'];
  /** lifetime absolute amount swapped either way */
  volumeOutcome: Scalars['numeric']['output'];
  volumeUnderlying: Scalars['numeric']['output'];
};


/** An Algebra pool trading one side of a child market. */
export type PoolSwapsArgs = {
  distinct_on?: InputMaybe<Array<Swap_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Swap_Order_By>>;
  where?: InputMaybe<Swap_Bool_Exp>;
};

/** order by aggregate values of table "Pool" */
export type Pool_Aggregate_Order_By = {
  avg?: InputMaybe<Pool_Avg_Order_By>;
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Pool_Max_Order_By>;
  min?: InputMaybe<Pool_Min_Order_By>;
  stddev?: InputMaybe<Pool_Stddev_Order_By>;
  stddev_pop?: InputMaybe<Pool_Stddev_Pop_Order_By>;
  stddev_samp?: InputMaybe<Pool_Stddev_Samp_Order_By>;
  sum?: InputMaybe<Pool_Sum_Order_By>;
  var_pop?: InputMaybe<Pool_Var_Pop_Order_By>;
  var_samp?: InputMaybe<Pool_Var_Samp_Order_By>;
  variance?: InputMaybe<Pool_Variance_Order_By>;
};

/** order by avg() on columns of table "Pool" */
export type Pool_Avg_Order_By = {
  /** the concentrated-liquidity L the last swap reported */
  liquidity?: InputMaybe<Order_By>;
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex?: InputMaybe<Order_By>;
  /** sqrt price the pool was last left at, X96 */
  price?: InputMaybe<Order_By>;
  tick?: InputMaybe<Order_By>;
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
  /** lifetime absolute amount swapped either way */
  volumeOutcome?: InputMaybe<Order_By>;
  volumeUnderlying?: InputMaybe<Order_By>;
};

/** Boolean expression to filter rows from the table "Pool". All fields are combined with a logical 'AND'. */
export type Pool_Bool_Exp = {
  _and?: InputMaybe<Array<Pool_Bool_Exp>>;
  _not?: InputMaybe<Pool_Bool_Exp>;
  _or?: InputMaybe<Array<Pool_Bool_Exp>>;
  childMarket?: InputMaybe<ChildMarket_Bool_Exp>;
  childMarket_id?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  liquidity?: InputMaybe<Numeric_Comparison_Exp>;
  outcomeIndex?: InputMaybe<Int_Comparison_Exp>;
  outcomeIsToken0?: InputMaybe<Boolean_Comparison_Exp>;
  outcomeToken?: InputMaybe<String_Comparison_Exp>;
  price?: InputMaybe<Numeric_Comparison_Exp>;
  swaps?: InputMaybe<Swap_Bool_Exp>;
  tick?: InputMaybe<Int_Comparison_Exp>;
  underlyingPerOutcome?: InputMaybe<Numeric_Comparison_Exp>;
  underlyingToken?: InputMaybe<String_Comparison_Exp>;
  updatedAt?: InputMaybe<Numeric_Comparison_Exp>;
  volumeOutcome?: InputMaybe<Numeric_Comparison_Exp>;
  volumeUnderlying?: InputMaybe<Numeric_Comparison_Exp>;
};

/** order by max() on columns of table "Pool" */
export type Pool_Max_Order_By = {
  childMarket_id?: InputMaybe<Order_By>;
  /** pool address */
  id?: InputMaybe<Order_By>;
  /** the concentrated-liquidity L the last swap reported */
  liquidity?: InputMaybe<Order_By>;
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex?: InputMaybe<Order_By>;
  outcomeToken?: InputMaybe<Order_By>;
  /** sqrt price the pool was last left at, X96 */
  price?: InputMaybe<Order_By>;
  tick?: InputMaybe<Order_By>;
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: InputMaybe<Order_By>;
  underlyingToken?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
  /** lifetime absolute amount swapped either way */
  volumeOutcome?: InputMaybe<Order_By>;
  volumeUnderlying?: InputMaybe<Order_By>;
};

/** order by min() on columns of table "Pool" */
export type Pool_Min_Order_By = {
  childMarket_id?: InputMaybe<Order_By>;
  /** pool address */
  id?: InputMaybe<Order_By>;
  /** the concentrated-liquidity L the last swap reported */
  liquidity?: InputMaybe<Order_By>;
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex?: InputMaybe<Order_By>;
  outcomeToken?: InputMaybe<Order_By>;
  /** sqrt price the pool was last left at, X96 */
  price?: InputMaybe<Order_By>;
  tick?: InputMaybe<Order_By>;
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: InputMaybe<Order_By>;
  underlyingToken?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
  /** lifetime absolute amount swapped either way */
  volumeOutcome?: InputMaybe<Order_By>;
  volumeUnderlying?: InputMaybe<Order_By>;
};

/** Ordering options when selecting data from "Pool". */
export type Pool_Order_By = {
  childMarket?: InputMaybe<ChildMarket_Order_By>;
  childMarket_id?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  liquidity?: InputMaybe<Order_By>;
  outcomeIndex?: InputMaybe<Order_By>;
  outcomeIsToken0?: InputMaybe<Order_By>;
  outcomeToken?: InputMaybe<Order_By>;
  price?: InputMaybe<Order_By>;
  swaps_aggregate?: InputMaybe<Swap_Aggregate_Order_By>;
  tick?: InputMaybe<Order_By>;
  underlyingPerOutcome?: InputMaybe<Order_By>;
  underlyingToken?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
  volumeOutcome?: InputMaybe<Order_By>;
  volumeUnderlying?: InputMaybe<Order_By>;
};

/** select columns of table "Pool" */
export enum Pool_Select_Column {
  /** column name */
  ChildMarketId = 'childMarket_id',
  /** column name */
  Id = 'id',
  /** column name */
  Liquidity = 'liquidity',
  /** column name */
  OutcomeIndex = 'outcomeIndex',
  /** column name */
  OutcomeIsToken0 = 'outcomeIsToken0',
  /** column name */
  OutcomeToken = 'outcomeToken',
  /** column name */
  Price = 'price',
  /** column name */
  Tick = 'tick',
  /** column name */
  UnderlyingPerOutcome = 'underlyingPerOutcome',
  /** column name */
  UnderlyingToken = 'underlyingToken',
  /** column name */
  UpdatedAt = 'updatedAt',
  /** column name */
  VolumeOutcome = 'volumeOutcome',
  /** column name */
  VolumeUnderlying = 'volumeUnderlying'
}

/** order by stddev() on columns of table "Pool" */
export type Pool_Stddev_Order_By = {
  /** the concentrated-liquidity L the last swap reported */
  liquidity?: InputMaybe<Order_By>;
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex?: InputMaybe<Order_By>;
  /** sqrt price the pool was last left at, X96 */
  price?: InputMaybe<Order_By>;
  tick?: InputMaybe<Order_By>;
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
  /** lifetime absolute amount swapped either way */
  volumeOutcome?: InputMaybe<Order_By>;
  volumeUnderlying?: InputMaybe<Order_By>;
};

/** order by stddev_pop() on columns of table "Pool" */
export type Pool_Stddev_Pop_Order_By = {
  /** the concentrated-liquidity L the last swap reported */
  liquidity?: InputMaybe<Order_By>;
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex?: InputMaybe<Order_By>;
  /** sqrt price the pool was last left at, X96 */
  price?: InputMaybe<Order_By>;
  tick?: InputMaybe<Order_By>;
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
  /** lifetime absolute amount swapped either way */
  volumeOutcome?: InputMaybe<Order_By>;
  volumeUnderlying?: InputMaybe<Order_By>;
};

/** order by stddev_samp() on columns of table "Pool" */
export type Pool_Stddev_Samp_Order_By = {
  /** the concentrated-liquidity L the last swap reported */
  liquidity?: InputMaybe<Order_By>;
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex?: InputMaybe<Order_By>;
  /** sqrt price the pool was last left at, X96 */
  price?: InputMaybe<Order_By>;
  tick?: InputMaybe<Order_By>;
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
  /** lifetime absolute amount swapped either way */
  volumeOutcome?: InputMaybe<Order_By>;
  volumeUnderlying?: InputMaybe<Order_By>;
};

/** Streaming cursor of the table "Pool" */
export type Pool_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Pool_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Pool_Stream_Cursor_Value_Input = {
  childMarket_id?: InputMaybe<Scalars['String']['input']>;
  /** pool address */
  id?: InputMaybe<Scalars['String']['input']>;
  /** the concentrated-liquidity L the last swap reported */
  liquidity?: InputMaybe<Scalars['numeric']['input']>;
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex?: InputMaybe<Scalars['Int']['input']>;
  /** whether the outcome token is token0 */
  outcomeIsToken0?: InputMaybe<Scalars['Boolean']['input']>;
  outcomeToken?: InputMaybe<Scalars['String']['input']>;
  /** sqrt price the pool was last left at, X96 */
  price?: InputMaybe<Scalars['numeric']['input']>;
  tick?: InputMaybe<Scalars['Int']['input']>;
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: InputMaybe<Scalars['numeric']['input']>;
  underlyingToken?: InputMaybe<Scalars['String']['input']>;
  updatedAt?: InputMaybe<Scalars['numeric']['input']>;
  /** lifetime absolute amount swapped either way */
  volumeOutcome?: InputMaybe<Scalars['numeric']['input']>;
  volumeUnderlying?: InputMaybe<Scalars['numeric']['input']>;
};

/** order by sum() on columns of table "Pool" */
export type Pool_Sum_Order_By = {
  /** the concentrated-liquidity L the last swap reported */
  liquidity?: InputMaybe<Order_By>;
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex?: InputMaybe<Order_By>;
  /** sqrt price the pool was last left at, X96 */
  price?: InputMaybe<Order_By>;
  tick?: InputMaybe<Order_By>;
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
  /** lifetime absolute amount swapped either way */
  volumeOutcome?: InputMaybe<Order_By>;
  volumeUnderlying?: InputMaybe<Order_By>;
};

/** order by var_pop() on columns of table "Pool" */
export type Pool_Var_Pop_Order_By = {
  /** the concentrated-liquidity L the last swap reported */
  liquidity?: InputMaybe<Order_By>;
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex?: InputMaybe<Order_By>;
  /** sqrt price the pool was last left at, X96 */
  price?: InputMaybe<Order_By>;
  tick?: InputMaybe<Order_By>;
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
  /** lifetime absolute amount swapped either way */
  volumeOutcome?: InputMaybe<Order_By>;
  volumeUnderlying?: InputMaybe<Order_By>;
};

/** order by var_samp() on columns of table "Pool" */
export type Pool_Var_Samp_Order_By = {
  /** the concentrated-liquidity L the last swap reported */
  liquidity?: InputMaybe<Order_By>;
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex?: InputMaybe<Order_By>;
  /** sqrt price the pool was last left at, X96 */
  price?: InputMaybe<Order_By>;
  tick?: InputMaybe<Order_By>;
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
  /** lifetime absolute amount swapped either way */
  volumeOutcome?: InputMaybe<Order_By>;
  volumeUnderlying?: InputMaybe<Order_By>;
};

/** order by variance() on columns of table "Pool" */
export type Pool_Variance_Order_By = {
  /** the concentrated-liquidity L the last swap reported */
  liquidity?: InputMaybe<Order_By>;
  /** which side of the market this pool trades: 0 is DOWN, 1 is UP */
  outcomeIndex?: InputMaybe<Order_By>;
  /** sqrt price the pool was last left at, X96 */
  price?: InputMaybe<Order_By>;
  tick?: InputMaybe<Order_By>;
  /** the actual price: underlying per whole outcome token, 1e18-scaled; null until the pool prices */
  underlyingPerOutcome?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
  /** lifetime absolute amount swapped either way */
  volumeOutcome?: InputMaybe<Order_By>;
  volumeUnderlying?: InputMaybe<Order_By>;
};

/** An executor's running balance of one token, summed off its transfers. Prediction rows copy their balances from here. */
export type Position = {
  __typename?: 'Position';
  balance: Scalars['numeric']['output'];
  /** An object relationship */
  executor?: Maybe<Executor>;
  executor_id: Scalars['String']['output'];
  /** executor-token */
  id: Scalars['String']['output'];
  token: Scalars['String']['output'];
  updatedAt: Scalars['numeric']['output'];
};

/** order by aggregate values of table "Position" */
export type Position_Aggregate_Order_By = {
  avg?: InputMaybe<Position_Avg_Order_By>;
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Position_Max_Order_By>;
  min?: InputMaybe<Position_Min_Order_By>;
  stddev?: InputMaybe<Position_Stddev_Order_By>;
  stddev_pop?: InputMaybe<Position_Stddev_Pop_Order_By>;
  stddev_samp?: InputMaybe<Position_Stddev_Samp_Order_By>;
  sum?: InputMaybe<Position_Sum_Order_By>;
  var_pop?: InputMaybe<Position_Var_Pop_Order_By>;
  var_samp?: InputMaybe<Position_Var_Samp_Order_By>;
  variance?: InputMaybe<Position_Variance_Order_By>;
};

/** order by avg() on columns of table "Position" */
export type Position_Avg_Order_By = {
  balance?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
};

/** Boolean expression to filter rows from the table "Position". All fields are combined with a logical 'AND'. */
export type Position_Bool_Exp = {
  _and?: InputMaybe<Array<Position_Bool_Exp>>;
  _not?: InputMaybe<Position_Bool_Exp>;
  _or?: InputMaybe<Array<Position_Bool_Exp>>;
  balance?: InputMaybe<Numeric_Comparison_Exp>;
  executor?: InputMaybe<Executor_Bool_Exp>;
  executor_id?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  token?: InputMaybe<String_Comparison_Exp>;
  updatedAt?: InputMaybe<Numeric_Comparison_Exp>;
};

/** order by max() on columns of table "Position" */
export type Position_Max_Order_By = {
  balance?: InputMaybe<Order_By>;
  executor_id?: InputMaybe<Order_By>;
  /** executor-token */
  id?: InputMaybe<Order_By>;
  token?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
};

/** order by min() on columns of table "Position" */
export type Position_Min_Order_By = {
  balance?: InputMaybe<Order_By>;
  executor_id?: InputMaybe<Order_By>;
  /** executor-token */
  id?: InputMaybe<Order_By>;
  token?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
};

/** Ordering options when selecting data from "Position". */
export type Position_Order_By = {
  balance?: InputMaybe<Order_By>;
  executor?: InputMaybe<Executor_Order_By>;
  executor_id?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  token?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
};

/** select columns of table "Position" */
export enum Position_Select_Column {
  /** column name */
  Balance = 'balance',
  /** column name */
  ExecutorId = 'executor_id',
  /** column name */
  Id = 'id',
  /** column name */
  Token = 'token',
  /** column name */
  UpdatedAt = 'updatedAt'
}

/** order by stddev() on columns of table "Position" */
export type Position_Stddev_Order_By = {
  balance?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
};

/** order by stddev_pop() on columns of table "Position" */
export type Position_Stddev_Pop_Order_By = {
  balance?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
};

/** order by stddev_samp() on columns of table "Position" */
export type Position_Stddev_Samp_Order_By = {
  balance?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
};

/** Streaming cursor of the table "Position" */
export type Position_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Position_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Position_Stream_Cursor_Value_Input = {
  balance?: InputMaybe<Scalars['numeric']['input']>;
  executor_id?: InputMaybe<Scalars['String']['input']>;
  /** executor-token */
  id?: InputMaybe<Scalars['String']['input']>;
  token?: InputMaybe<Scalars['String']['input']>;
  updatedAt?: InputMaybe<Scalars['numeric']['input']>;
};

/** order by sum() on columns of table "Position" */
export type Position_Sum_Order_By = {
  balance?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
};

/** order by var_pop() on columns of table "Position" */
export type Position_Var_Pop_Order_By = {
  balance?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
};

/** order by var_samp() on columns of table "Position" */
export type Position_Var_Samp_Order_By = {
  balance?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
};

/** order by variance() on columns of table "Position" */
export type Position_Variance_Order_By = {
  balance?: InputMaybe<Order_By>;
  updatedAt?: InputMaybe<Order_By>;
};

/** An executor's net trading in one child market within one transaction. */
export type Prediction = {
  __typename?: 'Prediction';
  blockNumber: Scalars['numeric']['output'];
  /** An object relationship */
  childMarket?: Maybe<ChildMarket>;
  childMarket_id: Scalars['String']['output'];
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: Maybe<Scalars['numeric']['output']>;
  downBalance: Scalars['numeric']['output'];
  downDelta: Scalars['numeric']['output'];
  downPriceAfter?: Maybe<Scalars['numeric']['output']>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: Maybe<Scalars['numeric']['output']>;
  downSwapTokens: Scalars['numeric']['output'];
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying: Scalars['numeric']['output'];
  /** An object relationship */
  executor?: Maybe<Executor>;
  executor_id: Scalars['String']['output'];
  /** transactionHash-executor-childMarket */
  id: Scalars['String']['output'];
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: Maybe<Scalars['numeric']['output']>;
  timestamp: Scalars['numeric']['output'];
  transactionHash: Scalars['String']['output'];
  /** the executor's balances once the transaction settled */
  underlyingBalance: Scalars['numeric']['output'];
  /** signed net movement over the whole transaction */
  underlyingDelta: Scalars['numeric']['output'];
  upAvgPrice?: Maybe<Scalars['numeric']['output']>;
  upBalance: Scalars['numeric']['output'];
  upDelta: Scalars['numeric']['output'];
  upPriceAfter?: Maybe<Scalars['numeric']['output']>;
  upPriceBefore?: Maybe<Scalars['numeric']['output']>;
  upSwapTokens: Scalars['numeric']['output'];
  upSwapUnderlying: Scalars['numeric']['output'];
};

/** order by aggregate values of table "Prediction" */
export type Prediction_Aggregate_Order_By = {
  avg?: InputMaybe<Prediction_Avg_Order_By>;
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Prediction_Max_Order_By>;
  min?: InputMaybe<Prediction_Min_Order_By>;
  stddev?: InputMaybe<Prediction_Stddev_Order_By>;
  stddev_pop?: InputMaybe<Prediction_Stddev_Pop_Order_By>;
  stddev_samp?: InputMaybe<Prediction_Stddev_Samp_Order_By>;
  sum?: InputMaybe<Prediction_Sum_Order_By>;
  var_pop?: InputMaybe<Prediction_Var_Pop_Order_By>;
  var_samp?: InputMaybe<Prediction_Var_Samp_Order_By>;
  variance?: InputMaybe<Prediction_Variance_Order_By>;
};

/** order by avg() on columns of table "Prediction" */
export type Prediction_Avg_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: InputMaybe<Order_By>;
  downBalance?: InputMaybe<Order_By>;
  downDelta?: InputMaybe<Order_By>;
  downPriceAfter?: InputMaybe<Order_By>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: InputMaybe<Order_By>;
  downSwapTokens?: InputMaybe<Order_By>;
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying?: InputMaybe<Order_By>;
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  /** the executor's balances once the transaction settled */
  underlyingBalance?: InputMaybe<Order_By>;
  /** signed net movement over the whole transaction */
  underlyingDelta?: InputMaybe<Order_By>;
  upAvgPrice?: InputMaybe<Order_By>;
  upBalance?: InputMaybe<Order_By>;
  upDelta?: InputMaybe<Order_By>;
  upPriceAfter?: InputMaybe<Order_By>;
  upPriceBefore?: InputMaybe<Order_By>;
  upSwapTokens?: InputMaybe<Order_By>;
  upSwapUnderlying?: InputMaybe<Order_By>;
};

/** Boolean expression to filter rows from the table "Prediction". All fields are combined with a logical 'AND'. */
export type Prediction_Bool_Exp = {
  _and?: InputMaybe<Array<Prediction_Bool_Exp>>;
  _not?: InputMaybe<Prediction_Bool_Exp>;
  _or?: InputMaybe<Array<Prediction_Bool_Exp>>;
  blockNumber?: InputMaybe<Numeric_Comparison_Exp>;
  childMarket?: InputMaybe<ChildMarket_Bool_Exp>;
  childMarket_id?: InputMaybe<String_Comparison_Exp>;
  downAvgPrice?: InputMaybe<Numeric_Comparison_Exp>;
  downBalance?: InputMaybe<Numeric_Comparison_Exp>;
  downDelta?: InputMaybe<Numeric_Comparison_Exp>;
  downPriceAfter?: InputMaybe<Numeric_Comparison_Exp>;
  downPriceBefore?: InputMaybe<Numeric_Comparison_Exp>;
  downSwapTokens?: InputMaybe<Numeric_Comparison_Exp>;
  downSwapUnderlying?: InputMaybe<Numeric_Comparison_Exp>;
  executor?: InputMaybe<Executor_Bool_Exp>;
  executor_id?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  impliedPrediction?: InputMaybe<Numeric_Comparison_Exp>;
  timestamp?: InputMaybe<Numeric_Comparison_Exp>;
  transactionHash?: InputMaybe<String_Comparison_Exp>;
  underlyingBalance?: InputMaybe<Numeric_Comparison_Exp>;
  underlyingDelta?: InputMaybe<Numeric_Comparison_Exp>;
  upAvgPrice?: InputMaybe<Numeric_Comparison_Exp>;
  upBalance?: InputMaybe<Numeric_Comparison_Exp>;
  upDelta?: InputMaybe<Numeric_Comparison_Exp>;
  upPriceAfter?: InputMaybe<Numeric_Comparison_Exp>;
  upPriceBefore?: InputMaybe<Numeric_Comparison_Exp>;
  upSwapTokens?: InputMaybe<Numeric_Comparison_Exp>;
  upSwapUnderlying?: InputMaybe<Numeric_Comparison_Exp>;
};

/** order by max() on columns of table "Prediction" */
export type Prediction_Max_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  childMarket_id?: InputMaybe<Order_By>;
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: InputMaybe<Order_By>;
  downBalance?: InputMaybe<Order_By>;
  downDelta?: InputMaybe<Order_By>;
  downPriceAfter?: InputMaybe<Order_By>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: InputMaybe<Order_By>;
  downSwapTokens?: InputMaybe<Order_By>;
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying?: InputMaybe<Order_By>;
  executor_id?: InputMaybe<Order_By>;
  /** transactionHash-executor-childMarket */
  id?: InputMaybe<Order_By>;
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
  /** the executor's balances once the transaction settled */
  underlyingBalance?: InputMaybe<Order_By>;
  /** signed net movement over the whole transaction */
  underlyingDelta?: InputMaybe<Order_By>;
  upAvgPrice?: InputMaybe<Order_By>;
  upBalance?: InputMaybe<Order_By>;
  upDelta?: InputMaybe<Order_By>;
  upPriceAfter?: InputMaybe<Order_By>;
  upPriceBefore?: InputMaybe<Order_By>;
  upSwapTokens?: InputMaybe<Order_By>;
  upSwapUnderlying?: InputMaybe<Order_By>;
};

/** order by min() on columns of table "Prediction" */
export type Prediction_Min_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  childMarket_id?: InputMaybe<Order_By>;
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: InputMaybe<Order_By>;
  downBalance?: InputMaybe<Order_By>;
  downDelta?: InputMaybe<Order_By>;
  downPriceAfter?: InputMaybe<Order_By>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: InputMaybe<Order_By>;
  downSwapTokens?: InputMaybe<Order_By>;
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying?: InputMaybe<Order_By>;
  executor_id?: InputMaybe<Order_By>;
  /** transactionHash-executor-childMarket */
  id?: InputMaybe<Order_By>;
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
  /** the executor's balances once the transaction settled */
  underlyingBalance?: InputMaybe<Order_By>;
  /** signed net movement over the whole transaction */
  underlyingDelta?: InputMaybe<Order_By>;
  upAvgPrice?: InputMaybe<Order_By>;
  upBalance?: InputMaybe<Order_By>;
  upDelta?: InputMaybe<Order_By>;
  upPriceAfter?: InputMaybe<Order_By>;
  upPriceBefore?: InputMaybe<Order_By>;
  upSwapTokens?: InputMaybe<Order_By>;
  upSwapUnderlying?: InputMaybe<Order_By>;
};

/** Ordering options when selecting data from "Prediction". */
export type Prediction_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  childMarket?: InputMaybe<ChildMarket_Order_By>;
  childMarket_id?: InputMaybe<Order_By>;
  downAvgPrice?: InputMaybe<Order_By>;
  downBalance?: InputMaybe<Order_By>;
  downDelta?: InputMaybe<Order_By>;
  downPriceAfter?: InputMaybe<Order_By>;
  downPriceBefore?: InputMaybe<Order_By>;
  downSwapTokens?: InputMaybe<Order_By>;
  downSwapUnderlying?: InputMaybe<Order_By>;
  executor?: InputMaybe<Executor_Order_By>;
  executor_id?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  impliedPrediction?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
  underlyingBalance?: InputMaybe<Order_By>;
  underlyingDelta?: InputMaybe<Order_By>;
  upAvgPrice?: InputMaybe<Order_By>;
  upBalance?: InputMaybe<Order_By>;
  upDelta?: InputMaybe<Order_By>;
  upPriceAfter?: InputMaybe<Order_By>;
  upPriceBefore?: InputMaybe<Order_By>;
  upSwapTokens?: InputMaybe<Order_By>;
  upSwapUnderlying?: InputMaybe<Order_By>;
};

/** select columns of table "Prediction" */
export enum Prediction_Select_Column {
  /** column name */
  BlockNumber = 'blockNumber',
  /** column name */
  ChildMarketId = 'childMarket_id',
  /** column name */
  DownAvgPrice = 'downAvgPrice',
  /** column name */
  DownBalance = 'downBalance',
  /** column name */
  DownDelta = 'downDelta',
  /** column name */
  DownPriceAfter = 'downPriceAfter',
  /** column name */
  DownPriceBefore = 'downPriceBefore',
  /** column name */
  DownSwapTokens = 'downSwapTokens',
  /** column name */
  DownSwapUnderlying = 'downSwapUnderlying',
  /** column name */
  ExecutorId = 'executor_id',
  /** column name */
  Id = 'id',
  /** column name */
  ImpliedPrediction = 'impliedPrediction',
  /** column name */
  Timestamp = 'timestamp',
  /** column name */
  TransactionHash = 'transactionHash',
  /** column name */
  UnderlyingBalance = 'underlyingBalance',
  /** column name */
  UnderlyingDelta = 'underlyingDelta',
  /** column name */
  UpAvgPrice = 'upAvgPrice',
  /** column name */
  UpBalance = 'upBalance',
  /** column name */
  UpDelta = 'upDelta',
  /** column name */
  UpPriceAfter = 'upPriceAfter',
  /** column name */
  UpPriceBefore = 'upPriceBefore',
  /** column name */
  UpSwapTokens = 'upSwapTokens',
  /** column name */
  UpSwapUnderlying = 'upSwapUnderlying'
}

/** order by stddev() on columns of table "Prediction" */
export type Prediction_Stddev_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: InputMaybe<Order_By>;
  downBalance?: InputMaybe<Order_By>;
  downDelta?: InputMaybe<Order_By>;
  downPriceAfter?: InputMaybe<Order_By>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: InputMaybe<Order_By>;
  downSwapTokens?: InputMaybe<Order_By>;
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying?: InputMaybe<Order_By>;
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  /** the executor's balances once the transaction settled */
  underlyingBalance?: InputMaybe<Order_By>;
  /** signed net movement over the whole transaction */
  underlyingDelta?: InputMaybe<Order_By>;
  upAvgPrice?: InputMaybe<Order_By>;
  upBalance?: InputMaybe<Order_By>;
  upDelta?: InputMaybe<Order_By>;
  upPriceAfter?: InputMaybe<Order_By>;
  upPriceBefore?: InputMaybe<Order_By>;
  upSwapTokens?: InputMaybe<Order_By>;
  upSwapUnderlying?: InputMaybe<Order_By>;
};

/** order by stddev_pop() on columns of table "Prediction" */
export type Prediction_Stddev_Pop_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: InputMaybe<Order_By>;
  downBalance?: InputMaybe<Order_By>;
  downDelta?: InputMaybe<Order_By>;
  downPriceAfter?: InputMaybe<Order_By>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: InputMaybe<Order_By>;
  downSwapTokens?: InputMaybe<Order_By>;
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying?: InputMaybe<Order_By>;
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  /** the executor's balances once the transaction settled */
  underlyingBalance?: InputMaybe<Order_By>;
  /** signed net movement over the whole transaction */
  underlyingDelta?: InputMaybe<Order_By>;
  upAvgPrice?: InputMaybe<Order_By>;
  upBalance?: InputMaybe<Order_By>;
  upDelta?: InputMaybe<Order_By>;
  upPriceAfter?: InputMaybe<Order_By>;
  upPriceBefore?: InputMaybe<Order_By>;
  upSwapTokens?: InputMaybe<Order_By>;
  upSwapUnderlying?: InputMaybe<Order_By>;
};

/** order by stddev_samp() on columns of table "Prediction" */
export type Prediction_Stddev_Samp_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: InputMaybe<Order_By>;
  downBalance?: InputMaybe<Order_By>;
  downDelta?: InputMaybe<Order_By>;
  downPriceAfter?: InputMaybe<Order_By>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: InputMaybe<Order_By>;
  downSwapTokens?: InputMaybe<Order_By>;
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying?: InputMaybe<Order_By>;
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  /** the executor's balances once the transaction settled */
  underlyingBalance?: InputMaybe<Order_By>;
  /** signed net movement over the whole transaction */
  underlyingDelta?: InputMaybe<Order_By>;
  upAvgPrice?: InputMaybe<Order_By>;
  upBalance?: InputMaybe<Order_By>;
  upDelta?: InputMaybe<Order_By>;
  upPriceAfter?: InputMaybe<Order_By>;
  upPriceBefore?: InputMaybe<Order_By>;
  upSwapTokens?: InputMaybe<Order_By>;
  upSwapUnderlying?: InputMaybe<Order_By>;
};

/** Streaming cursor of the table "Prediction" */
export type Prediction_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Prediction_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Prediction_Stream_Cursor_Value_Input = {
  blockNumber?: InputMaybe<Scalars['numeric']['input']>;
  childMarket_id?: InputMaybe<Scalars['String']['input']>;
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: InputMaybe<Scalars['numeric']['input']>;
  downBalance?: InputMaybe<Scalars['numeric']['input']>;
  downDelta?: InputMaybe<Scalars['numeric']['input']>;
  downPriceAfter?: InputMaybe<Scalars['numeric']['input']>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: InputMaybe<Scalars['numeric']['input']>;
  downSwapTokens?: InputMaybe<Scalars['numeric']['input']>;
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying?: InputMaybe<Scalars['numeric']['input']>;
  executor_id?: InputMaybe<Scalars['String']['input']>;
  /** transactionHash-executor-childMarket */
  id?: InputMaybe<Scalars['String']['input']>;
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: InputMaybe<Scalars['numeric']['input']>;
  timestamp?: InputMaybe<Scalars['numeric']['input']>;
  transactionHash?: InputMaybe<Scalars['String']['input']>;
  /** the executor's balances once the transaction settled */
  underlyingBalance?: InputMaybe<Scalars['numeric']['input']>;
  /** signed net movement over the whole transaction */
  underlyingDelta?: InputMaybe<Scalars['numeric']['input']>;
  upAvgPrice?: InputMaybe<Scalars['numeric']['input']>;
  upBalance?: InputMaybe<Scalars['numeric']['input']>;
  upDelta?: InputMaybe<Scalars['numeric']['input']>;
  upPriceAfter?: InputMaybe<Scalars['numeric']['input']>;
  upPriceBefore?: InputMaybe<Scalars['numeric']['input']>;
  upSwapTokens?: InputMaybe<Scalars['numeric']['input']>;
  upSwapUnderlying?: InputMaybe<Scalars['numeric']['input']>;
};

/** order by sum() on columns of table "Prediction" */
export type Prediction_Sum_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: InputMaybe<Order_By>;
  downBalance?: InputMaybe<Order_By>;
  downDelta?: InputMaybe<Order_By>;
  downPriceAfter?: InputMaybe<Order_By>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: InputMaybe<Order_By>;
  downSwapTokens?: InputMaybe<Order_By>;
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying?: InputMaybe<Order_By>;
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  /** the executor's balances once the transaction settled */
  underlyingBalance?: InputMaybe<Order_By>;
  /** signed net movement over the whole transaction */
  underlyingDelta?: InputMaybe<Order_By>;
  upAvgPrice?: InputMaybe<Order_By>;
  upBalance?: InputMaybe<Order_By>;
  upDelta?: InputMaybe<Order_By>;
  upPriceAfter?: InputMaybe<Order_By>;
  upPriceBefore?: InputMaybe<Order_By>;
  upSwapTokens?: InputMaybe<Order_By>;
  upSwapUnderlying?: InputMaybe<Order_By>;
};

/** order by var_pop() on columns of table "Prediction" */
export type Prediction_Var_Pop_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: InputMaybe<Order_By>;
  downBalance?: InputMaybe<Order_By>;
  downDelta?: InputMaybe<Order_By>;
  downPriceAfter?: InputMaybe<Order_By>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: InputMaybe<Order_By>;
  downSwapTokens?: InputMaybe<Order_By>;
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying?: InputMaybe<Order_By>;
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  /** the executor's balances once the transaction settled */
  underlyingBalance?: InputMaybe<Order_By>;
  /** signed net movement over the whole transaction */
  underlyingDelta?: InputMaybe<Order_By>;
  upAvgPrice?: InputMaybe<Order_By>;
  upBalance?: InputMaybe<Order_By>;
  upDelta?: InputMaybe<Order_By>;
  upPriceAfter?: InputMaybe<Order_By>;
  upPriceBefore?: InputMaybe<Order_By>;
  upSwapTokens?: InputMaybe<Order_By>;
  upSwapUnderlying?: InputMaybe<Order_By>;
};

/** order by var_samp() on columns of table "Prediction" */
export type Prediction_Var_Samp_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: InputMaybe<Order_By>;
  downBalance?: InputMaybe<Order_By>;
  downDelta?: InputMaybe<Order_By>;
  downPriceAfter?: InputMaybe<Order_By>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: InputMaybe<Order_By>;
  downSwapTokens?: InputMaybe<Order_By>;
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying?: InputMaybe<Order_By>;
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  /** the executor's balances once the transaction settled */
  underlyingBalance?: InputMaybe<Order_By>;
  /** signed net movement over the whole transaction */
  underlyingDelta?: InputMaybe<Order_By>;
  upAvgPrice?: InputMaybe<Order_By>;
  upBalance?: InputMaybe<Order_By>;
  upDelta?: InputMaybe<Order_By>;
  upPriceAfter?: InputMaybe<Order_By>;
  upPriceBefore?: InputMaybe<Order_By>;
  upSwapTokens?: InputMaybe<Order_By>;
  upSwapUnderlying?: InputMaybe<Order_By>;
};

/** order by variance() on columns of table "Prediction" */
export type Prediction_Variance_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  /** underlying paid per whole token averaged over the transaction, 1e18-scaled */
  downAvgPrice?: InputMaybe<Order_By>;
  downBalance?: InputMaybe<Order_By>;
  downDelta?: InputMaybe<Order_By>;
  downPriceAfter?: InputMaybe<Order_By>;
  /** actual pool prices (underlying per whole token, 1e18-scaled, not sqrt) before this side's first swap and after its last */
  downPriceBefore?: InputMaybe<Order_By>;
  downSwapTokens?: InputMaybe<Order_By>;
  /** totals over every swap on that side in the transaction */
  downSwapUnderlying?: InputMaybe<Order_By>;
  /** the forecast the executed prices imply, not the target the user stated; on lowerBound/upperBound's scale */
  impliedPrediction?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  /** the executor's balances once the transaction settled */
  underlyingBalance?: InputMaybe<Order_By>;
  /** signed net movement over the whole transaction */
  underlyingDelta?: InputMaybe<Order_By>;
  upAvgPrice?: InputMaybe<Order_By>;
  upBalance?: InputMaybe<Order_By>;
  upDelta?: InputMaybe<Order_By>;
  upPriceAfter?: InputMaybe<Order_By>;
  upPriceBefore?: InputMaybe<Order_By>;
  upSwapTokens?: InputMaybe<Order_By>;
  upSwapUnderlying?: InputMaybe<Order_By>;
};

/** columns and relationships of "Session" */
export type Session = {
  __typename?: 'Session';
  blocks: Scalars['jsonb']['output'];
  /** An array relationship */
  children: Array<ChildMarket>;
  collateralDecimals?: Maybe<Scalars['Int']['output']>;
  collateralSymbol?: Maybe<Scalars['String']['output']>;
  /** the seer factory's collateral */
  collateralToken?: Maybe<Scalars['String']['output']>;
  completedAt: Scalars['numeric']['output'];
  deployedChildCount: Scalars['numeric']['output'];
  deployer: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  heroImage?: Maybe<Scalars['String']['output']>;
  icon?: Maybe<Scalars['String']['output']>;
  /** sessionId */
  id: Scalars['String']['output'];
  /** the parent's INVALID outcome token */
  invalidToken?: Maybe<Scalars['String']['output']>;
  itemName?: Maybe<Scalars['String']['output']>;
  itemNamePlural?: Maybe<Scalars['String']['output']>;
  /** market name, outcomes, title, description and child display names, for search  */
  keyword: Scalars['String']['output'];
  /** read from the Seer parent market */
  marketName: Scalars['String']['output'];
  /** false when the document is unreachable or malformed, which is when every field below is null */
  metadataResolved: Scalars['Boolean']['output'];
  /** emitted by SessionFactory, fixed at deploy */
  metadataUri: Scalars['String']['output'];
  openedAt: Scalars['numeric']['output'];
  /** when trading stops */
  openingTime?: Maybe<Scalars['numeric']['output']>;
  outcomeCount: Scalars['numeric']['output'];
  /** wrapped ERC-20 per named outcome */
  outcomeTokens: Array<Scalars['String']['output']>;
  outcomes: Array<Scalars['String']['output']>;
  parentMarket: Scalars['String']['output'];
  sessionId: Scalars['numeric']['output'];
  /** resolved from metadataUri */
  title?: Maybe<Scalars['String']['output']>;
  transactionHash: Scalars['String']['output'];
};


/** columns and relationships of "Session" */
export type SessionBlocksArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};


/** columns and relationships of "Session" */
export type SessionChildrenArgs = {
  distinct_on?: InputMaybe<Array<ChildMarket_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<ChildMarket_Order_By>>;
  where?: InputMaybe<ChildMarket_Bool_Exp>;
};

/** How many sessions the factory has deployed. One row, id `global`. */
export type SessionCounter = {
  __typename?: 'SessionCounter';
  count: Scalars['numeric']['output'];
  id: Scalars['String']['output'];
};

/** Boolean expression to filter rows from the table "SessionCounter". All fields are combined with a logical 'AND'. */
export type SessionCounter_Bool_Exp = {
  _and?: InputMaybe<Array<SessionCounter_Bool_Exp>>;
  _not?: InputMaybe<SessionCounter_Bool_Exp>;
  _or?: InputMaybe<Array<SessionCounter_Bool_Exp>>;
  count?: InputMaybe<Numeric_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
};

/** Ordering options when selecting data from "SessionCounter". */
export type SessionCounter_Order_By = {
  count?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
};

/** select columns of table "SessionCounter" */
export enum SessionCounter_Select_Column {
  /** column name */
  Count = 'count',
  /** column name */
  Id = 'id'
}

/** Streaming cursor of the table "SessionCounter" */
export type SessionCounter_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: SessionCounter_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type SessionCounter_Stream_Cursor_Value_Input = {
  count?: InputMaybe<Scalars['numeric']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
};

/** Boolean expression to filter rows from the table "Session". All fields are combined with a logical 'AND'. */
export type Session_Bool_Exp = {
  _and?: InputMaybe<Array<Session_Bool_Exp>>;
  _not?: InputMaybe<Session_Bool_Exp>;
  _or?: InputMaybe<Array<Session_Bool_Exp>>;
  blocks?: InputMaybe<Jsonb_Comparison_Exp>;
  children?: InputMaybe<ChildMarket_Bool_Exp>;
  collateralDecimals?: InputMaybe<Int_Comparison_Exp>;
  collateralSymbol?: InputMaybe<String_Comparison_Exp>;
  collateralToken?: InputMaybe<String_Comparison_Exp>;
  completedAt?: InputMaybe<Numeric_Comparison_Exp>;
  deployedChildCount?: InputMaybe<Numeric_Comparison_Exp>;
  deployer?: InputMaybe<String_Comparison_Exp>;
  description?: InputMaybe<String_Comparison_Exp>;
  heroImage?: InputMaybe<String_Comparison_Exp>;
  icon?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  invalidToken?: InputMaybe<String_Comparison_Exp>;
  itemName?: InputMaybe<String_Comparison_Exp>;
  itemNamePlural?: InputMaybe<String_Comparison_Exp>;
  keyword?: InputMaybe<String_Comparison_Exp>;
  marketName?: InputMaybe<String_Comparison_Exp>;
  metadataResolved?: InputMaybe<Boolean_Comparison_Exp>;
  metadataUri?: InputMaybe<String_Comparison_Exp>;
  openedAt?: InputMaybe<Numeric_Comparison_Exp>;
  openingTime?: InputMaybe<Numeric_Comparison_Exp>;
  outcomeCount?: InputMaybe<Numeric_Comparison_Exp>;
  outcomeTokens?: InputMaybe<String_Array_Comparison_Exp>;
  outcomes?: InputMaybe<String_Array_Comparison_Exp>;
  parentMarket?: InputMaybe<String_Comparison_Exp>;
  sessionId?: InputMaybe<Numeric_Comparison_Exp>;
  title?: InputMaybe<String_Comparison_Exp>;
  transactionHash?: InputMaybe<String_Comparison_Exp>;
};

/** Ordering options when selecting data from "Session". */
export type Session_Order_By = {
  blocks?: InputMaybe<Order_By>;
  children_aggregate?: InputMaybe<ChildMarket_Aggregate_Order_By>;
  collateralDecimals?: InputMaybe<Order_By>;
  collateralSymbol?: InputMaybe<Order_By>;
  collateralToken?: InputMaybe<Order_By>;
  completedAt?: InputMaybe<Order_By>;
  deployedChildCount?: InputMaybe<Order_By>;
  deployer?: InputMaybe<Order_By>;
  description?: InputMaybe<Order_By>;
  heroImage?: InputMaybe<Order_By>;
  icon?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  invalidToken?: InputMaybe<Order_By>;
  itemName?: InputMaybe<Order_By>;
  itemNamePlural?: InputMaybe<Order_By>;
  keyword?: InputMaybe<Order_By>;
  marketName?: InputMaybe<Order_By>;
  metadataResolved?: InputMaybe<Order_By>;
  metadataUri?: InputMaybe<Order_By>;
  openedAt?: InputMaybe<Order_By>;
  openingTime?: InputMaybe<Order_By>;
  outcomeCount?: InputMaybe<Order_By>;
  outcomeTokens?: InputMaybe<Order_By>;
  outcomes?: InputMaybe<Order_By>;
  parentMarket?: InputMaybe<Order_By>;
  sessionId?: InputMaybe<Order_By>;
  title?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
};

/** select columns of table "Session" */
export enum Session_Select_Column {
  /** column name */
  Blocks = 'blocks',
  /** column name */
  CollateralDecimals = 'collateralDecimals',
  /** column name */
  CollateralSymbol = 'collateralSymbol',
  /** column name */
  CollateralToken = 'collateralToken',
  /** column name */
  CompletedAt = 'completedAt',
  /** column name */
  DeployedChildCount = 'deployedChildCount',
  /** column name */
  Deployer = 'deployer',
  /** column name */
  Description = 'description',
  /** column name */
  HeroImage = 'heroImage',
  /** column name */
  Icon = 'icon',
  /** column name */
  Id = 'id',
  /** column name */
  InvalidToken = 'invalidToken',
  /** column name */
  ItemName = 'itemName',
  /** column name */
  ItemNamePlural = 'itemNamePlural',
  /** column name */
  Keyword = 'keyword',
  /** column name */
  MarketName = 'marketName',
  /** column name */
  MetadataResolved = 'metadataResolved',
  /** column name */
  MetadataUri = 'metadataUri',
  /** column name */
  OpenedAt = 'openedAt',
  /** column name */
  OpeningTime = 'openingTime',
  /** column name */
  OutcomeCount = 'outcomeCount',
  /** column name */
  OutcomeTokens = 'outcomeTokens',
  /** column name */
  Outcomes = 'outcomes',
  /** column name */
  ParentMarket = 'parentMarket',
  /** column name */
  SessionId = 'sessionId',
  /** column name */
  Title = 'title',
  /** column name */
  TransactionHash = 'transactionHash'
}

/** Streaming cursor of the table "Session" */
export type Session_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Session_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Session_Stream_Cursor_Value_Input = {
  blocks?: InputMaybe<Scalars['jsonb']['input']>;
  collateralDecimals?: InputMaybe<Scalars['Int']['input']>;
  collateralSymbol?: InputMaybe<Scalars['String']['input']>;
  /** the seer factory's collateral */
  collateralToken?: InputMaybe<Scalars['String']['input']>;
  completedAt?: InputMaybe<Scalars['numeric']['input']>;
  deployedChildCount?: InputMaybe<Scalars['numeric']['input']>;
  deployer?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  heroImage?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  /** sessionId */
  id?: InputMaybe<Scalars['String']['input']>;
  /** the parent's INVALID outcome token */
  invalidToken?: InputMaybe<Scalars['String']['input']>;
  itemName?: InputMaybe<Scalars['String']['input']>;
  itemNamePlural?: InputMaybe<Scalars['String']['input']>;
  /** market name, outcomes, title, description and child display names, for search  */
  keyword?: InputMaybe<Scalars['String']['input']>;
  /** read from the Seer parent market */
  marketName?: InputMaybe<Scalars['String']['input']>;
  /** false when the document is unreachable or malformed, which is when every field below is null */
  metadataResolved?: InputMaybe<Scalars['Boolean']['input']>;
  /** emitted by SessionFactory, fixed at deploy */
  metadataUri?: InputMaybe<Scalars['String']['input']>;
  openedAt?: InputMaybe<Scalars['numeric']['input']>;
  /** when trading stops */
  openingTime?: InputMaybe<Scalars['numeric']['input']>;
  outcomeCount?: InputMaybe<Scalars['numeric']['input']>;
  /** wrapped ERC-20 per named outcome */
  outcomeTokens?: InputMaybe<Array<Scalars['String']['input']>>;
  outcomes?: InputMaybe<Array<Scalars['String']['input']>>;
  parentMarket?: InputMaybe<Scalars['String']['input']>;
  sessionId?: InputMaybe<Scalars['numeric']['input']>;
  /** resolved from metadataUri */
  title?: InputMaybe<Scalars['String']['input']>;
  transactionHash?: InputMaybe<Scalars['String']['input']>;
};

/** Boolean expression to compare columns of type "String". All fields are combined with logical 'AND'. */
export type String_Array_Comparison_Exp = {
  /** is the array contained in the given array value */
  _contained_in?: InputMaybe<Array<Scalars['String']['input']>>;
  /** does the array contain the given value */
  _contains?: InputMaybe<Array<Scalars['String']['input']>>;
  _eq?: InputMaybe<Array<Scalars['String']['input']>>;
  _gt?: InputMaybe<Array<Scalars['String']['input']>>;
  _gte?: InputMaybe<Array<Scalars['String']['input']>>;
  _in?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Array<Scalars['String']['input']>>;
  _lte?: InputMaybe<Array<Scalars['String']['input']>>;
  _neq?: InputMaybe<Array<Scalars['String']['input']>>;
  _nin?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
};

/** Boolean expression to compare columns of type "String". All fields are combined with logical 'AND'. */
export type String_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['String']['input']>;
  _gt?: InputMaybe<Scalars['String']['input']>;
  _gte?: InputMaybe<Scalars['String']['input']>;
  /** does the column match the given case-insensitive pattern */
  _ilike?: InputMaybe<Scalars['String']['input']>;
  _in?: InputMaybe<Array<Scalars['String']['input']>>;
  /** does the column match the given POSIX regular expression, case insensitive */
  _iregex?: InputMaybe<Scalars['String']['input']>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  /** does the column match the given pattern */
  _like?: InputMaybe<Scalars['String']['input']>;
  _lt?: InputMaybe<Scalars['String']['input']>;
  _lte?: InputMaybe<Scalars['String']['input']>;
  _neq?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given case-insensitive pattern */
  _nilike?: InputMaybe<Scalars['String']['input']>;
  _nin?: InputMaybe<Array<Scalars['String']['input']>>;
  /** does the column NOT match the given POSIX regular expression, case insensitive */
  _niregex?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given pattern */
  _nlike?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given POSIX regular expression, case sensitive */
  _nregex?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given SQL regular expression */
  _nsimilar?: InputMaybe<Scalars['String']['input']>;
  /** does the column match the given POSIX regular expression, case sensitive */
  _regex?: InputMaybe<Scalars['String']['input']>;
  /** does the column match the given SQL regular expression */
  _similar?: InputMaybe<Scalars['String']['input']>;
};

/** A swap through a followed pool */
export type Swap = {
  __typename?: 'Swap';
  blockNumber: Scalars['numeric']['output'];
  /** An object relationship */
  childMarket?: Maybe<ChildMarket>;
  childMarket_id: Scalars['String']['output'];
  /** An object relationship */
  executor?: Maybe<Executor>;
  /** set when the swap paid out to one of our executors */
  executor_id?: Maybe<Scalars['String']['output']>;
  /** transactionHash-logIndex */
  id: Scalars['String']['output'];
  logIndex: Scalars['Int']['output'];
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount: Scalars['numeric']['output'];
  /** An object relationship */
  pool?: Maybe<Pool>;
  pool_id: Scalars['String']['output'];
  priceAfter: Scalars['numeric']['output'];
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore: Scalars['numeric']['output'];
  tickAfter: Scalars['Int']['output'];
  tickBefore: Scalars['Int']['output'];
  timestamp: Scalars['numeric']['output'];
  transactionHash: Scalars['String']['output'];
  underlyingAmount: Scalars['numeric']['output'];
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: Maybe<Scalars['numeric']['output']>;
};

/** order by aggregate values of table "Swap" */
export type Swap_Aggregate_Order_By = {
  avg?: InputMaybe<Swap_Avg_Order_By>;
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Swap_Max_Order_By>;
  min?: InputMaybe<Swap_Min_Order_By>;
  stddev?: InputMaybe<Swap_Stddev_Order_By>;
  stddev_pop?: InputMaybe<Swap_Stddev_Pop_Order_By>;
  stddev_samp?: InputMaybe<Swap_Stddev_Samp_Order_By>;
  sum?: InputMaybe<Swap_Sum_Order_By>;
  var_pop?: InputMaybe<Swap_Var_Pop_Order_By>;
  var_samp?: InputMaybe<Swap_Var_Samp_Order_By>;
  variance?: InputMaybe<Swap_Variance_Order_By>;
};

/** order by avg() on columns of table "Swap" */
export type Swap_Avg_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  logIndex?: InputMaybe<Order_By>;
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount?: InputMaybe<Order_By>;
  priceAfter?: InputMaybe<Order_By>;
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore?: InputMaybe<Order_By>;
  tickAfter?: InputMaybe<Order_By>;
  tickBefore?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  underlyingAmount?: InputMaybe<Order_By>;
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: InputMaybe<Order_By>;
};

/** Boolean expression to filter rows from the table "Swap". All fields are combined with a logical 'AND'. */
export type Swap_Bool_Exp = {
  _and?: InputMaybe<Array<Swap_Bool_Exp>>;
  _not?: InputMaybe<Swap_Bool_Exp>;
  _or?: InputMaybe<Array<Swap_Bool_Exp>>;
  blockNumber?: InputMaybe<Numeric_Comparison_Exp>;
  childMarket?: InputMaybe<ChildMarket_Bool_Exp>;
  childMarket_id?: InputMaybe<String_Comparison_Exp>;
  executor?: InputMaybe<Executor_Bool_Exp>;
  executor_id?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  logIndex?: InputMaybe<Int_Comparison_Exp>;
  outcomeAmount?: InputMaybe<Numeric_Comparison_Exp>;
  pool?: InputMaybe<Pool_Bool_Exp>;
  pool_id?: InputMaybe<String_Comparison_Exp>;
  priceAfter?: InputMaybe<Numeric_Comparison_Exp>;
  priceBefore?: InputMaybe<Numeric_Comparison_Exp>;
  tickAfter?: InputMaybe<Int_Comparison_Exp>;
  tickBefore?: InputMaybe<Int_Comparison_Exp>;
  timestamp?: InputMaybe<Numeric_Comparison_Exp>;
  transactionHash?: InputMaybe<String_Comparison_Exp>;
  underlyingAmount?: InputMaybe<Numeric_Comparison_Exp>;
  underlyingPerOutcomeAfter?: InputMaybe<Numeric_Comparison_Exp>;
};

/** order by max() on columns of table "Swap" */
export type Swap_Max_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  childMarket_id?: InputMaybe<Order_By>;
  /** set when the swap paid out to one of our executors */
  executor_id?: InputMaybe<Order_By>;
  /** transactionHash-logIndex */
  id?: InputMaybe<Order_By>;
  logIndex?: InputMaybe<Order_By>;
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount?: InputMaybe<Order_By>;
  pool_id?: InputMaybe<Order_By>;
  priceAfter?: InputMaybe<Order_By>;
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore?: InputMaybe<Order_By>;
  tickAfter?: InputMaybe<Order_By>;
  tickBefore?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
  underlyingAmount?: InputMaybe<Order_By>;
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: InputMaybe<Order_By>;
};

/** order by min() on columns of table "Swap" */
export type Swap_Min_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  childMarket_id?: InputMaybe<Order_By>;
  /** set when the swap paid out to one of our executors */
  executor_id?: InputMaybe<Order_By>;
  /** transactionHash-logIndex */
  id?: InputMaybe<Order_By>;
  logIndex?: InputMaybe<Order_By>;
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount?: InputMaybe<Order_By>;
  pool_id?: InputMaybe<Order_By>;
  priceAfter?: InputMaybe<Order_By>;
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore?: InputMaybe<Order_By>;
  tickAfter?: InputMaybe<Order_By>;
  tickBefore?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
  underlyingAmount?: InputMaybe<Order_By>;
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: InputMaybe<Order_By>;
};

/** Ordering options when selecting data from "Swap". */
export type Swap_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  childMarket?: InputMaybe<ChildMarket_Order_By>;
  childMarket_id?: InputMaybe<Order_By>;
  executor?: InputMaybe<Executor_Order_By>;
  executor_id?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  logIndex?: InputMaybe<Order_By>;
  outcomeAmount?: InputMaybe<Order_By>;
  pool?: InputMaybe<Pool_Order_By>;
  pool_id?: InputMaybe<Order_By>;
  priceAfter?: InputMaybe<Order_By>;
  priceBefore?: InputMaybe<Order_By>;
  tickAfter?: InputMaybe<Order_By>;
  tickBefore?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
  underlyingAmount?: InputMaybe<Order_By>;
  underlyingPerOutcomeAfter?: InputMaybe<Order_By>;
};

/** select columns of table "Swap" */
export enum Swap_Select_Column {
  /** column name */
  BlockNumber = 'blockNumber',
  /** column name */
  ChildMarketId = 'childMarket_id',
  /** column name */
  ExecutorId = 'executor_id',
  /** column name */
  Id = 'id',
  /** column name */
  LogIndex = 'logIndex',
  /** column name */
  OutcomeAmount = 'outcomeAmount',
  /** column name */
  PoolId = 'pool_id',
  /** column name */
  PriceAfter = 'priceAfter',
  /** column name */
  PriceBefore = 'priceBefore',
  /** column name */
  TickAfter = 'tickAfter',
  /** column name */
  TickBefore = 'tickBefore',
  /** column name */
  Timestamp = 'timestamp',
  /** column name */
  TransactionHash = 'transactionHash',
  /** column name */
  UnderlyingAmount = 'underlyingAmount',
  /** column name */
  UnderlyingPerOutcomeAfter = 'underlyingPerOutcomeAfter'
}

/** order by stddev() on columns of table "Swap" */
export type Swap_Stddev_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  logIndex?: InputMaybe<Order_By>;
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount?: InputMaybe<Order_By>;
  priceAfter?: InputMaybe<Order_By>;
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore?: InputMaybe<Order_By>;
  tickAfter?: InputMaybe<Order_By>;
  tickBefore?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  underlyingAmount?: InputMaybe<Order_By>;
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: InputMaybe<Order_By>;
};

/** order by stddev_pop() on columns of table "Swap" */
export type Swap_Stddev_Pop_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  logIndex?: InputMaybe<Order_By>;
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount?: InputMaybe<Order_By>;
  priceAfter?: InputMaybe<Order_By>;
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore?: InputMaybe<Order_By>;
  tickAfter?: InputMaybe<Order_By>;
  tickBefore?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  underlyingAmount?: InputMaybe<Order_By>;
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: InputMaybe<Order_By>;
};

/** order by stddev_samp() on columns of table "Swap" */
export type Swap_Stddev_Samp_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  logIndex?: InputMaybe<Order_By>;
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount?: InputMaybe<Order_By>;
  priceAfter?: InputMaybe<Order_By>;
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore?: InputMaybe<Order_By>;
  tickAfter?: InputMaybe<Order_By>;
  tickBefore?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  underlyingAmount?: InputMaybe<Order_By>;
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: InputMaybe<Order_By>;
};

/** Streaming cursor of the table "Swap" */
export type Swap_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Swap_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Swap_Stream_Cursor_Value_Input = {
  blockNumber?: InputMaybe<Scalars['numeric']['input']>;
  childMarket_id?: InputMaybe<Scalars['String']['input']>;
  /** set when the swap paid out to one of our executors */
  executor_id?: InputMaybe<Scalars['String']['input']>;
  /** transactionHash-logIndex */
  id?: InputMaybe<Scalars['String']['input']>;
  logIndex?: InputMaybe<Scalars['Int']['input']>;
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount?: InputMaybe<Scalars['numeric']['input']>;
  pool_id?: InputMaybe<Scalars['String']['input']>;
  priceAfter?: InputMaybe<Scalars['numeric']['input']>;
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore?: InputMaybe<Scalars['numeric']['input']>;
  tickAfter?: InputMaybe<Scalars['Int']['input']>;
  tickBefore?: InputMaybe<Scalars['Int']['input']>;
  timestamp?: InputMaybe<Scalars['numeric']['input']>;
  transactionHash?: InputMaybe<Scalars['String']['input']>;
  underlyingAmount?: InputMaybe<Scalars['numeric']['input']>;
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: InputMaybe<Scalars['numeric']['input']>;
};

/** order by sum() on columns of table "Swap" */
export type Swap_Sum_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  logIndex?: InputMaybe<Order_By>;
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount?: InputMaybe<Order_By>;
  priceAfter?: InputMaybe<Order_By>;
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore?: InputMaybe<Order_By>;
  tickAfter?: InputMaybe<Order_By>;
  tickBefore?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  underlyingAmount?: InputMaybe<Order_By>;
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: InputMaybe<Order_By>;
};

/** order by var_pop() on columns of table "Swap" */
export type Swap_Var_Pop_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  logIndex?: InputMaybe<Order_By>;
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount?: InputMaybe<Order_By>;
  priceAfter?: InputMaybe<Order_By>;
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore?: InputMaybe<Order_By>;
  tickAfter?: InputMaybe<Order_By>;
  tickBefore?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  underlyingAmount?: InputMaybe<Order_By>;
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: InputMaybe<Order_By>;
};

/** order by var_samp() on columns of table "Swap" */
export type Swap_Var_Samp_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  logIndex?: InputMaybe<Order_By>;
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount?: InputMaybe<Order_By>;
  priceAfter?: InputMaybe<Order_By>;
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore?: InputMaybe<Order_By>;
  tickAfter?: InputMaybe<Order_By>;
  tickBefore?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  underlyingAmount?: InputMaybe<Order_By>;
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: InputMaybe<Order_By>;
};

/** order by variance() on columns of table "Swap" */
export type Swap_Variance_Order_By = {
  blockNumber?: InputMaybe<Order_By>;
  logIndex?: InputMaybe<Order_By>;
  /** signed from the pool's side, so the outcome amount is negative when the trader bought */
  outcomeAmount?: InputMaybe<Order_By>;
  priceAfter?: InputMaybe<Order_By>;
  /** sqrt prices X96: what the previous swap left the pool at, and what this one did */
  priceBefore?: InputMaybe<Order_By>;
  tickAfter?: InputMaybe<Order_By>;
  tickBefore?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  underlyingAmount?: InputMaybe<Order_By>;
  /** the actual price after this swap: underlying per whole outcome token, 1e18-scaled */
  underlyingPerOutcomeAfter?: InputMaybe<Order_By>;
};

/**
 * An outcome or underlying token. An outcome token belongs to one child market; an underlying is
 * a parent outcome token, priced against by every child conditional on that outcome, so its
 * markets are the ChildMarket rows whose underlyingToken it is.
 */
export type Token = {
  __typename?: 'Token';
  /** An object relationship */
  childMarket?: Maybe<ChildMarket>;
  /** the child market an outcome token belongs to; null for an underlying */
  childMarket_id?: Maybe<Scalars['String']['output']>;
  /** null where the on-chain read failed */
  decimals?: Maybe<Scalars['Int']['output']>;
  /** token address, lowercase */
  id: Scalars['String']['output'];
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: Maybe<Scalars['Int']['output']>;
  symbol?: Maybe<Scalars['String']['output']>;
};

/** order by aggregate values of table "Token" */
export type Token_Aggregate_Order_By = {
  avg?: InputMaybe<Token_Avg_Order_By>;
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Token_Max_Order_By>;
  min?: InputMaybe<Token_Min_Order_By>;
  stddev?: InputMaybe<Token_Stddev_Order_By>;
  stddev_pop?: InputMaybe<Token_Stddev_Pop_Order_By>;
  stddev_samp?: InputMaybe<Token_Stddev_Samp_Order_By>;
  sum?: InputMaybe<Token_Sum_Order_By>;
  var_pop?: InputMaybe<Token_Var_Pop_Order_By>;
  var_samp?: InputMaybe<Token_Var_Samp_Order_By>;
  variance?: InputMaybe<Token_Variance_Order_By>;
};

/** order by avg() on columns of table "Token" */
export type Token_Avg_Order_By = {
  /** null where the on-chain read failed */
  decimals?: InputMaybe<Order_By>;
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: InputMaybe<Order_By>;
};

/** Boolean expression to filter rows from the table "Token". All fields are combined with a logical 'AND'. */
export type Token_Bool_Exp = {
  _and?: InputMaybe<Array<Token_Bool_Exp>>;
  _not?: InputMaybe<Token_Bool_Exp>;
  _or?: InputMaybe<Array<Token_Bool_Exp>>;
  childMarket?: InputMaybe<ChildMarket_Bool_Exp>;
  childMarket_id?: InputMaybe<String_Comparison_Exp>;
  decimals?: InputMaybe<Int_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  outcomeIndex?: InputMaybe<Int_Comparison_Exp>;
  symbol?: InputMaybe<String_Comparison_Exp>;
};

/** order by max() on columns of table "Token" */
export type Token_Max_Order_By = {
  /** the child market an outcome token belongs to; null for an underlying */
  childMarket_id?: InputMaybe<Order_By>;
  /** null where the on-chain read failed */
  decimals?: InputMaybe<Order_By>;
  /** token address, lowercase */
  id?: InputMaybe<Order_By>;
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: InputMaybe<Order_By>;
  symbol?: InputMaybe<Order_By>;
};

/** order by min() on columns of table "Token" */
export type Token_Min_Order_By = {
  /** the child market an outcome token belongs to; null for an underlying */
  childMarket_id?: InputMaybe<Order_By>;
  /** null where the on-chain read failed */
  decimals?: InputMaybe<Order_By>;
  /** token address, lowercase */
  id?: InputMaybe<Order_By>;
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: InputMaybe<Order_By>;
  symbol?: InputMaybe<Order_By>;
};

/** Ordering options when selecting data from "Token". */
export type Token_Order_By = {
  childMarket?: InputMaybe<ChildMarket_Order_By>;
  childMarket_id?: InputMaybe<Order_By>;
  decimals?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  outcomeIndex?: InputMaybe<Order_By>;
  symbol?: InputMaybe<Order_By>;
};

/** select columns of table "Token" */
export enum Token_Select_Column {
  /** column name */
  ChildMarketId = 'childMarket_id',
  /** column name */
  Decimals = 'decimals',
  /** column name */
  Id = 'id',
  /** column name */
  OutcomeIndex = 'outcomeIndex',
  /** column name */
  Symbol = 'symbol'
}

/** order by stddev() on columns of table "Token" */
export type Token_Stddev_Order_By = {
  /** null where the on-chain read failed */
  decimals?: InputMaybe<Order_By>;
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: InputMaybe<Order_By>;
};

/** order by stddev_pop() on columns of table "Token" */
export type Token_Stddev_Pop_Order_By = {
  /** null where the on-chain read failed */
  decimals?: InputMaybe<Order_By>;
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: InputMaybe<Order_By>;
};

/** order by stddev_samp() on columns of table "Token" */
export type Token_Stddev_Samp_Order_By = {
  /** null where the on-chain read failed */
  decimals?: InputMaybe<Order_By>;
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: InputMaybe<Order_By>;
};

/** Streaming cursor of the table "Token" */
export type Token_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Token_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Token_Stream_Cursor_Value_Input = {
  /** the child market an outcome token belongs to; null for an underlying */
  childMarket_id?: InputMaybe<Scalars['String']['input']>;
  /** null where the on-chain read failed */
  decimals?: InputMaybe<Scalars['Int']['input']>;
  /** token address, lowercase */
  id?: InputMaybe<Scalars['String']['input']>;
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: InputMaybe<Scalars['Int']['input']>;
  symbol?: InputMaybe<Scalars['String']['input']>;
};

/** order by sum() on columns of table "Token" */
export type Token_Sum_Order_By = {
  /** null where the on-chain read failed */
  decimals?: InputMaybe<Order_By>;
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: InputMaybe<Order_By>;
};

/** order by var_pop() on columns of table "Token" */
export type Token_Var_Pop_Order_By = {
  /** null where the on-chain read failed */
  decimals?: InputMaybe<Order_By>;
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: InputMaybe<Order_By>;
};

/** order by var_samp() on columns of table "Token" */
export type Token_Var_Samp_Order_By = {
  /** null where the on-chain read failed */
  decimals?: InputMaybe<Order_By>;
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: InputMaybe<Order_By>;
};

/** order by variance() on columns of table "Token" */
export type Token_Variance_Order_By = {
  /** null where the on-chain read failed */
  decimals?: InputMaybe<Order_By>;
  /** 0 is DOWN and 1 is UP; null for the underlying */
  outcomeIndex?: InputMaybe<Order_By>;
};

/** A token movement in or out of an executor. */
export type Transfer = {
  __typename?: 'Transfer';
  /** positive into the executor, negative out */
  amount: Scalars['numeric']['output'];
  blockNumber: Scalars['numeric']['output'];
  /** who the tokens came from or went to */
  counterparty: Scalars['String']['output'];
  /** An object relationship */
  executor?: Maybe<Executor>;
  executor_id: Scalars['String']['output'];
  /** transactionHash-logIndex-executor */
  id: Scalars['String']['output'];
  timestamp: Scalars['numeric']['output'];
  token: Scalars['String']['output'];
  transactionHash: Scalars['String']['output'];
};

/** Boolean expression to filter rows from the table "Transfer". All fields are combined with a logical 'AND'. */
export type Transfer_Bool_Exp = {
  _and?: InputMaybe<Array<Transfer_Bool_Exp>>;
  _not?: InputMaybe<Transfer_Bool_Exp>;
  _or?: InputMaybe<Array<Transfer_Bool_Exp>>;
  amount?: InputMaybe<Numeric_Comparison_Exp>;
  blockNumber?: InputMaybe<Numeric_Comparison_Exp>;
  counterparty?: InputMaybe<String_Comparison_Exp>;
  executor?: InputMaybe<Executor_Bool_Exp>;
  executor_id?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  timestamp?: InputMaybe<Numeric_Comparison_Exp>;
  token?: InputMaybe<String_Comparison_Exp>;
  transactionHash?: InputMaybe<String_Comparison_Exp>;
};

/** Ordering options when selecting data from "Transfer". */
export type Transfer_Order_By = {
  amount?: InputMaybe<Order_By>;
  blockNumber?: InputMaybe<Order_By>;
  counterparty?: InputMaybe<Order_By>;
  executor?: InputMaybe<Executor_Order_By>;
  executor_id?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  timestamp?: InputMaybe<Order_By>;
  token?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
};

/** select columns of table "Transfer" */
export enum Transfer_Select_Column {
  /** column name */
  Amount = 'amount',
  /** column name */
  BlockNumber = 'blockNumber',
  /** column name */
  Counterparty = 'counterparty',
  /** column name */
  ExecutorId = 'executor_id',
  /** column name */
  Id = 'id',
  /** column name */
  Timestamp = 'timestamp',
  /** column name */
  Token = 'token',
  /** column name */
  TransactionHash = 'transactionHash'
}

/** Streaming cursor of the table "Transfer" */
export type Transfer_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Transfer_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Transfer_Stream_Cursor_Value_Input = {
  /** positive into the executor, negative out */
  amount?: InputMaybe<Scalars['numeric']['input']>;
  blockNumber?: InputMaybe<Scalars['numeric']['input']>;
  /** who the tokens came from or went to */
  counterparty?: InputMaybe<Scalars['String']['input']>;
  executor_id?: InputMaybe<Scalars['String']['input']>;
  /** transactionHash-logIndex-executor */
  id?: InputMaybe<Scalars['String']['input']>;
  timestamp?: InputMaybe<Scalars['numeric']['input']>;
  token?: InputMaybe<Scalars['String']['input']>;
  transactionHash?: InputMaybe<Scalars['String']['input']>;
};

/** columns and relationships of "_meta" */
export type _Meta = {
  __typename?: '_meta';
  bufferBlock?: Maybe<Scalars['Int']['output']>;
  chainId?: Maybe<Scalars['Int']['output']>;
  endBlock?: Maybe<Scalars['Int']['output']>;
  eventsProcessed?: Maybe<Scalars['Float']['output']>;
  firstEventBlock?: Maybe<Scalars['Int']['output']>;
  isReady?: Maybe<Scalars['Boolean']['output']>;
  progressBlock?: Maybe<Scalars['Int']['output']>;
  readyAt?: Maybe<Scalars['timestamptz']['output']>;
  sourceBlock?: Maybe<Scalars['Int']['output']>;
  startBlock?: Maybe<Scalars['Int']['output']>;
};

/** Boolean expression to filter rows from the table "_meta". All fields are combined with a logical 'AND'. */
export type _Meta_Bool_Exp = {
  _and?: InputMaybe<Array<_Meta_Bool_Exp>>;
  _not?: InputMaybe<_Meta_Bool_Exp>;
  _or?: InputMaybe<Array<_Meta_Bool_Exp>>;
  bufferBlock?: InputMaybe<Int_Comparison_Exp>;
  chainId?: InputMaybe<Int_Comparison_Exp>;
  endBlock?: InputMaybe<Int_Comparison_Exp>;
  eventsProcessed?: InputMaybe<Float_Comparison_Exp>;
  firstEventBlock?: InputMaybe<Int_Comparison_Exp>;
  isReady?: InputMaybe<Boolean_Comparison_Exp>;
  progressBlock?: InputMaybe<Int_Comparison_Exp>;
  readyAt?: InputMaybe<Timestamptz_Comparison_Exp>;
  sourceBlock?: InputMaybe<Int_Comparison_Exp>;
  startBlock?: InputMaybe<Int_Comparison_Exp>;
};

/** Ordering options when selecting data from "_meta". */
export type _Meta_Order_By = {
  bufferBlock?: InputMaybe<Order_By>;
  chainId?: InputMaybe<Order_By>;
  endBlock?: InputMaybe<Order_By>;
  eventsProcessed?: InputMaybe<Order_By>;
  firstEventBlock?: InputMaybe<Order_By>;
  isReady?: InputMaybe<Order_By>;
  progressBlock?: InputMaybe<Order_By>;
  readyAt?: InputMaybe<Order_By>;
  sourceBlock?: InputMaybe<Order_By>;
  startBlock?: InputMaybe<Order_By>;
};

/** select columns of table "_meta" */
export enum _Meta_Select_Column {
  /** column name */
  BufferBlock = 'bufferBlock',
  /** column name */
  ChainId = 'chainId',
  /** column name */
  EndBlock = 'endBlock',
  /** column name */
  EventsProcessed = 'eventsProcessed',
  /** column name */
  FirstEventBlock = 'firstEventBlock',
  /** column name */
  IsReady = 'isReady',
  /** column name */
  ProgressBlock = 'progressBlock',
  /** column name */
  ReadyAt = 'readyAt',
  /** column name */
  SourceBlock = 'sourceBlock',
  /** column name */
  StartBlock = 'startBlock'
}

/** Streaming cursor of the table "_meta" */
export type _Meta_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: _Meta_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type _Meta_Stream_Cursor_Value_Input = {
  bufferBlock?: InputMaybe<Scalars['Int']['input']>;
  chainId?: InputMaybe<Scalars['Int']['input']>;
  endBlock?: InputMaybe<Scalars['Int']['input']>;
  eventsProcessed?: InputMaybe<Scalars['Float']['input']>;
  firstEventBlock?: InputMaybe<Scalars['Int']['input']>;
  isReady?: InputMaybe<Scalars['Boolean']['input']>;
  progressBlock?: InputMaybe<Scalars['Int']['input']>;
  readyAt?: InputMaybe<Scalars['timestamptz']['input']>;
  sourceBlock?: InputMaybe<Scalars['Int']['input']>;
  startBlock?: InputMaybe<Scalars['Int']['input']>;
};

/** Boolean expression to compare columns of type "bigint". All fields are combined with logical 'AND'. */
export type Bigint_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['bigint']['input']>;
  _gt?: InputMaybe<Scalars['bigint']['input']>;
  _gte?: InputMaybe<Scalars['bigint']['input']>;
  _in?: InputMaybe<Array<Scalars['bigint']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['bigint']['input']>;
  _lte?: InputMaybe<Scalars['bigint']['input']>;
  _neq?: InputMaybe<Scalars['bigint']['input']>;
  _nin?: InputMaybe<Array<Scalars['bigint']['input']>>;
};

/** columns and relationships of "chain_metadata" */
export type Chain_Metadata = {
  __typename?: 'chain_metadata';
  block_height?: Maybe<Scalars['Int']['output']>;
  chain_id?: Maybe<Scalars['Int']['output']>;
  end_block?: Maybe<Scalars['Int']['output']>;
  first_event_block_number?: Maybe<Scalars['Int']['output']>;
  is_hyper_sync?: Maybe<Scalars['Boolean']['output']>;
  latest_fetched_block_number?: Maybe<Scalars['Int']['output']>;
  latest_processed_block?: Maybe<Scalars['Int']['output']>;
  num_batches_fetched?: Maybe<Scalars['Int']['output']>;
  num_events_processed?: Maybe<Scalars['Float']['output']>;
  start_block?: Maybe<Scalars['Int']['output']>;
  timestamp_caught_up_to_head_or_endblock?: Maybe<Scalars['timestamptz']['output']>;
};

/** Boolean expression to filter rows from the table "chain_metadata". All fields are combined with a logical 'AND'. */
export type Chain_Metadata_Bool_Exp = {
  _and?: InputMaybe<Array<Chain_Metadata_Bool_Exp>>;
  _not?: InputMaybe<Chain_Metadata_Bool_Exp>;
  _or?: InputMaybe<Array<Chain_Metadata_Bool_Exp>>;
  block_height?: InputMaybe<Int_Comparison_Exp>;
  chain_id?: InputMaybe<Int_Comparison_Exp>;
  end_block?: InputMaybe<Int_Comparison_Exp>;
  first_event_block_number?: InputMaybe<Int_Comparison_Exp>;
  is_hyper_sync?: InputMaybe<Boolean_Comparison_Exp>;
  latest_fetched_block_number?: InputMaybe<Int_Comparison_Exp>;
  latest_processed_block?: InputMaybe<Int_Comparison_Exp>;
  num_batches_fetched?: InputMaybe<Int_Comparison_Exp>;
  num_events_processed?: InputMaybe<Float_Comparison_Exp>;
  start_block?: InputMaybe<Int_Comparison_Exp>;
  timestamp_caught_up_to_head_or_endblock?: InputMaybe<Timestamptz_Comparison_Exp>;
};

/** Ordering options when selecting data from "chain_metadata". */
export type Chain_Metadata_Order_By = {
  block_height?: InputMaybe<Order_By>;
  chain_id?: InputMaybe<Order_By>;
  end_block?: InputMaybe<Order_By>;
  first_event_block_number?: InputMaybe<Order_By>;
  is_hyper_sync?: InputMaybe<Order_By>;
  latest_fetched_block_number?: InputMaybe<Order_By>;
  latest_processed_block?: InputMaybe<Order_By>;
  num_batches_fetched?: InputMaybe<Order_By>;
  num_events_processed?: InputMaybe<Order_By>;
  start_block?: InputMaybe<Order_By>;
  timestamp_caught_up_to_head_or_endblock?: InputMaybe<Order_By>;
};

/** select columns of table "chain_metadata" */
export enum Chain_Metadata_Select_Column {
  /** column name */
  BlockHeight = 'block_height',
  /** column name */
  ChainId = 'chain_id',
  /** column name */
  EndBlock = 'end_block',
  /** column name */
  FirstEventBlockNumber = 'first_event_block_number',
  /** column name */
  IsHyperSync = 'is_hyper_sync',
  /** column name */
  LatestFetchedBlockNumber = 'latest_fetched_block_number',
  /** column name */
  LatestProcessedBlock = 'latest_processed_block',
  /** column name */
  NumBatchesFetched = 'num_batches_fetched',
  /** column name */
  NumEventsProcessed = 'num_events_processed',
  /** column name */
  StartBlock = 'start_block',
  /** column name */
  TimestampCaughtUpToHeadOrEndblock = 'timestamp_caught_up_to_head_or_endblock'
}

/** Streaming cursor of the table "chain_metadata" */
export type Chain_Metadata_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Chain_Metadata_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Chain_Metadata_Stream_Cursor_Value_Input = {
  block_height?: InputMaybe<Scalars['Int']['input']>;
  chain_id?: InputMaybe<Scalars['Int']['input']>;
  end_block?: InputMaybe<Scalars['Int']['input']>;
  first_event_block_number?: InputMaybe<Scalars['Int']['input']>;
  is_hyper_sync?: InputMaybe<Scalars['Boolean']['input']>;
  latest_fetched_block_number?: InputMaybe<Scalars['Int']['input']>;
  latest_processed_block?: InputMaybe<Scalars['Int']['input']>;
  num_batches_fetched?: InputMaybe<Scalars['Int']['input']>;
  num_events_processed?: InputMaybe<Scalars['Float']['input']>;
  start_block?: InputMaybe<Scalars['Int']['input']>;
  timestamp_caught_up_to_head_or_endblock?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** ordering argument of a cursor */
export enum Cursor_Ordering {
  /** ascending ordering of the cursor */
  Asc = 'ASC',
  /** descending ordering of the cursor */
  Desc = 'DESC'
}

export type Jsonb_Cast_Exp = {
  String?: InputMaybe<String_Comparison_Exp>;
};

/** Boolean expression to compare columns of type "jsonb". All fields are combined with logical 'AND'. */
export type Jsonb_Comparison_Exp = {
  _cast?: InputMaybe<Jsonb_Cast_Exp>;
  /** is the column contained in the given json value */
  _contained_in?: InputMaybe<Scalars['jsonb']['input']>;
  /** does the column contain the given json value at the top level */
  _contains?: InputMaybe<Scalars['jsonb']['input']>;
  _eq?: InputMaybe<Scalars['jsonb']['input']>;
  _gt?: InputMaybe<Scalars['jsonb']['input']>;
  _gte?: InputMaybe<Scalars['jsonb']['input']>;
  /** does the string exist as a top-level key in the column */
  _has_key?: InputMaybe<Scalars['String']['input']>;
  /** do all of these strings exist as top-level keys in the column */
  _has_keys_all?: InputMaybe<Array<Scalars['String']['input']>>;
  /** do any of these strings exist as top-level keys in the column */
  _has_keys_any?: InputMaybe<Array<Scalars['String']['input']>>;
  _in?: InputMaybe<Array<Scalars['jsonb']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['jsonb']['input']>;
  _lte?: InputMaybe<Scalars['jsonb']['input']>;
  _neq?: InputMaybe<Scalars['jsonb']['input']>;
  _nin?: InputMaybe<Array<Scalars['jsonb']['input']>>;
};

/** Boolean expression to compare columns of type "numeric". All fields are combined with logical 'AND'. */
export type Numeric_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['numeric']['input']>;
  _gt?: InputMaybe<Scalars['numeric']['input']>;
  _gte?: InputMaybe<Scalars['numeric']['input']>;
  _in?: InputMaybe<Array<Scalars['numeric']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['numeric']['input']>;
  _lte?: InputMaybe<Scalars['numeric']['input']>;
  _neq?: InputMaybe<Scalars['numeric']['input']>;
  _nin?: InputMaybe<Array<Scalars['numeric']['input']>>;
};

/** column ordering options */
export enum Order_By {
  /** in ascending order, nulls last */
  Asc = 'asc',
  /** in ascending order, nulls first */
  AscNullsFirst = 'asc_nulls_first',
  /** in ascending order, nulls last */
  AscNullsLast = 'asc_nulls_last',
  /** in descending order, nulls first */
  Desc = 'desc',
  /** in descending order, nulls first */
  DescNullsFirst = 'desc_nulls_first',
  /** in descending order, nulls last */
  DescNullsLast = 'desc_nulls_last'
}

export type Query_Root = {
  __typename?: 'query_root';
  /** fetch data from the table: "ChildMarket" */
  ChildMarket: Array<ChildMarket>;
  /** fetch data from the table: "ChildMarket" using primary key columns */
  ChildMarket_by_pk?: Maybe<ChildMarket>;
  /** fetch data from the table: "Executor" */
  Executor: Array<Executor>;
  /** fetch data from the table: "Executor" using primary key columns */
  Executor_by_pk?: Maybe<Executor>;
  /** fetch data from the table: "Pool" */
  Pool: Array<Pool>;
  /** fetch data from the table: "Pool" using primary key columns */
  Pool_by_pk?: Maybe<Pool>;
  /** fetch data from the table: "Position" */
  Position: Array<Position>;
  /** fetch data from the table: "Position" using primary key columns */
  Position_by_pk?: Maybe<Position>;
  /** fetch data from the table: "Prediction" */
  Prediction: Array<Prediction>;
  /** fetch data from the table: "Prediction" using primary key columns */
  Prediction_by_pk?: Maybe<Prediction>;
  /** fetch data from the table: "Session" */
  Session: Array<Session>;
  /** fetch data from the table: "SessionCounter" */
  SessionCounter: Array<SessionCounter>;
  /** fetch data from the table: "SessionCounter" using primary key columns */
  SessionCounter_by_pk?: Maybe<SessionCounter>;
  /** fetch data from the table: "Session" using primary key columns */
  Session_by_pk?: Maybe<Session>;
  /** fetch data from the table: "Swap" */
  Swap: Array<Swap>;
  /** fetch data from the table: "Swap" using primary key columns */
  Swap_by_pk?: Maybe<Swap>;
  /** fetch data from the table: "Token" */
  Token: Array<Token>;
  /** fetch data from the table: "Token" using primary key columns */
  Token_by_pk?: Maybe<Token>;
  /** fetch data from the table: "Transfer" */
  Transfer: Array<Transfer>;
  /** fetch data from the table: "Transfer" using primary key columns */
  Transfer_by_pk?: Maybe<Transfer>;
  /** fetch data from the table: "_meta" */
  _meta: Array<_Meta>;
  /** fetch data from the table: "chain_metadata" */
  chain_metadata: Array<Chain_Metadata>;
  /** fetch data from the table: "raw_events" */
  raw_events: Array<Raw_Events>;
  /** fetch data from the table: "raw_events" using primary key columns */
  raw_events_by_pk?: Maybe<Raw_Events>;
};


export type Query_RootChildMarketArgs = {
  distinct_on?: InputMaybe<Array<ChildMarket_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<ChildMarket_Order_By>>;
  where?: InputMaybe<ChildMarket_Bool_Exp>;
};


export type Query_RootChildMarket_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootExecutorArgs = {
  distinct_on?: InputMaybe<Array<Executor_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Executor_Order_By>>;
  where?: InputMaybe<Executor_Bool_Exp>;
};


export type Query_RootExecutor_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootPoolArgs = {
  distinct_on?: InputMaybe<Array<Pool_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Pool_Order_By>>;
  where?: InputMaybe<Pool_Bool_Exp>;
};


export type Query_RootPool_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootPositionArgs = {
  distinct_on?: InputMaybe<Array<Position_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Position_Order_By>>;
  where?: InputMaybe<Position_Bool_Exp>;
};


export type Query_RootPosition_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootPredictionArgs = {
  distinct_on?: InputMaybe<Array<Prediction_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Prediction_Order_By>>;
  where?: InputMaybe<Prediction_Bool_Exp>;
};


export type Query_RootPrediction_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootSessionArgs = {
  distinct_on?: InputMaybe<Array<Session_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Session_Order_By>>;
  where?: InputMaybe<Session_Bool_Exp>;
};


export type Query_RootSessionCounterArgs = {
  distinct_on?: InputMaybe<Array<SessionCounter_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<SessionCounter_Order_By>>;
  where?: InputMaybe<SessionCounter_Bool_Exp>;
};


export type Query_RootSessionCounter_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootSession_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootSwapArgs = {
  distinct_on?: InputMaybe<Array<Swap_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Swap_Order_By>>;
  where?: InputMaybe<Swap_Bool_Exp>;
};


export type Query_RootSwap_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootTokenArgs = {
  distinct_on?: InputMaybe<Array<Token_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Token_Order_By>>;
  where?: InputMaybe<Token_Bool_Exp>;
};


export type Query_RootToken_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootTransferArgs = {
  distinct_on?: InputMaybe<Array<Transfer_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Transfer_Order_By>>;
  where?: InputMaybe<Transfer_Bool_Exp>;
};


export type Query_RootTransfer_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_Root_MetaArgs = {
  distinct_on?: InputMaybe<Array<_Meta_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<_Meta_Order_By>>;
  where?: InputMaybe<_Meta_Bool_Exp>;
};


export type Query_RootChain_MetadataArgs = {
  distinct_on?: InputMaybe<Array<Chain_Metadata_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Chain_Metadata_Order_By>>;
  where?: InputMaybe<Chain_Metadata_Bool_Exp>;
};


export type Query_RootRaw_EventsArgs = {
  distinct_on?: InputMaybe<Array<Raw_Events_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Raw_Events_Order_By>>;
  where?: InputMaybe<Raw_Events_Bool_Exp>;
};


export type Query_RootRaw_Events_By_PkArgs = {
  serial: Scalars['bigint']['input'];
};

/** columns and relationships of "raw_events" */
export type Raw_Events = {
  __typename?: 'raw_events';
  block_fields: Scalars['jsonb']['output'];
  block_hash: Scalars['String']['output'];
  block_number: Scalars['Int']['output'];
  block_timestamp: Scalars['Int']['output'];
  chain_id: Scalars['Int']['output'];
  contract_name: Scalars['String']['output'];
  event_id: Scalars['bigint']['output'];
  event_name: Scalars['String']['output'];
  log_index: Scalars['Int']['output'];
  params: Scalars['jsonb']['output'];
  serial: Scalars['bigint']['output'];
  src_address: Scalars['String']['output'];
  transaction_fields: Scalars['jsonb']['output'];
};


/** columns and relationships of "raw_events" */
export type Raw_EventsBlock_FieldsArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};


/** columns and relationships of "raw_events" */
export type Raw_EventsParamsArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};


/** columns and relationships of "raw_events" */
export type Raw_EventsTransaction_FieldsArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};

/** Boolean expression to filter rows from the table "raw_events". All fields are combined with a logical 'AND'. */
export type Raw_Events_Bool_Exp = {
  _and?: InputMaybe<Array<Raw_Events_Bool_Exp>>;
  _not?: InputMaybe<Raw_Events_Bool_Exp>;
  _or?: InputMaybe<Array<Raw_Events_Bool_Exp>>;
  block_fields?: InputMaybe<Jsonb_Comparison_Exp>;
  block_hash?: InputMaybe<String_Comparison_Exp>;
  block_number?: InputMaybe<Int_Comparison_Exp>;
  block_timestamp?: InputMaybe<Int_Comparison_Exp>;
  chain_id?: InputMaybe<Int_Comparison_Exp>;
  contract_name?: InputMaybe<String_Comparison_Exp>;
  event_id?: InputMaybe<Bigint_Comparison_Exp>;
  event_name?: InputMaybe<String_Comparison_Exp>;
  log_index?: InputMaybe<Int_Comparison_Exp>;
  params?: InputMaybe<Jsonb_Comparison_Exp>;
  serial?: InputMaybe<Bigint_Comparison_Exp>;
  src_address?: InputMaybe<String_Comparison_Exp>;
  transaction_fields?: InputMaybe<Jsonb_Comparison_Exp>;
};

/** Ordering options when selecting data from "raw_events". */
export type Raw_Events_Order_By = {
  block_fields?: InputMaybe<Order_By>;
  block_hash?: InputMaybe<Order_By>;
  block_number?: InputMaybe<Order_By>;
  block_timestamp?: InputMaybe<Order_By>;
  chain_id?: InputMaybe<Order_By>;
  contract_name?: InputMaybe<Order_By>;
  event_id?: InputMaybe<Order_By>;
  event_name?: InputMaybe<Order_By>;
  log_index?: InputMaybe<Order_By>;
  params?: InputMaybe<Order_By>;
  serial?: InputMaybe<Order_By>;
  src_address?: InputMaybe<Order_By>;
  transaction_fields?: InputMaybe<Order_By>;
};

/** select columns of table "raw_events" */
export enum Raw_Events_Select_Column {
  /** column name */
  BlockFields = 'block_fields',
  /** column name */
  BlockHash = 'block_hash',
  /** column name */
  BlockNumber = 'block_number',
  /** column name */
  BlockTimestamp = 'block_timestamp',
  /** column name */
  ChainId = 'chain_id',
  /** column name */
  ContractName = 'contract_name',
  /** column name */
  EventId = 'event_id',
  /** column name */
  EventName = 'event_name',
  /** column name */
  LogIndex = 'log_index',
  /** column name */
  Params = 'params',
  /** column name */
  Serial = 'serial',
  /** column name */
  SrcAddress = 'src_address',
  /** column name */
  TransactionFields = 'transaction_fields'
}

/** Streaming cursor of the table "raw_events" */
export type Raw_Events_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Raw_Events_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Raw_Events_Stream_Cursor_Value_Input = {
  block_fields?: InputMaybe<Scalars['jsonb']['input']>;
  block_hash?: InputMaybe<Scalars['String']['input']>;
  block_number?: InputMaybe<Scalars['Int']['input']>;
  block_timestamp?: InputMaybe<Scalars['Int']['input']>;
  chain_id?: InputMaybe<Scalars['Int']['input']>;
  contract_name?: InputMaybe<Scalars['String']['input']>;
  event_id?: InputMaybe<Scalars['bigint']['input']>;
  event_name?: InputMaybe<Scalars['String']['input']>;
  log_index?: InputMaybe<Scalars['Int']['input']>;
  params?: InputMaybe<Scalars['jsonb']['input']>;
  serial?: InputMaybe<Scalars['bigint']['input']>;
  src_address?: InputMaybe<Scalars['String']['input']>;
  transaction_fields?: InputMaybe<Scalars['jsonb']['input']>;
};

export type Subscription_Root = {
  __typename?: 'subscription_root';
  /** fetch data from the table: "ChildMarket" */
  ChildMarket: Array<ChildMarket>;
  /** fetch data from the table: "ChildMarket" using primary key columns */
  ChildMarket_by_pk?: Maybe<ChildMarket>;
  /** fetch data from the table in a streaming manner: "ChildMarket" */
  ChildMarket_stream: Array<ChildMarket>;
  /** fetch data from the table: "Executor" */
  Executor: Array<Executor>;
  /** fetch data from the table: "Executor" using primary key columns */
  Executor_by_pk?: Maybe<Executor>;
  /** fetch data from the table in a streaming manner: "Executor" */
  Executor_stream: Array<Executor>;
  /** fetch data from the table: "Pool" */
  Pool: Array<Pool>;
  /** fetch data from the table: "Pool" using primary key columns */
  Pool_by_pk?: Maybe<Pool>;
  /** fetch data from the table in a streaming manner: "Pool" */
  Pool_stream: Array<Pool>;
  /** fetch data from the table: "Position" */
  Position: Array<Position>;
  /** fetch data from the table: "Position" using primary key columns */
  Position_by_pk?: Maybe<Position>;
  /** fetch data from the table in a streaming manner: "Position" */
  Position_stream: Array<Position>;
  /** fetch data from the table: "Prediction" */
  Prediction: Array<Prediction>;
  /** fetch data from the table: "Prediction" using primary key columns */
  Prediction_by_pk?: Maybe<Prediction>;
  /** fetch data from the table in a streaming manner: "Prediction" */
  Prediction_stream: Array<Prediction>;
  /** fetch data from the table: "Session" */
  Session: Array<Session>;
  /** fetch data from the table: "SessionCounter" */
  SessionCounter: Array<SessionCounter>;
  /** fetch data from the table: "SessionCounter" using primary key columns */
  SessionCounter_by_pk?: Maybe<SessionCounter>;
  /** fetch data from the table in a streaming manner: "SessionCounter" */
  SessionCounter_stream: Array<SessionCounter>;
  /** fetch data from the table: "Session" using primary key columns */
  Session_by_pk?: Maybe<Session>;
  /** fetch data from the table in a streaming manner: "Session" */
  Session_stream: Array<Session>;
  /** fetch data from the table: "Swap" */
  Swap: Array<Swap>;
  /** fetch data from the table: "Swap" using primary key columns */
  Swap_by_pk?: Maybe<Swap>;
  /** fetch data from the table in a streaming manner: "Swap" */
  Swap_stream: Array<Swap>;
  /** fetch data from the table: "Token" */
  Token: Array<Token>;
  /** fetch data from the table: "Token" using primary key columns */
  Token_by_pk?: Maybe<Token>;
  /** fetch data from the table in a streaming manner: "Token" */
  Token_stream: Array<Token>;
  /** fetch data from the table: "Transfer" */
  Transfer: Array<Transfer>;
  /** fetch data from the table: "Transfer" using primary key columns */
  Transfer_by_pk?: Maybe<Transfer>;
  /** fetch data from the table in a streaming manner: "Transfer" */
  Transfer_stream: Array<Transfer>;
  /** fetch data from the table: "_meta" */
  _meta: Array<_Meta>;
  /** fetch data from the table in a streaming manner: "_meta" */
  _meta_stream: Array<_Meta>;
  /** fetch data from the table: "chain_metadata" */
  chain_metadata: Array<Chain_Metadata>;
  /** fetch data from the table in a streaming manner: "chain_metadata" */
  chain_metadata_stream: Array<Chain_Metadata>;
  /** fetch data from the table: "raw_events" */
  raw_events: Array<Raw_Events>;
  /** fetch data from the table: "raw_events" using primary key columns */
  raw_events_by_pk?: Maybe<Raw_Events>;
  /** fetch data from the table in a streaming manner: "raw_events" */
  raw_events_stream: Array<Raw_Events>;
};


export type Subscription_RootChildMarketArgs = {
  distinct_on?: InputMaybe<Array<ChildMarket_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<ChildMarket_Order_By>>;
  where?: InputMaybe<ChildMarket_Bool_Exp>;
};


export type Subscription_RootChildMarket_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootChildMarket_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<ChildMarket_Stream_Cursor_Input>>;
  where?: InputMaybe<ChildMarket_Bool_Exp>;
};


export type Subscription_RootExecutorArgs = {
  distinct_on?: InputMaybe<Array<Executor_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Executor_Order_By>>;
  where?: InputMaybe<Executor_Bool_Exp>;
};


export type Subscription_RootExecutor_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootExecutor_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Executor_Stream_Cursor_Input>>;
  where?: InputMaybe<Executor_Bool_Exp>;
};


export type Subscription_RootPoolArgs = {
  distinct_on?: InputMaybe<Array<Pool_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Pool_Order_By>>;
  where?: InputMaybe<Pool_Bool_Exp>;
};


export type Subscription_RootPool_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootPool_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Pool_Stream_Cursor_Input>>;
  where?: InputMaybe<Pool_Bool_Exp>;
};


export type Subscription_RootPositionArgs = {
  distinct_on?: InputMaybe<Array<Position_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Position_Order_By>>;
  where?: InputMaybe<Position_Bool_Exp>;
};


export type Subscription_RootPosition_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootPosition_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Position_Stream_Cursor_Input>>;
  where?: InputMaybe<Position_Bool_Exp>;
};


export type Subscription_RootPredictionArgs = {
  distinct_on?: InputMaybe<Array<Prediction_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Prediction_Order_By>>;
  where?: InputMaybe<Prediction_Bool_Exp>;
};


export type Subscription_RootPrediction_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootPrediction_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Prediction_Stream_Cursor_Input>>;
  where?: InputMaybe<Prediction_Bool_Exp>;
};


export type Subscription_RootSessionArgs = {
  distinct_on?: InputMaybe<Array<Session_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Session_Order_By>>;
  where?: InputMaybe<Session_Bool_Exp>;
};


export type Subscription_RootSessionCounterArgs = {
  distinct_on?: InputMaybe<Array<SessionCounter_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<SessionCounter_Order_By>>;
  where?: InputMaybe<SessionCounter_Bool_Exp>;
};


export type Subscription_RootSessionCounter_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootSessionCounter_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<SessionCounter_Stream_Cursor_Input>>;
  where?: InputMaybe<SessionCounter_Bool_Exp>;
};


export type Subscription_RootSession_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootSession_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Session_Stream_Cursor_Input>>;
  where?: InputMaybe<Session_Bool_Exp>;
};


export type Subscription_RootSwapArgs = {
  distinct_on?: InputMaybe<Array<Swap_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Swap_Order_By>>;
  where?: InputMaybe<Swap_Bool_Exp>;
};


export type Subscription_RootSwap_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootSwap_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Swap_Stream_Cursor_Input>>;
  where?: InputMaybe<Swap_Bool_Exp>;
};


export type Subscription_RootTokenArgs = {
  distinct_on?: InputMaybe<Array<Token_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Token_Order_By>>;
  where?: InputMaybe<Token_Bool_Exp>;
};


export type Subscription_RootToken_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootToken_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Token_Stream_Cursor_Input>>;
  where?: InputMaybe<Token_Bool_Exp>;
};


export type Subscription_RootTransferArgs = {
  distinct_on?: InputMaybe<Array<Transfer_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Transfer_Order_By>>;
  where?: InputMaybe<Transfer_Bool_Exp>;
};


export type Subscription_RootTransfer_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootTransfer_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Transfer_Stream_Cursor_Input>>;
  where?: InputMaybe<Transfer_Bool_Exp>;
};


export type Subscription_Root_MetaArgs = {
  distinct_on?: InputMaybe<Array<_Meta_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<_Meta_Order_By>>;
  where?: InputMaybe<_Meta_Bool_Exp>;
};


export type Subscription_Root_Meta_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<_Meta_Stream_Cursor_Input>>;
  where?: InputMaybe<_Meta_Bool_Exp>;
};


export type Subscription_RootChain_MetadataArgs = {
  distinct_on?: InputMaybe<Array<Chain_Metadata_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Chain_Metadata_Order_By>>;
  where?: InputMaybe<Chain_Metadata_Bool_Exp>;
};


export type Subscription_RootChain_Metadata_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Chain_Metadata_Stream_Cursor_Input>>;
  where?: InputMaybe<Chain_Metadata_Bool_Exp>;
};


export type Subscription_RootRaw_EventsArgs = {
  distinct_on?: InputMaybe<Array<Raw_Events_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Raw_Events_Order_By>>;
  where?: InputMaybe<Raw_Events_Bool_Exp>;
};


export type Subscription_RootRaw_Events_By_PkArgs = {
  serial: Scalars['bigint']['input'];
};


export type Subscription_RootRaw_Events_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Raw_Events_Stream_Cursor_Input>>;
  where?: InputMaybe<Raw_Events_Bool_Exp>;
};

/** Boolean expression to compare columns of type "timestamptz". All fields are combined with logical 'AND'. */
export type Timestamptz_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['timestamptz']['input']>;
  _gt?: InputMaybe<Scalars['timestamptz']['input']>;
  _gte?: InputMaybe<Scalars['timestamptz']['input']>;
  _in?: InputMaybe<Array<Scalars['timestamptz']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['timestamptz']['input']>;
  _lte?: InputMaybe<Scalars['timestamptz']['input']>;
  _neq?: InputMaybe<Scalars['timestamptz']['input']>;
  _nin?: InputMaybe<Array<Scalars['timestamptz']['input']>>;
};

export type SessionIndexedQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type SessionIndexedQuery = { __typename?: 'query_root', Session: Array<{ __typename?: 'Session', id: string, children: Array<{ __typename?: 'ChildMarket', id: string }> }> };

export type SessionByMetadataQueryVariables = Exact<{
  deployer: Scalars['String']['input'];
  metadataUri: Scalars['String']['input'];
  since: Scalars['numeric']['input'];
}>;


export type SessionByMetadataQuery = { __typename?: 'query_root', Session: Array<{ __typename?: 'Session', sessionId: string, parentMarket: string, transactionHash: string, children: Array<{ __typename?: 'ChildMarket', id: string, parentOutcomeIndex: string, transactionHash: string }> }>, chain_metadata: Array<{ __typename?: 'chain_metadata', latest_processed_block?: number | null, block_height?: number | null }> };

export type SessionDetailQueryVariables = Exact<{
  parentMarket: Scalars['String']['input'];
}>;


export type SessionDetailQuery = { __typename?: 'query_root', Session: Array<{ __typename?: 'Session', id: string, parentMarket: string, deployer: string, marketName: string, title?: string | null, description?: string | null, icon?: string | null, heroImage?: string | null, itemName?: string | null, itemNamePlural?: string | null, metadataResolved: boolean, outcomeCount: string, deployedChildCount: string, invalidToken?: string | null, collateralToken?: string | null, collateralDecimals?: number | null, collateralSymbol?: string | null, openedAt: string, completedAt: string, openingTime?: string | null, blocks: unknown, children: Array<{ __typename?: 'ChildMarket', id: string, parentOutcomeIndex: string, parentOutcome: string, marketName: string, lowerBound: string, upperBound: string, displayName?: string | null, color?: string | null, blocks: unknown, upToken: string, downToken: string, underlyingToken: string }> }> };

export type SessionChartQueryVariables = Exact<{
  sessionId: Scalars['String']['input'];
  upOutcome: Scalars['Int']['input'];
}>;


export type SessionChartQuery = { __typename?: 'query_root', Pool: Array<{ __typename?: 'Pool', id: string, childMarket_id: string, underlyingPerOutcome?: string | null, updatedAt: string, swaps: Array<{ __typename?: 'Swap', underlyingPerOutcomeAfter?: string | null, timestamp: string }> }> };

export type SessionStatsQueryVariables = Exact<{
  sessionId: Scalars['String']['input'];
}>;


export type SessionStatsQuery = { __typename?: 'query_root', Prediction: Array<{ __typename?: 'Prediction', executor_id: string }>, Pool: Array<{ __typename?: 'Pool', id: string, volumeUnderlying: string }> };

export type SessionsQueryVariables = Exact<{
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  where: Session_Bool_Exp;
}>;


export type SessionsQuery = { __typename?: 'query_root', SessionCounter: Array<{ __typename?: 'SessionCounter', count: string }>, Session: Array<{ __typename?: 'Session', id: string, parentMarket: string, deployer: string, marketName: string, title?: string | null, description?: string | null, icon?: string | null, heroImage?: string | null, itemNamePlural?: string | null, outcomeCount: string, keyword: string, openingTime?: string | null }> };


export const SessionIndexedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionIndexed"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"Session"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"children"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<SessionIndexedQuery, SessionIndexedQueryVariables>;
export const SessionByMetadataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionByMetadata"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"deployer"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataUri"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"since"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"numeric"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"Session"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"deployer"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"deployer"}}}]}},{"kind":"ObjectField","name":{"kind":"Name","value":"metadataUri"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataUri"}}}]}},{"kind":"ObjectField","name":{"kind":"Name","value":"openedAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_gte"},"value":{"kind":"Variable","name":{"kind":"Name","value":"since"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"order_by"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"openedAt"},"value":{"kind":"EnumValue","value":"desc"}}]}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"parentMarket"}},{"kind":"Field","name":{"kind":"Name","value":"transactionHash"}},{"kind":"Field","name":{"kind":"Name","value":"children"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"order_by"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"parentOutcomeIndex"},"value":{"kind":"EnumValue","value":"asc"}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"parentOutcomeIndex"}},{"kind":"Field","name":{"kind":"Name","value":"transactionHash"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"chain_metadata"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"latest_processed_block"}},{"kind":"Field","name":{"kind":"Name","value":"block_height"}}]}}]}}]} as unknown as DocumentNode<SessionByMetadataQuery, SessionByMetadataQueryVariables>;
export const SessionDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"parentMarket"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"Session"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"parentMarket"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"parentMarket"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"parentMarket"}},{"kind":"Field","name":{"kind":"Name","value":"deployer"}},{"kind":"Field","name":{"kind":"Name","value":"marketName"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"heroImage"}},{"kind":"Field","name":{"kind":"Name","value":"itemName"}},{"kind":"Field","name":{"kind":"Name","value":"itemNamePlural"}},{"kind":"Field","name":{"kind":"Name","value":"metadataResolved"}},{"kind":"Field","name":{"kind":"Name","value":"outcomeCount"}},{"kind":"Field","name":{"kind":"Name","value":"deployedChildCount"}},{"kind":"Field","name":{"kind":"Name","value":"invalidToken"}},{"kind":"Field","name":{"kind":"Name","value":"collateralToken"}},{"kind":"Field","name":{"kind":"Name","value":"collateralDecimals"}},{"kind":"Field","name":{"kind":"Name","value":"collateralSymbol"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"openingTime"}},{"kind":"Field","name":{"kind":"Name","value":"blocks"}},{"kind":"Field","name":{"kind":"Name","value":"children"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"order_by"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"parentOutcomeIndex"},"value":{"kind":"EnumValue","value":"asc"}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"parentOutcomeIndex"}},{"kind":"Field","name":{"kind":"Name","value":"parentOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"marketName"}},{"kind":"Field","name":{"kind":"Name","value":"lowerBound"}},{"kind":"Field","name":{"kind":"Name","value":"upperBound"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"blocks"}},{"kind":"Field","name":{"kind":"Name","value":"upToken"}},{"kind":"Field","name":{"kind":"Name","value":"downToken"}},{"kind":"Field","name":{"kind":"Name","value":"underlyingToken"}}]}}]}}]}}]} as unknown as DocumentNode<SessionDetailQuery, SessionDetailQueryVariables>;
export const SessionChartDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionChart"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"upOutcome"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"Pool"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"childMarket"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"session_id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}]}}]}},{"kind":"ObjectField","name":{"kind":"Name","value":"outcomeIndex"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"upOutcome"}}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"childMarket_id"}},{"kind":"Field","name":{"kind":"Name","value":"underlyingPerOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"swaps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"order_by"},"value":{"kind":"ListValue","values":[{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"timestamp"},"value":{"kind":"EnumValue","value":"asc"}}]},{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"logIndex"},"value":{"kind":"EnumValue","value":"asc"}}]}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"underlyingPerOutcomeAfter"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}}]}}]}}]} as unknown as DocumentNode<SessionChartQuery, SessionChartQueryVariables>;
export const SessionStatsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionStats"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"Prediction"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"childMarket"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"session_id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}]}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"distinct_on"},"value":{"kind":"EnumValue","value":"executor_id"}},{"kind":"Argument","name":{"kind":"Name","value":"order_by"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"executor_id"},"value":{"kind":"EnumValue","value":"asc"}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"executor_id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"Pool"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"childMarket"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"session_id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}]}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"volumeUnderlying"}}]}}]}}]} as unknown as DocumentNode<SessionStatsQuery, SessionStatsQueryVariables>;
export const SessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Sessions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"where"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Session_bool_exp"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"SessionCounter"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"count"}}]}},{"kind":"Field","name":{"kind":"Name","value":"Session"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"Variable","name":{"kind":"Name","value":"where"}}},{"kind":"Argument","name":{"kind":"Name","value":"order_by"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"openedAt"},"value":{"kind":"EnumValue","value":"desc"}}]}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"parentMarket"}},{"kind":"Field","name":{"kind":"Name","value":"deployer"}},{"kind":"Field","name":{"kind":"Name","value":"marketName"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"heroImage"}},{"kind":"Field","name":{"kind":"Name","value":"itemNamePlural"}},{"kind":"Field","name":{"kind":"Name","value":"outcomeCount"}},{"kind":"Field","name":{"kind":"Name","value":"keyword"}},{"kind":"Field","name":{"kind":"Name","value":"openingTime"}}]}}]}}]} as unknown as DocumentNode<SessionsQuery, SessionsQueryVariables>;