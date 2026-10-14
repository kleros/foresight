import { CHAINS, LENS_QUOTER_ABI } from "@seer-pm/lens/client";
import {
  createPublicClient,
  custom,
  encodeErrorResult,
  encodeFunctionResult,
  HttpRequestError,
  isAddressEqual,
  maxUint256,
  numberToHex,
  parseAbi,
  toFunctionSelector,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { gnosis } from "viem/chains";

import { createLensQuoter } from "../../lens";
import type { SwapQuoter } from "../../types";

/** What a node answers to a JSON-RPC request: its result, or a rejection. */
export type NodeAnswer = (request: { method: string; params?: unknown }) => Promise<unknown>;

/** LensQuoter's own revert, as a node reports it. */
const lensRevert = (errorName: "NoRoute" | "ZeroAmount" | "UnsupportedAMM") => () =>
  Promise.reject({
    code: 3,
    message: "execution reverted",
    data: encodeErrorResult({ abi: parseAbi([`error ${errorName}()`]), errorName }),
  });

/** Lens writes its quote struct inline, which viem's parser rejects, so it is named the way Lens names it. */
const QUOTER_ABI: Abi = parseAbi<string[]>([
  "struct Quote { uint8 source; uint256 feeBps; uint256 amountIn; uint256 amountOut; }",
  ...LENS_QUOTER_ABI.filter((line) => line.startsWith("function buildBestSwap(")).map((line) =>
    line.split("tuple(uint8 source, uint256 feeBps, uint256 amountIn, uint256 amountOut)").join("Quote"),
  ),
]);

const ROUTER = "0xfFB643E73f280B97809A8b41f7232AB401a04ee1" as Address;
const ROUTED_AMOUNT_IN = 1000n;
const word = (value: bigint) => numberToHex(value, { size: 32 });

type EthCall = { to: Address; data: Hex; gas?: Hex };
type StateOverride = Record<string, { code?: Hex }>;

/**
 * A node on which LensQuoter routes every swap through `ROUTER`, and which applies state overrides
 * the way Lens's pre-flight probe expects. `router` answers the simulated swap itself.
 */
function routingNode(router: (call: EthCall) => Promise<Hex>): NodeAnswer {
  return ({ method, params }) => {
    if (method === "eth_getBlockByNumber") {
      return Promise.resolve({
        number: "0x1",
        hash: word(1n),
        timestamp: "0x0",
        gasLimit: "0x1c9c380",
        transactions: [],
      });
    }
    if (method === "eth_estimateGas") return Promise.resolve("0x5208");
    const [call, , overrides] = params as [EthCall, unknown, StateOverride | undefined];
    if (isAddressEqual(call.to, CHAINS[100].lensQuoter)) {
      return Promise.resolve(
        encodeFunctionResult({
          abi: QUOTER_ABI,
          functionName: "buildBestSwap",
          result: [{ source: 3, feeBps: 0n, amountIn: ROUTED_AMOUNT_IN, amountOut: 500n }, ROUTER, "0x", 0n, 0n],
        }),
      );
    }
    if (isAddressEqual(call.to, ROUTER)) return router(call);
    // Lens's probe deploys code that returns one; balanceOf and allowance read back what it overrode.
    const overridden = Object.entries(overrides ?? {}).find(([address]) => isAddressEqual(address as Address, call.to));
    if (overridden?.[1].code) return Promise.resolve(word(1n));
    if (call.data.startsWith(toFunctionSelector("balanceOf(address)"))) return Promise.resolve(word(ROUTED_AMOUNT_IN));
    if (call.data.startsWith(toFunctionSelector("allowance(address,address)")))
      return Promise.resolve(word(maxUint256));
    return Promise.reject(new Error(`No answer for a call to ${call.to}`));
  };
}

const swapReverts = () => Promise.reject({ code: 3, message: "execution reverted" });

export const nodeAnswers = {
  unreachable: () =>
    Promise.reject(new HttpRequestError({ url: "https://rpc.gnosischain.com", details: "fetch failed" })),
  /** What an `eth_call` to an address with no code returns. */
  noCode: () => Promise.resolve("0x"),
  /** A revert that carries no reason. */
  bareRevert: () => Promise.reject({ code: -32000, message: "execution reverted" }),
  noRoute: lensRevert("NoRoute"),
  zeroAmount: lensRevert("ZeroAmount"),
  unsupportedAmm: lensRevert("UnsupportedAMM"),
  /** The routed swap reverts outright when simulated. */
  swapReverts: routingNode(swapReverts),
  /** The routed swap goes through, but not within the share of the block's gas Lens allows it. */
  thinPool: routingNode((call) =>
    call.gas ? Promise.reject({ code: -32000, message: "out of gas" }) : Promise.resolve("0x"),
  ),
} satisfies Record<string, NodeAnswer>;

/** Seer's real Lens quoter, reading from a node that gives `answer` to everything. */
export function lensQuoterOn(answer: NodeAnswer): SwapQuoter {
  const client = createPublicClient({ chain: gnosis, transport: custom({ request: answer }, { retryCount: 0 }) });
  // the deadline's clock is not what these answers are about, and most of them answer no block
  return createLensQuoter(client, 100, () => Promise.resolve(0n));
}
