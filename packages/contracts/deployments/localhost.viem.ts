//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// CreditsManager
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 *
 */
export const creditsManagerAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_token", internalType: "contract ERC20", type: "address" },
      { name: "_seerCredits", internalType: "contract SeerCredits", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "_user", internalType: "address", type: "address" },
      { name: "_amount", internalType: "uint256", type: "uint256" },
    ],
    name: "canSpendCredits",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "_governor", internalType: "address", type: "address" }],
    name: "changeGovernor",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "to", internalType: "address", type: "address" },
      { name: "data", internalType: "bytes", type: "bytes" },
      { name: "amount", internalType: "uint256", type: "uint256" },
      { name: "outputToken", internalType: "contract ERC20", type: "address" },
    ],
    name: "execute",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "governor",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "seerCredits",
    outputs: [{ name: "", internalType: "contract SeerCredits", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "_contract", internalType: "address", type: "address" },
      { name: "_whitelisted", internalType: "bool", type: "bool" },
    ],
    name: "setWhitelistedContract",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "_token", internalType: "contract ERC20", type: "address" }],
    name: "sweepTokens",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "token",
    outputs: [{ name: "", internalType: "contract ERC20", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "whitelistedContracts",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view",
  },
] as const;

/**
 *
 */
export const creditsManagerAddress = {
  31337: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
} as const;

/**
 *
 */
export const creditsManagerConfig = { address: creditsManagerAddress, abi: creditsManagerAbi } as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ForesightCredits
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 *
 */
export const foresightCreditsAbi = [
  {
    type: "constructor",
    inputs: [{ name: "_governor", internalType: "address", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      { name: "owner", internalType: "address", type: "address", indexed: true },
      { name: "spender", internalType: "address", type: "address", indexed: true },
      { name: "amount", internalType: "uint256", type: "uint256", indexed: false },
    ],
    name: "Approval",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      { name: "from", internalType: "address", type: "address", indexed: true },
      { name: "to", internalType: "address", type: "address", indexed: true },
      { name: "amount", internalType: "uint256", type: "uint256", indexed: false },
    ],
    name: "Transfer",
  },
  {
    type: "function",
    inputs: [],
    name: "DOMAIN_SEPARATOR",
    outputs: [{ name: "", internalType: "bytes32", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "_addresses", internalType: "address[]", type: "address[]" },
      { name: "_amounts", internalType: "uint256[]", type: "uint256[]" },
    ],
    name: "addCreditsBalance",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "", internalType: "address", type: "address" },
      { name: "", internalType: "address", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "spender", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "from", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
    ],
    name: "burn",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "_creditsManager", internalType: "address", type: "address" }],
    name: "changeCreditsManager",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "_governor", internalType: "address", type: "address" }],
    name: "changeGovernor",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "creditsManager",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", internalType: "uint8", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "governor",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "isAdmin",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "to", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "name",
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "address", type: "address" }],
    name: "nonces",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "owner", internalType: "address", type: "address" },
      { name: "spender", internalType: "address", type: "address" },
      { name: "value", internalType: "uint256", type: "uint256" },
      { name: "deadline", internalType: "uint256", type: "uint256" },
      { name: "v", internalType: "uint8", type: "uint8" },
      { name: "r", internalType: "bytes32", type: "bytes32" },
      { name: "s", internalType: "bytes32", type: "bytes32" },
    ],
    name: "permit",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "_admin", internalType: "address", type: "address" },
      { name: "_isAdmin", internalType: "bool", type: "bool" },
    ],
    name: "setAdmin",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "_addresses", internalType: "address[]", type: "address[]" },
      { name: "_amounts", internalType: "uint256[]", type: "uint256[]" },
    ],
    name: "setCreditsBalance",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "totalSupply",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "to", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "from", internalType: "address", type: "address" },
      { name: "to", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
    ],
    name: "transferFrom",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

/**
 *
 */
export const foresightCreditsAddress = {
  31337: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
} as const;

/**
 *
 */
export const foresightCreditsConfig = { address: foresightCreditsAddress, abi: foresightCreditsAbi } as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SavingsXDai
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 *
 */
export const savingsXDaiAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "name_", internalType: "string", type: "string" },
      { name: "symbol_", internalType: "string", type: "string" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "error",
    inputs: [
      { name: "spender", internalType: "address", type: "address" },
      { name: "allowance", internalType: "uint256", type: "uint256" },
      { name: "needed", internalType: "uint256", type: "uint256" },
    ],
    name: "ERC20InsufficientAllowance",
  },
  {
    type: "error",
    inputs: [
      { name: "sender", internalType: "address", type: "address" },
      { name: "balance", internalType: "uint256", type: "uint256" },
      { name: "needed", internalType: "uint256", type: "uint256" },
    ],
    name: "ERC20InsufficientBalance",
  },
  {
    type: "error",
    inputs: [{ name: "approver", internalType: "address", type: "address" }],
    name: "ERC20InvalidApprover",
  },
  {
    type: "error",
    inputs: [{ name: "receiver", internalType: "address", type: "address" }],
    name: "ERC20InvalidReceiver",
  },
  { type: "error", inputs: [{ name: "sender", internalType: "address", type: "address" }], name: "ERC20InvalidSender" },
  {
    type: "error",
    inputs: [{ name: "spender", internalType: "address", type: "address" }],
    name: "ERC20InvalidSpender",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      { name: "owner", internalType: "address", type: "address", indexed: true },
      { name: "spender", internalType: "address", type: "address", indexed: true },
      { name: "value", internalType: "uint256", type: "uint256", indexed: false },
    ],
    name: "Approval",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      { name: "from", internalType: "address", type: "address", indexed: true },
      { name: "to", internalType: "address", type: "address", indexed: true },
      { name: "value", internalType: "uint256", type: "uint256", indexed: false },
    ],
    name: "Transfer",
  },
  {
    type: "function",
    inputs: [
      { name: "owner", internalType: "address", type: "address" },
      { name: "spender", internalType: "address", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "spender", internalType: "address", type: "address" },
      { name: "value", internalType: "uint256", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "account", internalType: "address", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "account", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
    ],
    name: "burn",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", internalType: "uint8", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "account", internalType: "address", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "name",
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "totalSupply",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "to", internalType: "address", type: "address" },
      { name: "value", internalType: "uint256", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "from", internalType: "address", type: "address" },
      { name: "to", internalType: "address", type: "address" },
      { name: "value", internalType: "uint256", type: "uint256" },
    ],
    name: "transferFrom",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

/**
 *
 */
export const savingsXDaiAddress = {
  31337: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
} as const;

/**
 *
 */
export const savingsXDaiConfig = { address: savingsXDaiAddress, abi: savingsXDaiAbi } as const;

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

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// TradeExecutor
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const tradeExecutorAbi = [
  {
    type: "constructor",
    inputs: [{ name: "_owner", internalType: "address", type: "address" }],
    stateMutability: "nonpayable",
  },
  { type: "error", inputs: [], name: "CallFailed" },
  { type: "error", inputs: [], name: "EmptyBatch" },
  { type: "error", inputs: [], name: "NotOwner" },
  { type: "error", inputs: [{ name: "target", internalType: "address", type: "address" }], name: "TargetHasNoCode" },
  { type: "error", inputs: [], name: "ZeroOwner" },
  {
    type: "function",
    inputs: [
      {
        name: "calls",
        internalType: "struct TradeExecutor.Call[]",
        type: "tuple[]",
        components: [
          { name: "to", internalType: "address", type: "address" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "batchExecute",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      {
        name: "calls",
        internalType: "struct TradeExecutor.ValueCall[]",
        type: "tuple[]",
        components: [
          { name: "to", internalType: "address", type: "address" },
          { name: "value", internalType: "uint256", type: "uint256" },
          { name: "data", internalType: "bytes", type: "bytes" },
        ],
      },
    ],
    name: "batchValueExecute",
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  { type: "receive", stateMutability: "payable" },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// TradeExecutorFactory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 *
 */
export const tradeExecutorFactoryAbi = [
  { type: "error", inputs: [], name: "ExecutorAlreadyDeployed" },
  {
    type: "event",
    anonymous: false,
    inputs: [
      { name: "owner", internalType: "address", type: "address", indexed: true },
      { name: "executor", internalType: "address", type: "address", indexed: true },
    ],
    name: "ExecutorDeployed",
  },
  {
    type: "function",
    inputs: [],
    name: "SALT_KEY",
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "createExecutor",
    outputs: [{ name: "executor", internalType: "address", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "owner", internalType: "address", type: "address" }],
    name: "executorOf",
    outputs: [{ name: "executor", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "owner", internalType: "address", type: "address" }],
    name: "predictExecutor",
    outputs: [{ name: "executor", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "owner", internalType: "address", type: "address" }],
    name: "saltFor",
    outputs: [{ name: "salt", internalType: "bytes32", type: "bytes32" }],
    stateMutability: "pure",
  },
] as const;

/**
 *
 */
export const tradeExecutorFactoryAddress = {
  31337: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
} as const;

/**
 *
 */
export const tradeExecutorFactoryConfig = {
  address: tradeExecutorFactoryAddress,
  abi: tradeExecutorFactoryAbi,
} as const;
