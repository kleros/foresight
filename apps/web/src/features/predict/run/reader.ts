"use client";

import { erc20Abi, erc4626Abi, getAbiItem, isAddressEqual, type Address, type Hash, type PublicClient } from "viem";

import { readPoolLiquidity, type PoolRef } from "@/lib/swap/algebraPool";
import { fetchTokenBalances } from "@/lib/trade-executor/balances";

import type { PoolLiquidity } from "@/types/pool";

import { fetchSessionPools, optionPoolRefs } from "../api/getOptionPools";
import type { LandedTx, OptionChainState, PredictReader } from "../flow/types";
import { sqrtPriceX96FromPrice } from "../utils/poolMath";

const WAD = 10n ** 18n;

const TRANSFER = getAbiItem({ abi: erc20Abi, name: "Transfer" });

/** A side with no pool, which `volumeUntilPrice` sizes to nothing. */
const UNPRICED: PoolLiquidity = { sqrtPriceX96: 0n, tick: 0, liquidity: 0n, fee: 0n, ticks: [], outcomeIsToken0: true };

/**
 * What the plan reads before it builds. Everything that decides an amount comes from the chain:
 * the indexer only says where the pools are.
 */
export function createPredictReader(args: {
  client: PublicClient;
  sessionId: string;
  collateral: Address;
  /** Where the chain has Foresight credits for this collateral. */
  credits?: { token: Address; manager: Address } | null;
  /** The owner's transaction count as the wallet's own node reads it, which sees its broadcasts first. */
  walletNonce?: (owner: Address, blockTag: "latest" | "pending") => Promise<number>;
}): PredictReader {
  const appCounts = (owner: Address) =>
    Promise.all([
      args.client.getTransactionCount({ address: owner, blockTag: "latest" }),
      args.client.getTransactionCount({ address: owner, blockTag: "pending" }),
    ]);

  /** The owner's mined and broadcast counts, both from the wallet's node where it answers, else both from the app's. */
  async function nonceCounts(owner: Address): Promise<[mined: number, broadcast: number]> {
    const wallet = args.walletNonce;
    if (!wallet) return appCounts(owner);
    return Promise.all([wallet(owner, "latest"), wallet(owner, "pending")]).catch(() => appCounts(owner));
  }

  const balanceOf = (token: Address, holder: Address) =>
    args.client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] });

  const poolState = async (ref: PoolRef | undefined, targetPriceWad: bigint): Promise<PoolLiquidity> =>
    ref === undefined
      ? UNPRICED
      : readPoolLiquidity(args.client, ref, sqrtPriceX96FromPrice(targetPriceWad, ref.outcomeIsToken0));

  /** `owner`'s transaction with `nonce` in block `blockNumber`, if it holds one. */
  const sentIn = async (blockNumber: bigint, owner: Address, nonce: number) =>
    (await args.client.getBlock({ blockNumber, includeTransactions: true })).transactions.find(
      (each) => isAddressEqual(each.from, owner) && each.nonce === nonce,
    );

  /**
   * The block from `fromBlock` to `head` that mined `owner`'s `nonce`, found from the owner's count after each
   * block, which first passes `nonce` there; null where it was mined before `fromBlock`. A pruned node rejects.
   */
  async function blockMining(owner: Address, nonce: number, fromBlock: bigint, head: bigint): Promise<bigint | null> {
    const countAfter = (blockNumber: bigint) => args.client.getTransactionCount({ address: owner, blockNumber });
    if (fromBlock > 0n && (await countAfter(fromBlock - 1n)) > nonce) return null;
    let [low, high] = [fromBlock, head];
    while (low < high) {
      const middle = (low + high) / 2n;
      if ((await countAfter(middle)) > nonce) high = middle;
      else low = middle + 1n;
    }
    return low;
  }

  /** The same transaction, looked for block by block from `head` down, for a node that keeps no past state. */
  async function walkedTo(owner: Address, nonce: number, fromBlock: bigint, head: bigint) {
    for (let number = head; number >= fromBlock; number--) {
      const tx = await sentIn(number, owner, nonce);
      if (tx) return tx;
    }
    return undefined;
  }

  return {
    async isExecutorDeployed(executor) {
      const code = await args.client.getCode({ address: executor });
      return code !== undefined && code !== "0x";
    },

    collateralBalance(executor) {
      return balanceOf(args.collateral, executor);
    },

    async creditsBalance(holder) {
      return args.credits ? balanceOf(args.credits.token, holder) : 0n;
    },

    async managerCollateral() {
      return args.credits ? balanceOf(args.collateral, args.credits.manager) : 0n;
    },

    previewDeposit(assets) {
      return args.client.readContract({
        address: args.collateral,
        abi: erc4626Abi,
        functionName: "previewDeposit",
        args: [assets],
      });
    },

    vaultValue(shares) {
      return args.client.readContract({
        address: args.collateral,
        abi: erc4626Abi,
        functionName: "convertToAssets",
        args: [shares],
      });
    },

    latestBlock() {
      return args.client.getBlockNumber();
    },

    async latestTimestamp() {
      return (await args.client.getBlock()).timestamp;
    },

    async blockGasLimit() {
      return (await args.client.getBlock()).gasLimit;
    },

    estimateGas({ from, to, data, value }) {
      return args.client.estimateGas({ account: from, to, data, value });
    },

    async landedSince({ owner, executor, fromBlock }) {
      const tokens = [args.collateral, ...(args.credits ? [args.credits.token] : [])];
      const [outgoing, incoming] = await Promise.all([
        args.client.getLogs({ address: tokens, event: TRANSFER, args: { from: executor }, fromBlock }),
        args.client.getLogs({ address: tokens, event: TRANSFER, args: { to: executor }, fromBlock }),
      ]);

      const received = new Map<Hash, bigint>();
      for (const log of [...outgoing, ...incoming]) {
        if (log.transactionHash === null) continue;
        const into = isAddressEqual(log.address, args.collateral) && isAddressEqual(log.args.to!, executor);
        received.set(log.transactionHash, (received.get(log.transactionHash) ?? 0n) + (into ? log.args.value! : 0n));
      }

      // a log exists only for a transaction that succeeded
      const landed = await Promise.all(
        [...received].map(async ([hash, collateralReceived]): Promise<LandedTx | null> => {
          const tx = await args.client.getTransaction({ hash });
          if (tx.to === null || !isAddressEqual(tx.from, owner)) return null;
          return { to: tx.to, value: tx.value, input: tx.input, collateralReceived };
        }),
      );
      return landed.filter((tx): tx is LandedTx => tx !== null);
    },

    async hasPending(owner) {
      const [latest, pending] = await nonceCounts(owner);
      return pending > latest;
    },

    async nextNonce(owner) {
      return (await nonceCounts(owner))[1];
    },

    async sentWithNonce({ owner, nonce, fromBlock }) {
      const [mined, broadcast] = await nonceCounts(owner);
      if (mined <= nonce) return { status: broadcast > nonce ? "pending" : "none" };
      // the blocks are searched on the app's node, which may not have reached the block the wallet's node mined it in
      if (
        args.walletNonce &&
        (await args.client.getTransactionCount({ address: owner, blockTag: "latest" })) <= nonce
      ) {
        return { status: "pending" };
      }

      const head = await args.client.getBlockNumber({ cacheTime: 0 });
      const minedIn = await blockMining(owner, nonce, fromBlock, head).catch(() => undefined);
      if (minedIn === null) return { status: "taken" };
      const tx =
        minedIn === undefined ? await walkedTo(owner, nonce, fromBlock, head) : await sentIn(minedIn, owner, nonce);
      if (!tx || tx.to === null) return { status: "taken" };
      const receipt = await args.client.getTransactionReceipt({ hash: tx.hash });
      return {
        status: "mined",
        hash: tx.hash,
        to: tx.to,
        value: tx.value,
        input: tx.input,
        success: receipt.status === "success",
      };
    },

    async optionStates({ options, executor }) {
      const [refs, balances] = await Promise.all([
        fetchSessionPools(args.sessionId),
        fetchTokenBalances(args.client, {
          holder: executor,
          tokens: options.flatMap((option) => [
            option.upToken,
            option.downToken,
            option.invalidToken,
            option.underlying,
          ]),
        }),
      ]);

      return Promise.all(
        options.map(async (option, index): Promise<OptionChainState> => {
          const sides = optionPoolRefs(refs, option.childMarket);
          const [up, down] = await Promise.all([
            poolState(sides.up, option.targetPriceWad),
            poolState(sides.down, WAD - option.targetPriceWad),
          ]);
          const at = index * 4;

          return {
            pools: { up, down },
            held: { up: balances[at] ?? 0n, down: balances[at + 1] ?? 0n, invalid: balances[at + 2] ?? 0n },
            underlying: balances[at + 3] ?? 0n,
          };
        }),
      );
    },
  };
}
