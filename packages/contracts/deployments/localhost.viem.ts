//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SessionFactory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 *
 */
export const sessionFactoryAbi = [
  {
    type: "constructor",
    inputs: [{ name: "_factory", internalType: "contract ISeerMarketFactory", type: "address" }],
    stateMutability: "nonpayable",
  },
  { type: "error", inputs: [], name: "ChildBatchExceedsExpected" },
  { type: "error", inputs: [], name: "InvalidConfig" },
  { type: "error", inputs: [], name: "MissingMetadata" },
  { type: "error", inputs: [], name: "NotSessionDeployer" },
  { type: "error", inputs: [], name: "SessionAlreadyComplete" },
  {
    type: "event",
    anonymous: false,
    inputs: [
      { name: "sessionId", internalType: "uint256", type: "uint256", indexed: true },
      { name: "parentOutcomeIndex", internalType: "uint256", type: "uint256", indexed: true },
      { name: "childMarket", internalType: "address", type: "address", indexed: true },
      { name: "parentMarket", internalType: "address", type: "address", indexed: false },
    ],
    name: "ChildMarketDeployed",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      { name: "sessionId", internalType: "uint256", type: "uint256", indexed: true },
      { name: "deployer", internalType: "address", type: "address", indexed: true },
      { name: "parentMarket", internalType: "address", type: "address", indexed: true },
      { name: "outcomeCount", internalType: "uint256", type: "uint256", indexed: false },
      { name: "metadataUri", internalType: "string", type: "string", indexed: false },
    ],
    name: "ParentMarketDeployed",
  },
  {
    type: "function",
    inputs: [
      {
        name: "params",
        internalType: "struct SessionFactory.DeploySessionParams",
        type: "tuple",
        components: [
          {
            name: "parent",
            internalType: "struct SessionFactory.ParentCategoricalConfig",
            type: "tuple",
            components: [
              { name: "marketName", internalType: "string", type: "string" },
              { name: "outcomes", internalType: "string[]", type: "string[]" },
              { name: "tokenNames", internalType: "string[]", type: "string[]" },
              { name: "category", internalType: "string", type: "string" },
              { name: "lang", internalType: "string", type: "string" },
              { name: "minBond", internalType: "uint256", type: "uint256" },
              { name: "openingTime", internalType: "uint32", type: "uint32" },
            ],
          },
          {
            name: "children",
            internalType: "struct SessionFactory.ChildScalarConfig[]",
            type: "tuple[]",
            components: [
              { name: "parentOutcomeIndex", internalType: "uint256", type: "uint256" },
              { name: "marketName", internalType: "string", type: "string" },
              { name: "outcomes", internalType: "string[]", type: "string[]" },
              { name: "tokenNames", internalType: "string[]", type: "string[]" },
              { name: "lowerBound", internalType: "uint256", type: "uint256" },
              { name: "upperBound", internalType: "uint256", type: "uint256" },
              { name: "minBond", internalType: "uint256", type: "uint256" },
              { name: "openingTime", internalType: "uint32", type: "uint32" },
              { name: "category", internalType: "string", type: "string" },
              { name: "lang", internalType: "string", type: "string" },
            ],
          },
          { name: "multiCategoricalParent", internalType: "bool", type: "bool" },
          { name: "metadataUri", internalType: "string", type: "string" },
        ],
      },
    ],
    name: "deploySession",
    outputs: [
      { name: "sessionId", internalType: "uint256", type: "uint256" },
      { name: "parentAddress", internalType: "address", type: "address" },
      { name: "childMarkets", internalType: "address[]", type: "address[]" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "sessionId", internalType: "uint256", type: "uint256" },
      {
        name: "childBatch",
        internalType: "struct SessionFactory.ChildScalarConfig[]",
        type: "tuple[]",
        components: [
          { name: "parentOutcomeIndex", internalType: "uint256", type: "uint256" },
          { name: "marketName", internalType: "string", type: "string" },
          { name: "outcomes", internalType: "string[]", type: "string[]" },
          { name: "tokenNames", internalType: "string[]", type: "string[]" },
          { name: "lowerBound", internalType: "uint256", type: "uint256" },
          { name: "upperBound", internalType: "uint256", type: "uint256" },
          { name: "minBond", internalType: "uint256", type: "uint256" },
          { name: "openingTime", internalType: "uint32", type: "uint32" },
          { name: "category", internalType: "string", type: "string" },
          { name: "lang", internalType: "string", type: "string" },
        ],
      },
    ],
    name: "deploySessionChildBatch",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "sessionId", internalType: "uint256", type: "uint256" }],
    name: "getSession",
    outputs: [
      {
        name: "session",
        internalType: "struct SessionFactory.Session",
        type: "tuple",
        components: [
          { name: "deployer", internalType: "address", type: "address" },
          { name: "parentMarket", internalType: "address", type: "address" },
          { name: "childMarkets", internalType: "address[]", type: "address[]" },
          { name: "openedAt", internalType: "uint64", type: "uint64" },
          { name: "completedAt", internalType: "uint64", type: "uint64" },
          { name: "expectedChildCount", internalType: "uint256", type: "uint256" },
          { name: "metadataUri", internalType: "string", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {
        name: "parent",
        internalType: "struct SessionFactory.ParentCategoricalConfig",
        type: "tuple",
        components: [
          { name: "marketName", internalType: "string", type: "string" },
          { name: "outcomes", internalType: "string[]", type: "string[]" },
          { name: "tokenNames", internalType: "string[]", type: "string[]" },
          { name: "category", internalType: "string", type: "string" },
          { name: "lang", internalType: "string", type: "string" },
          { name: "minBond", internalType: "uint256", type: "uint256" },
          { name: "openingTime", internalType: "uint32", type: "uint32" },
        ],
      },
      { name: "multiCategoricalParent", internalType: "bool", type: "bool" },
      { name: "metadataUri", internalType: "string", type: "string" },
    ],
    name: "openPhasedSession",
    outputs: [
      { name: "sessionId", internalType: "uint256", type: "uint256" },
      { name: "parentAddress", internalType: "address", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "seerMarketFactory",
    outputs: [{ name: "", internalType: "contract ISeerMarketFactory", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "sessionCount",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "sessionId", internalType: "uint256", type: "uint256" }],
    name: "sessions",
    outputs: [
      { name: "deployer", internalType: "address", type: "address" },
      { name: "parentMarket", internalType: "address", type: "address" },
      { name: "openedAt", internalType: "uint64", type: "uint64" },
      { name: "completedAt", internalType: "uint64", type: "uint64" },
      { name: "expectedChildCount", internalType: "uint256", type: "uint256" },
      { name: "metadataUri", internalType: "string", type: "string" },
    ],
    stateMutability: "view",
  },
] as const;

/**
 *
 */
export const sessionFactoryAddress = {
  31337: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
} as const;

/**
 *
 */
export const sessionFactoryConfig = { address: sessionFactoryAddress, abi: sessionFactoryAbi } as const;
