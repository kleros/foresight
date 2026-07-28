/* eslint-disable */
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
  BigDecimal: { input: string; output: string; }
  BigInt: { input: string; output: string; }
  Bytes: { input: `0x${string}`; output: `0x${string}`; }
  /** 8 bytes signed integer */
  Int8: { input: any; output: any; }
  /** A string representation of microseconds UNIX timestamp (16 digits) */
  Timestamp: { input: any; output: any; }
};

export enum Aggregation_Interval {
  Day = 'day',
  Hour = 'hour'
}

export type BlockChangedFilter = {
  number_gte: Scalars['Int']['input'];
};

export type Block_Height = {
  hash?: InputMaybe<Scalars['Bytes']['input']>;
  number?: InputMaybe<Scalars['Int']['input']>;
  number_gte?: InputMaybe<Scalars['Int']['input']>;
};

export type ChildMarket = {
  __typename?: 'ChildMarket';
  deployedAt: Scalars['BigInt']['output'];
  id: Scalars['ID']['output'];
  keyword: Scalars['String']['output'];
  lowerBound: Scalars['BigInt']['output'];
  marketName: Scalars['String']['output'];
  parentOutcome: Scalars['String']['output'];
  parentOutcomeIndex: Scalars['BigInt']['output'];
  session: Session;
  transactionHash: Scalars['Bytes']['output'];
  upperBound: Scalars['BigInt']['output'];
};

export type ChildMarket_Filter = {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<ChildMarket_Filter>>>;
  deployedAt?: InputMaybe<Scalars['BigInt']['input']>;
  deployedAt_gt?: InputMaybe<Scalars['BigInt']['input']>;
  deployedAt_gte?: InputMaybe<Scalars['BigInt']['input']>;
  deployedAt_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  deployedAt_lt?: InputMaybe<Scalars['BigInt']['input']>;
  deployedAt_lte?: InputMaybe<Scalars['BigInt']['input']>;
  deployedAt_not?: InputMaybe<Scalars['BigInt']['input']>;
  deployedAt_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  id?: InputMaybe<Scalars['ID']['input']>;
  id_gt?: InputMaybe<Scalars['ID']['input']>;
  id_gte?: InputMaybe<Scalars['ID']['input']>;
  id_in?: InputMaybe<Array<Scalars['ID']['input']>>;
  id_lt?: InputMaybe<Scalars['ID']['input']>;
  id_lte?: InputMaybe<Scalars['ID']['input']>;
  id_not?: InputMaybe<Scalars['ID']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['ID']['input']>>;
  keyword?: InputMaybe<Scalars['String']['input']>;
  keyword_contains?: InputMaybe<Scalars['String']['input']>;
  keyword_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  keyword_ends_with?: InputMaybe<Scalars['String']['input']>;
  keyword_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  keyword_gt?: InputMaybe<Scalars['String']['input']>;
  keyword_gte?: InputMaybe<Scalars['String']['input']>;
  keyword_in?: InputMaybe<Array<Scalars['String']['input']>>;
  keyword_lt?: InputMaybe<Scalars['String']['input']>;
  keyword_lte?: InputMaybe<Scalars['String']['input']>;
  keyword_not?: InputMaybe<Scalars['String']['input']>;
  keyword_not_contains?: InputMaybe<Scalars['String']['input']>;
  keyword_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  keyword_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  keyword_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  keyword_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  keyword_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  keyword_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  keyword_starts_with?: InputMaybe<Scalars['String']['input']>;
  keyword_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  lowerBound?: InputMaybe<Scalars['BigInt']['input']>;
  lowerBound_gt?: InputMaybe<Scalars['BigInt']['input']>;
  lowerBound_gte?: InputMaybe<Scalars['BigInt']['input']>;
  lowerBound_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  lowerBound_lt?: InputMaybe<Scalars['BigInt']['input']>;
  lowerBound_lte?: InputMaybe<Scalars['BigInt']['input']>;
  lowerBound_not?: InputMaybe<Scalars['BigInt']['input']>;
  lowerBound_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  marketName?: InputMaybe<Scalars['String']['input']>;
  marketName_contains?: InputMaybe<Scalars['String']['input']>;
  marketName_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  marketName_ends_with?: InputMaybe<Scalars['String']['input']>;
  marketName_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  marketName_gt?: InputMaybe<Scalars['String']['input']>;
  marketName_gte?: InputMaybe<Scalars['String']['input']>;
  marketName_in?: InputMaybe<Array<Scalars['String']['input']>>;
  marketName_lt?: InputMaybe<Scalars['String']['input']>;
  marketName_lte?: InputMaybe<Scalars['String']['input']>;
  marketName_not?: InputMaybe<Scalars['String']['input']>;
  marketName_not_contains?: InputMaybe<Scalars['String']['input']>;
  marketName_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  marketName_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  marketName_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  marketName_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  marketName_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  marketName_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  marketName_starts_with?: InputMaybe<Scalars['String']['input']>;
  marketName_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  or?: InputMaybe<Array<InputMaybe<ChildMarket_Filter>>>;
  parentOutcome?: InputMaybe<Scalars['String']['input']>;
  parentOutcomeIndex?: InputMaybe<Scalars['BigInt']['input']>;
  parentOutcomeIndex_gt?: InputMaybe<Scalars['BigInt']['input']>;
  parentOutcomeIndex_gte?: InputMaybe<Scalars['BigInt']['input']>;
  parentOutcomeIndex_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  parentOutcomeIndex_lt?: InputMaybe<Scalars['BigInt']['input']>;
  parentOutcomeIndex_lte?: InputMaybe<Scalars['BigInt']['input']>;
  parentOutcomeIndex_not?: InputMaybe<Scalars['BigInt']['input']>;
  parentOutcomeIndex_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  parentOutcome_contains?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_ends_with?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_gt?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_gte?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_in?: InputMaybe<Array<Scalars['String']['input']>>;
  parentOutcome_lt?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_lte?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_not?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_not_contains?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  parentOutcome_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_starts_with?: InputMaybe<Scalars['String']['input']>;
  parentOutcome_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  session?: InputMaybe<Scalars['String']['input']>;
  session_?: InputMaybe<Session_Filter>;
  session_contains?: InputMaybe<Scalars['String']['input']>;
  session_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  session_ends_with?: InputMaybe<Scalars['String']['input']>;
  session_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  session_gt?: InputMaybe<Scalars['String']['input']>;
  session_gte?: InputMaybe<Scalars['String']['input']>;
  session_in?: InputMaybe<Array<Scalars['String']['input']>>;
  session_lt?: InputMaybe<Scalars['String']['input']>;
  session_lte?: InputMaybe<Scalars['String']['input']>;
  session_not?: InputMaybe<Scalars['String']['input']>;
  session_not_contains?: InputMaybe<Scalars['String']['input']>;
  session_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  session_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  session_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  session_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  session_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  session_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  session_starts_with?: InputMaybe<Scalars['String']['input']>;
  session_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  upperBound?: InputMaybe<Scalars['BigInt']['input']>;
  upperBound_gt?: InputMaybe<Scalars['BigInt']['input']>;
  upperBound_gte?: InputMaybe<Scalars['BigInt']['input']>;
  upperBound_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  upperBound_lt?: InputMaybe<Scalars['BigInt']['input']>;
  upperBound_lte?: InputMaybe<Scalars['BigInt']['input']>;
  upperBound_not?: InputMaybe<Scalars['BigInt']['input']>;
  upperBound_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
};

export enum ChildMarket_OrderBy {
  DeployedAt = 'deployedAt',
  Id = 'id',
  Keyword = 'keyword',
  LowerBound = 'lowerBound',
  MarketName = 'marketName',
  ParentOutcome = 'parentOutcome',
  ParentOutcomeIndex = 'parentOutcomeIndex',
  Session = 'session',
  SessionCompletedAt = 'session__completedAt',
  SessionDeployedChildCount = 'session__deployedChildCount',
  SessionDeployer = 'session__deployer',
  SessionId = 'session__id',
  SessionKeyword = 'session__keyword',
  SessionMarketName = 'session__marketName',
  SessionOpenedAt = 'session__openedAt',
  SessionOutcomeCount = 'session__outcomeCount',
  SessionParentMarket = 'session__parentMarket',
  SessionSessionId = 'session__sessionId',
  SessionTransactionHash = 'session__transactionHash',
  TransactionHash = 'transactionHash',
  UpperBound = 'upperBound'
}

/** Defines the order direction, either ascending or descending */
export enum OrderDirection {
  Asc = 'asc',
  Desc = 'desc'
}

export type Query = {
  __typename?: 'Query';
  /** Access to subgraph metadata */
  _meta?: Maybe<_Meta_>;
  childMarket?: Maybe<ChildMarket>;
  childMarketSearch: Array<ChildMarket>;
  childMarkets: Array<ChildMarket>;
  marketSearch: Array<Session>;
  session?: Maybe<Session>;
  sessions: Array<Session>;
};


export type Query_MetaArgs = {
  block?: InputMaybe<Block_Height>;
};


export type QueryChildMarketArgs = {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
};


export type QueryChildMarketSearchArgs = {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  text: Scalars['String']['input'];
  where?: InputMaybe<ChildMarket_Filter>;
};


export type QueryChildMarketsArgs = {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ChildMarket_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<ChildMarket_Filter>;
};


export type QueryMarketSearchArgs = {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  text: Scalars['String']['input'];
  where?: InputMaybe<Session_Filter>;
};


export type QuerySessionArgs = {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
};


export type QuerySessionsArgs = {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<Session_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<Session_Filter>;
};

export type Session = {
  __typename?: 'Session';
  children: Array<ChildMarket>;
  completedAt: Scalars['BigInt']['output'];
  deployedChildCount: Scalars['BigInt']['output'];
  deployer: Scalars['Bytes']['output'];
  id: Scalars['ID']['output'];
  keyword: Scalars['String']['output'];
  marketName: Scalars['String']['output'];
  openedAt: Scalars['BigInt']['output'];
  outcomeCount: Scalars['BigInt']['output'];
  outcomes: Array<Scalars['String']['output']>;
  parentMarket: Scalars['Bytes']['output'];
  sessionId: Scalars['BigInt']['output'];
  transactionHash: Scalars['Bytes']['output'];
};


export type SessionChildrenArgs = {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ChildMarket_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<ChildMarket_Filter>;
};

export type Session_Filter = {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<Session_Filter>>>;
  children_?: InputMaybe<ChildMarket_Filter>;
  completedAt?: InputMaybe<Scalars['BigInt']['input']>;
  completedAt_gt?: InputMaybe<Scalars['BigInt']['input']>;
  completedAt_gte?: InputMaybe<Scalars['BigInt']['input']>;
  completedAt_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  completedAt_lt?: InputMaybe<Scalars['BigInt']['input']>;
  completedAt_lte?: InputMaybe<Scalars['BigInt']['input']>;
  completedAt_not?: InputMaybe<Scalars['BigInt']['input']>;
  completedAt_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  deployedChildCount?: InputMaybe<Scalars['BigInt']['input']>;
  deployedChildCount_gt?: InputMaybe<Scalars['BigInt']['input']>;
  deployedChildCount_gte?: InputMaybe<Scalars['BigInt']['input']>;
  deployedChildCount_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  deployedChildCount_lt?: InputMaybe<Scalars['BigInt']['input']>;
  deployedChildCount_lte?: InputMaybe<Scalars['BigInt']['input']>;
  deployedChildCount_not?: InputMaybe<Scalars['BigInt']['input']>;
  deployedChildCount_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  deployer?: InputMaybe<Scalars['Bytes']['input']>;
  deployer_contains?: InputMaybe<Scalars['Bytes']['input']>;
  deployer_gt?: InputMaybe<Scalars['Bytes']['input']>;
  deployer_gte?: InputMaybe<Scalars['Bytes']['input']>;
  deployer_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  deployer_lt?: InputMaybe<Scalars['Bytes']['input']>;
  deployer_lte?: InputMaybe<Scalars['Bytes']['input']>;
  deployer_not?: InputMaybe<Scalars['Bytes']['input']>;
  deployer_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  deployer_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id?: InputMaybe<Scalars['ID']['input']>;
  id_gt?: InputMaybe<Scalars['ID']['input']>;
  id_gte?: InputMaybe<Scalars['ID']['input']>;
  id_in?: InputMaybe<Array<Scalars['ID']['input']>>;
  id_lt?: InputMaybe<Scalars['ID']['input']>;
  id_lte?: InputMaybe<Scalars['ID']['input']>;
  id_not?: InputMaybe<Scalars['ID']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['ID']['input']>>;
  keyword?: InputMaybe<Scalars['String']['input']>;
  keyword_contains?: InputMaybe<Scalars['String']['input']>;
  keyword_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  keyword_ends_with?: InputMaybe<Scalars['String']['input']>;
  keyword_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  keyword_gt?: InputMaybe<Scalars['String']['input']>;
  keyword_gte?: InputMaybe<Scalars['String']['input']>;
  keyword_in?: InputMaybe<Array<Scalars['String']['input']>>;
  keyword_lt?: InputMaybe<Scalars['String']['input']>;
  keyword_lte?: InputMaybe<Scalars['String']['input']>;
  keyword_not?: InputMaybe<Scalars['String']['input']>;
  keyword_not_contains?: InputMaybe<Scalars['String']['input']>;
  keyword_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  keyword_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  keyword_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  keyword_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  keyword_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  keyword_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  keyword_starts_with?: InputMaybe<Scalars['String']['input']>;
  keyword_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  marketName?: InputMaybe<Scalars['String']['input']>;
  marketName_contains?: InputMaybe<Scalars['String']['input']>;
  marketName_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  marketName_ends_with?: InputMaybe<Scalars['String']['input']>;
  marketName_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  marketName_gt?: InputMaybe<Scalars['String']['input']>;
  marketName_gte?: InputMaybe<Scalars['String']['input']>;
  marketName_in?: InputMaybe<Array<Scalars['String']['input']>>;
  marketName_lt?: InputMaybe<Scalars['String']['input']>;
  marketName_lte?: InputMaybe<Scalars['String']['input']>;
  marketName_not?: InputMaybe<Scalars['String']['input']>;
  marketName_not_contains?: InputMaybe<Scalars['String']['input']>;
  marketName_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  marketName_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  marketName_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  marketName_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  marketName_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  marketName_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  marketName_starts_with?: InputMaybe<Scalars['String']['input']>;
  marketName_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  openedAt?: InputMaybe<Scalars['BigInt']['input']>;
  openedAt_gt?: InputMaybe<Scalars['BigInt']['input']>;
  openedAt_gte?: InputMaybe<Scalars['BigInt']['input']>;
  openedAt_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  openedAt_lt?: InputMaybe<Scalars['BigInt']['input']>;
  openedAt_lte?: InputMaybe<Scalars['BigInt']['input']>;
  openedAt_not?: InputMaybe<Scalars['BigInt']['input']>;
  openedAt_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  or?: InputMaybe<Array<InputMaybe<Session_Filter>>>;
  outcomeCount?: InputMaybe<Scalars['BigInt']['input']>;
  outcomeCount_gt?: InputMaybe<Scalars['BigInt']['input']>;
  outcomeCount_gte?: InputMaybe<Scalars['BigInt']['input']>;
  outcomeCount_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  outcomeCount_lt?: InputMaybe<Scalars['BigInt']['input']>;
  outcomeCount_lte?: InputMaybe<Scalars['BigInt']['input']>;
  outcomeCount_not?: InputMaybe<Scalars['BigInt']['input']>;
  outcomeCount_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  outcomes?: InputMaybe<Array<Scalars['String']['input']>>;
  outcomes_contains?: InputMaybe<Array<Scalars['String']['input']>>;
  outcomes_contains_nocase?: InputMaybe<Array<Scalars['String']['input']>>;
  outcomes_not?: InputMaybe<Array<Scalars['String']['input']>>;
  outcomes_not_contains?: InputMaybe<Array<Scalars['String']['input']>>;
  outcomes_not_contains_nocase?: InputMaybe<Array<Scalars['String']['input']>>;
  parentMarket?: InputMaybe<Scalars['Bytes']['input']>;
  parentMarket_contains?: InputMaybe<Scalars['Bytes']['input']>;
  parentMarket_gt?: InputMaybe<Scalars['Bytes']['input']>;
  parentMarket_gte?: InputMaybe<Scalars['Bytes']['input']>;
  parentMarket_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  parentMarket_lt?: InputMaybe<Scalars['Bytes']['input']>;
  parentMarket_lte?: InputMaybe<Scalars['Bytes']['input']>;
  parentMarket_not?: InputMaybe<Scalars['Bytes']['input']>;
  parentMarket_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  parentMarket_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  sessionId?: InputMaybe<Scalars['BigInt']['input']>;
  sessionId_gt?: InputMaybe<Scalars['BigInt']['input']>;
  sessionId_gte?: InputMaybe<Scalars['BigInt']['input']>;
  sessionId_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  sessionId_lt?: InputMaybe<Scalars['BigInt']['input']>;
  sessionId_lte?: InputMaybe<Scalars['BigInt']['input']>;
  sessionId_not?: InputMaybe<Scalars['BigInt']['input']>;
  sessionId_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
};

export enum Session_OrderBy {
  Children = 'children',
  CompletedAt = 'completedAt',
  DeployedChildCount = 'deployedChildCount',
  Deployer = 'deployer',
  Id = 'id',
  Keyword = 'keyword',
  MarketName = 'marketName',
  OpenedAt = 'openedAt',
  OutcomeCount = 'outcomeCount',
  Outcomes = 'outcomes',
  ParentMarket = 'parentMarket',
  SessionId = 'sessionId',
  TransactionHash = 'transactionHash'
}

export type _Block_ = {
  __typename?: '_Block_';
  /** The hash of the block */
  hash?: Maybe<Scalars['Bytes']['output']>;
  /** The block number */
  number: Scalars['Int']['output'];
  /** The hash of the parent block */
  parentHash?: Maybe<Scalars['Bytes']['output']>;
  /** Integer representation of the timestamp stored in blocks for the chain */
  timestamp?: Maybe<Scalars['Int']['output']>;
};

/** The type for the top-level _meta field */
export type _Meta_ = {
  __typename?: '_Meta_';
  /**
   * Information about a specific subgraph block. The hash of the block
   * will be null if the _meta field has a block constraint that asks for
   * a block number. It will be filled if the _meta field has no block constraint
   * and therefore asks for the latest  block
   */
  block: _Block_;
  /** The deployment ID */
  deployment: Scalars['String']['output'];
  /** If `true`, the subgraph encountered indexing errors at some past block */
  hasIndexingErrors: Scalars['Boolean']['output'];
};

export enum _SubgraphErrorPolicy_ {
  /** Data will be returned even if the subgraph has indexing errors */
  Allow = 'allow',
  /** If the subgraph has indexing errors, data will be omitted. The default. */
  Deny = 'deny'
}
