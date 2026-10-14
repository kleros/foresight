import { createPublicClient, custom, encodeErrorResult, HttpRequestError, parseAbi } from "viem";
import { gnosis } from "viem/chains";

import { createLensQuoter } from "../../lens";
import type { SwapQuoter } from "../../types";

/** What a node answers to every request: an `eth_call` result, or a rejection. */
export type NodeAnswer = () => Promise<unknown>;

/** LensQuoter's own revert, as a node reports it. */
const lensRevert = (errorName: "NoRoute" | "ZeroAmount" | "UnsupportedAMM") => () =>
  Promise.reject({
    code: 3,
    message: "execution reverted",
    data: encodeErrorResult({ abi: parseAbi([`error ${errorName}()`]), errorName }),
  });

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
} satisfies Record<string, NodeAnswer>;

/** Seer's real Lens quoter, reading from a node that gives `answer` to everything. */
export function lensQuoterOn(answer: NodeAnswer): SwapQuoter {
  const client = createPublicClient({ chain: gnosis, transport: custom({ request: answer }, { retryCount: 0 }) });
  return createLensQuoter(client, 100);
}
