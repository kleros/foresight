import {
  decodeFunctionData,
  erc20Abi,
  isAddressEqual,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

import type { PredictOption } from "../../types";

const GNOSIS_ROUTER_ABI = parseAbi([
  "function splitPosition(address collateralToken, address market, uint256 amount)",
  "function mergePositions(address collateralToken, address market, uint256 amount)",
  "function splitFromBase(address market) payable",
]);

/**
 * Every balance a predict run can move, read for the owner, the trade wallet and the contracts
 * that only route money, so a run's effect is the difference of two readings.
 */
export interface LedgerScope {
  owner: Address;
  executor: Address;
  /** The credits manager, whose collateral the credits spend. */
  manager: Address;
  /** Contracts that pass money on and must hold none of it afterwards. */
  passThrough: Address[];
  collateral: Address;
  wxdai: Address;
  credits: Address;
  options: PredictOption[];
}

export interface Ledger {
  block: bigint;
  native: Map<Address, bigint>;
  /** holder → token → balance */
  tokens: Map<Address, Map<Address, bigint>>;
  creditsSupply: bigint;
}

const holdersOf = (scope: LedgerScope) => [scope.owner, scope.executor, scope.manager, ...scope.passThrough];

export const tokensOf = (scope: LedgerScope): Address[] => [
  scope.collateral,
  scope.wxdai,
  scope.credits,
  ...scope.options.flatMap((option) => [option.underlying, option.upToken, option.downToken, option.invalidToken]),
];

export async function readLedger(client: PublicClient, scope: LedgerScope, block?: bigint): Promise<Ledger> {
  const blockNumber = block ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const holders = holdersOf(scope);
  const tokens = tokensOf(scope);
  const at = { blockNumber };

  const native = new Map<Address, bigint>();
  const held = new Map<Address, Map<Address, bigint>>();
  for (const holder of holders) {
    native.set(holder, await client.getBalance({ address: holder, ...at }));
    const row = new Map<Address, bigint>();
    for (const token of tokens) {
      row.set(
        token,
        await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder], ...at }),
      );
    }
    held.set(holder, row);
  }
  const creditsSupply = await client.readContract({
    address: scope.credits,
    abi: erc20Abi,
    functionName: "totalSupply",
    ...at,
  });
  return { block: blockNumber, native, tokens: held, creditsSupply };
}

/** after − before of `holder`'s `token`; `native` for the gas token. */
export function moved(before: Ledger, after: Ledger, holder: Address, token: Address | "native"): bigint {
  if (token === "native") return (after.native.get(holder) ?? 0n) - (before.native.get(holder) ?? 0n);
  return (after.tokens.get(holder)?.get(token) ?? 0n) - (before.tokens.get(holder)?.get(token) ?? 0n);
}

/** Native the owner paid for gas across `receipts`. */
export const gasPaid = (receipts: TransactionReceipt[]) =>
  receipts.reduce((sum, receipt) => sum + receipt.gasUsed * receipt.effectiveGasPrice, 0n);

const TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

/**
 * The ERC-20 recipients across `receipts` that are neither the owner, the trade wallet, the zero
 * address nor a contract: money the run sent to an outside account.
 */
export async function outsideRecipients(
  client: PublicClient,
  receipts: TransactionReceipt[],
  scope: Pick<LedgerScope, "owner" | "executor">,
): Promise<Address[]> {
  const recipients = new Set<Address>();
  for (const receipt of receipts) {
    for (const log of parseEventLogs({ abi: TRANSFER, eventName: "Transfer", logs: receipt.logs })) {
      recipients.add(log.args.to);
    }
  }
  const outside: Address[] = [];
  for (const to of recipients) {
    if (isAddressEqual(to, scope.owner) || isAddressEqual(to, scope.executor) || BigInt(to) === 0n) continue;
    const code = await client.getCode({ address: to });
    if (!code || code === "0x") outside.push(to);
  }
  return outside;
}

export const ALGEBRA_SWAP_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)",
]);

/** One option's legs as a batch signs them. */
export interface SignedOption {
  childSplit: bigint;
  merge: bigint;
  /** lower-case token → what the legs give in and the least they take out */
  sold: Map<Address, bigint>;
  boughtAtLeast: Map<Address, bigint>;
  legInputs: { tokenIn: Address; amountIn: bigint; pool: "up" | "down" }[];
}

const lower = (address: Address) => address.toLowerCase() as Address;

/** What a batch's calls sign for each option: its child split, its merge, and each swap leg. */
export function signedOptions(
  calls: readonly { to: Address; data: Hex }[],
  options: PredictOption[],
  routers: { gnosisRouter: Address; swaprRouter: Address },
): Map<Address, SignedOption> {
  const out = new Map<Address, SignedOption>();
  const ofToken = (token: Address) =>
    options.find((option) =>
      [option.underlying, option.upToken, option.downToken].some((each) => isAddressEqual(each, token)),
    );
  const row = (option: PredictOption) => {
    let entry = out.get(option.childMarket);
    if (!entry) {
      entry = { childSplit: 0n, merge: 0n, sold: new Map(), boughtAtLeast: new Map(), legInputs: [] };
      out.set(option.childMarket, entry);
    }
    return entry;
  };

  for (const call of calls) {
    if (isAddressEqual(call.to, routers.gnosisRouter)) {
      const decoded = decodeFunctionData({ abi: GNOSIS_ROUTER_ABI, data: call.data });
      if (decoded.functionName === "splitFromBase") continue;
      const [, market, amount] = decoded.args;
      const option = options.find((each) => isAddressEqual(each.childMarket, market));
      if (!option) continue;
      if (decoded.functionName === "splitPosition") row(option).childSplit += amount;
      if (decoded.functionName === "mergePositions") row(option).merge += amount;
      continue;
    }
    if (!isAddressEqual(call.to, routers.swaprRouter)) continue;
    const [params] = decodeFunctionData({ abi: ALGEBRA_SWAP_ABI, data: call.data }).args;
    const option = ofToken(params.tokenIn) ?? ofToken(params.tokenOut);
    if (!option) continue;
    const entry = row(option);
    const outcomeIn = !isAddressEqual(params.tokenIn, option.underlying);
    const [tokenIn, tokenOut] = [lower(params.tokenIn), lower(params.tokenOut)];
    entry.sold.set(tokenIn, (entry.sold.get(tokenIn) ?? 0n) + params.amountIn);
    entry.boughtAtLeast.set(tokenOut, (entry.boughtAtLeast.get(tokenOut) ?? 0n) + params.amountOutMinimum);
    const outcome = outcomeIn ? params.tokenIn : params.tokenOut;
    entry.legInputs.push({
      tokenIn: params.tokenIn,
      amountIn: params.amountIn,
      pool: isAddressEqual(outcome, option.upToken) ? "up" : "down",
    });
  }
  return out;
}
