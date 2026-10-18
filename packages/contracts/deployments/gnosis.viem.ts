//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// CreditsManager
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0x17592eFE59a318A6B0AFE32145ee04eAFeeA8A61)
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
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0x17592eFE59a318A6B0AFE32145ee04eAFeeA8A61)
 */
export const creditsManagerAddress = {
  100: "0x17592eFE59a318A6B0AFE32145ee04eAFeeA8A61",
} as const;

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0x17592eFE59a318A6B0AFE32145ee04eAFeeA8A61)
 */
export const creditsManagerConfig = { address: creditsManagerAddress, abi: creditsManagerAbi } as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ForesightCredits
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0x09E7014D2c15Eb8C5ee25853FE6842FF5E2c94f9)
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
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0x09E7014D2c15Eb8C5ee25853FE6842FF5E2c94f9)
 */
export const foresightCreditsAddress = {
  100: "0x09E7014D2c15Eb8C5ee25853FE6842FF5E2c94f9",
} as const;

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0x09E7014D2c15Eb8C5ee25853FE6842FF5E2c94f9)
 */
export const foresightCreditsConfig = { address: foresightCreditsAddress, abi: foresightCreditsAbi } as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// GnosisRouter
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xeC9048b59b3467415b1a38F63416407eA0c70fB8)
 */
export const gnosisRouterAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_conditionalTokens", internalType: "contract IConditionalTokens", type: "address" },
      { name: "_wrapped1155Factory", internalType: "contract IWrapped1155Factory", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "conditionalTokens",
    outputs: [{ name: "", internalType: "contract IConditionalTokens", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "collateralToken", internalType: "contract IERC20", type: "address" },
      { name: "parentCollectionId", internalType: "bytes32", type: "bytes32" },
      { name: "conditionId", internalType: "bytes32", type: "bytes32" },
      { name: "indexSet", internalType: "uint256", type: "uint256" },
    ],
    name: "getTokenId",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "conditionId", internalType: "bytes32", type: "bytes32" }],
    name: "getWinningOutcomes",
    outputs: [{ name: "", internalType: "bool[]", type: "bool[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "collateralToken", internalType: "contract IERC20", type: "address" },
      { name: "market", internalType: "contract Market", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
    ],
    name: "mergePositions",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "market", internalType: "contract Market", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
    ],
    name: "mergeToBase",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "", internalType: "address", type: "address" },
      { name: "", internalType: "address", type: "address" },
      { name: "", internalType: "uint256[]", type: "uint256[]" },
      { name: "", internalType: "uint256[]", type: "uint256[]" },
      { name: "", internalType: "bytes", type: "bytes" },
    ],
    name: "onERC1155BatchReceived",
    outputs: [{ name: "", internalType: "bytes4", type: "bytes4" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "", internalType: "address", type: "address" },
      { name: "", internalType: "address", type: "address" },
      { name: "", internalType: "uint256", type: "uint256" },
      { name: "", internalType: "uint256", type: "uint256" },
      { name: "", internalType: "bytes", type: "bytes" },
    ],
    name: "onERC1155Received",
    outputs: [{ name: "", internalType: "bytes4", type: "bytes4" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "collateralToken", internalType: "contract IERC20", type: "address" },
      { name: "market", internalType: "contract Market", type: "address" },
      { name: "outcomeIndexes", internalType: "uint256[]", type: "uint256[]" },
      { name: "amounts", internalType: "uint256[]", type: "uint256[]" },
    ],
    name: "redeemPositions",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "market", internalType: "contract Market", type: "address" },
      { name: "outcomeIndexes", internalType: "uint256[]", type: "uint256[]" },
      { name: "amounts", internalType: "uint256[]", type: "uint256[]" },
    ],
    name: "redeemToBase",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "sDAI",
    outputs: [{ name: "", internalType: "contract IERC20", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "savingsXDaiAdapter",
    outputs: [{ name: "", internalType: "contract ISavingsXDaiAdapter", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{ name: "market", internalType: "contract Market", type: "address" }],
    name: "splitFromBase",
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    inputs: [
      { name: "collateralToken", internalType: "contract IERC20", type: "address" },
      { name: "market", internalType: "contract Market", type: "address" },
      { name: "amount", internalType: "uint256", type: "uint256" },
    ],
    name: "splitPosition",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "interfaceId", internalType: "bytes4", type: "bytes4" }],
    name: "supportsInterface",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "wrapped1155Factory",
    outputs: [{ name: "", internalType: "contract IWrapped1155Factory", type: "address" }],
    stateMutability: "view",
  },
] as const;

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xeC9048b59b3467415b1a38F63416407eA0c70fB8)
 */
export const gnosisRouterAddress = {
  100: "0xeC9048b59b3467415b1a38F63416407eA0c70fB8",
} as const;

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xeC9048b59b3467415b1a38F63416407eA0c70fB8)
 */
export const gnosisRouterConfig = { address: gnosisRouterAddress, abi: gnosisRouterAbi } as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SavingsXDai
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xaf204776c7245bF4147c2612BF6e5972Ee483701)
 */
export const savingsXDaiAbi = [
  {
    type: "event",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
    name: "Approval",
  },
  {
    type: "event",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
    name: "Transfer",
  },
  {
    type: "function",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  { type: "function", inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", inputs: [], name: "name", outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", inputs: [], name: "totalSupply", outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      { name: "sender", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transferFrom",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xaf204776c7245bF4147c2612BF6e5972Ee483701)
 */
export const savingsXDaiAddress = {
  100: "0xaf204776c7245bF4147c2612BF6e5972Ee483701",
} as const;

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xaf204776c7245bF4147c2612BF6e5972Ee483701)
 */
export const savingsXDaiConfig = { address: savingsXDaiAddress, abi: savingsXDaiAbi } as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SavingsXDaiAdapter
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xD499b51fcFc66bd31248ef4b28d656d67E591A94)
 */
export const savingsXDaiAdapterAbi = [
  {
    type: "function",
    inputs: [{ name: "receiver", internalType: "address", type: "address" }],
    name: "depositXDAI",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    inputs: [
      { name: "shares", internalType: "uint256", type: "uint256" },
      { name: "receiver", internalType: "address", type: "address" },
    ],
    name: "redeemXDAI",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "payable",
  },
] as const;

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xD499b51fcFc66bd31248ef4b28d656d67E591A94)
 */
export const savingsXDaiAdapterAddress = {
  100: "0xD499b51fcFc66bd31248ef4b28d656d67E591A94",
} as const;

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xD499b51fcFc66bd31248ef4b28d656d67E591A94)
 */
export const savingsXDaiAdapterConfig = { address: savingsXDaiAdapterAddress, abi: savingsXDaiAdapterAbi } as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SessionFactory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xa5CC8a7372a771d24B1Bd55a160E20D94Cba0140)
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
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xa5CC8a7372a771d24B1Bd55a160E20D94Cba0140)
 */
export const sessionFactoryAddress = {
  100: "0xa5CC8a7372a771d24B1Bd55a160E20D94Cba0140",
} as const;

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0xa5CC8a7372a771d24B1Bd55a160E20D94Cba0140)
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
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0x28e3afBdF711755c4400e3d7F74Df5d3cc9C369C)
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
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0x28e3afBdF711755c4400e3d7F74Df5d3cc9C369C)
 */
export const tradeExecutorFactoryAddress = {
  100: "0x28e3afBdF711755c4400e3d7F74Df5d3cc9C369C",
} as const;

/**
 * [__View Contract on Gnosis Gnosisscan__](https://gnosisscan.io/address/0x28e3afBdF711755c4400e3d7F74Df5d3cc9C369C)
 */
export const tradeExecutorFactoryConfig = {
  address: tradeExecutorFactoryAddress,
  abi: tradeExecutorFactoryAbi,
} as const;
