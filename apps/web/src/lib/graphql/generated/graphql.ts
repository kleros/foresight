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
  /** child market address */
  id: Scalars['String']['output'];
  keyword: Scalars['String']['output'];
  lowerBound: Scalars['numeric']['output'];
  /** read from the Seer child market */
  marketName: Scalars['String']['output'];
  parentOutcome: Scalars['String']['output'];
  parentOutcomeIndex: Scalars['numeric']['output'];
  /** An object relationship */
  session?: Maybe<Session>;
  session_id: Scalars['String']['output'];
  transactionHash: Scalars['String']['output'];
  upperBound: Scalars['numeric']['output'];
};


/** columns and relationships of "ChildMarket" */
export type ChildMarketBlocksArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
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
  id?: InputMaybe<String_Comparison_Exp>;
  keyword?: InputMaybe<String_Comparison_Exp>;
  lowerBound?: InputMaybe<Numeric_Comparison_Exp>;
  marketName?: InputMaybe<String_Comparison_Exp>;
  parentOutcome?: InputMaybe<String_Comparison_Exp>;
  parentOutcomeIndex?: InputMaybe<Numeric_Comparison_Exp>;
  session?: InputMaybe<Session_Bool_Exp>;
  session_id?: InputMaybe<String_Comparison_Exp>;
  transactionHash?: InputMaybe<String_Comparison_Exp>;
  upperBound?: InputMaybe<Numeric_Comparison_Exp>;
};

/** order by max() on columns of table "ChildMarket" */
export type ChildMarket_Max_Order_By = {
  color?: InputMaybe<Order_By>;
  deployedAt?: InputMaybe<Order_By>;
  /** resolved from the session's metadata document, keyed by parentOutcomeIndex */
  displayName?: InputMaybe<Order_By>;
  /** child market address */
  id?: InputMaybe<Order_By>;
  keyword?: InputMaybe<Order_By>;
  lowerBound?: InputMaybe<Order_By>;
  /** read from the Seer child market */
  marketName?: InputMaybe<Order_By>;
  parentOutcome?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  session_id?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by min() on columns of table "ChildMarket" */
export type ChildMarket_Min_Order_By = {
  color?: InputMaybe<Order_By>;
  deployedAt?: InputMaybe<Order_By>;
  /** resolved from the session's metadata document, keyed by parentOutcomeIndex */
  displayName?: InputMaybe<Order_By>;
  /** child market address */
  id?: InputMaybe<Order_By>;
  keyword?: InputMaybe<Order_By>;
  lowerBound?: InputMaybe<Order_By>;
  /** read from the Seer child market */
  marketName?: InputMaybe<Order_By>;
  parentOutcome?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  session_id?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** Ordering options when selecting data from "ChildMarket". */
export type ChildMarket_Order_By = {
  blocks?: InputMaybe<Order_By>;
  color?: InputMaybe<Order_By>;
  deployedAt?: InputMaybe<Order_By>;
  displayName?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  keyword?: InputMaybe<Order_By>;
  lowerBound?: InputMaybe<Order_By>;
  marketName?: InputMaybe<Order_By>;
  parentOutcome?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  session?: InputMaybe<Session_Order_By>;
  session_id?: InputMaybe<Order_By>;
  transactionHash?: InputMaybe<Order_By>;
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
  UpperBound = 'upperBound'
}

/** order by stddev() on columns of table "ChildMarket" */
export type ChildMarket_Stddev_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by stddev_pop() on columns of table "ChildMarket" */
export type ChildMarket_Stddev_Pop_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by stddev_samp() on columns of table "ChildMarket" */
export type ChildMarket_Stddev_Samp_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
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
  /** child market address */
  id?: InputMaybe<Scalars['String']['input']>;
  keyword?: InputMaybe<Scalars['String']['input']>;
  lowerBound?: InputMaybe<Scalars['numeric']['input']>;
  /** read from the Seer child market */
  marketName?: InputMaybe<Scalars['String']['input']>;
  parentOutcome?: InputMaybe<Scalars['String']['input']>;
  parentOutcomeIndex?: InputMaybe<Scalars['numeric']['input']>;
  session_id?: InputMaybe<Scalars['String']['input']>;
  transactionHash?: InputMaybe<Scalars['String']['input']>;
  upperBound?: InputMaybe<Scalars['numeric']['input']>;
};

/** order by sum() on columns of table "ChildMarket" */
export type ChildMarket_Sum_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by var_pop() on columns of table "ChildMarket" */
export type ChildMarket_Var_Pop_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by var_samp() on columns of table "ChildMarket" */
export type ChildMarket_Var_Samp_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
};

/** order by variance() on columns of table "ChildMarket" */
export type ChildMarket_Variance_Order_By = {
  deployedAt?: InputMaybe<Order_By>;
  lowerBound?: InputMaybe<Order_By>;
  parentOutcomeIndex?: InputMaybe<Order_By>;
  upperBound?: InputMaybe<Order_By>;
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

/** columns and relationships of "Session" */
export type Session = {
  __typename?: 'Session';
  blocks: Scalars['jsonb']['output'];
  /** An array relationship */
  children: Array<ChildMarket>;
  completedAt: Scalars['numeric']['output'];
  deployedChildCount: Scalars['numeric']['output'];
  deployer: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  heroImage?: Maybe<Scalars['String']['output']>;
  icon?: Maybe<Scalars['String']['output']>;
  /** sessionId */
  id: Scalars['String']['output'];
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
  outcomeCount: Scalars['numeric']['output'];
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

/** Boolean expression to filter rows from the table "Session". All fields are combined with a logical 'AND'. */
export type Session_Bool_Exp = {
  _and?: InputMaybe<Array<Session_Bool_Exp>>;
  _not?: InputMaybe<Session_Bool_Exp>;
  _or?: InputMaybe<Array<Session_Bool_Exp>>;
  blocks?: InputMaybe<Jsonb_Comparison_Exp>;
  children?: InputMaybe<ChildMarket_Bool_Exp>;
  completedAt?: InputMaybe<Numeric_Comparison_Exp>;
  deployedChildCount?: InputMaybe<Numeric_Comparison_Exp>;
  deployer?: InputMaybe<String_Comparison_Exp>;
  description?: InputMaybe<String_Comparison_Exp>;
  heroImage?: InputMaybe<String_Comparison_Exp>;
  icon?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  itemName?: InputMaybe<String_Comparison_Exp>;
  itemNamePlural?: InputMaybe<String_Comparison_Exp>;
  keyword?: InputMaybe<String_Comparison_Exp>;
  marketName?: InputMaybe<String_Comparison_Exp>;
  metadataResolved?: InputMaybe<Boolean_Comparison_Exp>;
  metadataUri?: InputMaybe<String_Comparison_Exp>;
  openedAt?: InputMaybe<Numeric_Comparison_Exp>;
  outcomeCount?: InputMaybe<Numeric_Comparison_Exp>;
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
  completedAt?: InputMaybe<Order_By>;
  deployedChildCount?: InputMaybe<Order_By>;
  deployer?: InputMaybe<Order_By>;
  description?: InputMaybe<Order_By>;
  heroImage?: InputMaybe<Order_By>;
  icon?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  itemName?: InputMaybe<Order_By>;
  itemNamePlural?: InputMaybe<Order_By>;
  keyword?: InputMaybe<Order_By>;
  marketName?: InputMaybe<Order_By>;
  metadataResolved?: InputMaybe<Order_By>;
  metadataUri?: InputMaybe<Order_By>;
  openedAt?: InputMaybe<Order_By>;
  outcomeCount?: InputMaybe<Order_By>;
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
  OutcomeCount = 'outcomeCount',
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
  completedAt?: InputMaybe<Scalars['numeric']['input']>;
  deployedChildCount?: InputMaybe<Scalars['numeric']['input']>;
  deployer?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  heroImage?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  /** sessionId */
  id?: InputMaybe<Scalars['String']['input']>;
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
  outcomeCount?: InputMaybe<Scalars['numeric']['input']>;
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
  /** fetch data from the table: "Session" */
  Session: Array<Session>;
  /** fetch data from the table: "Session" using primary key columns */
  Session_by_pk?: Maybe<Session>;
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


export type Query_RootSessionArgs = {
  distinct_on?: InputMaybe<Array<Session_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Session_Order_By>>;
  where?: InputMaybe<Session_Bool_Exp>;
};


export type Query_RootSession_By_PkArgs = {
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
  /** fetch data from the table: "Session" */
  Session: Array<Session>;
  /** fetch data from the table: "Session" using primary key columns */
  Session_by_pk?: Maybe<Session>;
  /** fetch data from the table in a streaming manner: "Session" */
  Session_stream: Array<Session>;
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


export type Subscription_RootSessionArgs = {
  distinct_on?: InputMaybe<Array<Session_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Session_Order_By>>;
  where?: InputMaybe<Session_Bool_Exp>;
};


export type Subscription_RootSession_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootSession_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Session_Stream_Cursor_Input>>;
  where?: InputMaybe<Session_Bool_Exp>;
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


export const SessionIndexedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionIndexed"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"Session"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"children"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<SessionIndexedQuery, SessionIndexedQueryVariables>;
export const SessionByMetadataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionByMetadata"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"deployer"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataUri"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"since"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"numeric"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"Session"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"deployer"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"deployer"}}}]}},{"kind":"ObjectField","name":{"kind":"Name","value":"metadataUri"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataUri"}}}]}},{"kind":"ObjectField","name":{"kind":"Name","value":"openedAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_gte"},"value":{"kind":"Variable","name":{"kind":"Name","value":"since"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"order_by"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"openedAt"},"value":{"kind":"EnumValue","value":"desc"}}]}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"parentMarket"}},{"kind":"Field","name":{"kind":"Name","value":"transactionHash"}},{"kind":"Field","name":{"kind":"Name","value":"children"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"order_by"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"parentOutcomeIndex"},"value":{"kind":"EnumValue","value":"asc"}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"parentOutcomeIndex"}},{"kind":"Field","name":{"kind":"Name","value":"transactionHash"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"chain_metadata"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"latest_processed_block"}},{"kind":"Field","name":{"kind":"Name","value":"block_height"}}]}}]}}]} as unknown as DocumentNode<SessionByMetadataQuery, SessionByMetadataQueryVariables>;