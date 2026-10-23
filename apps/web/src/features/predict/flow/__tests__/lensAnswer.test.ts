import { encodeFunctionData, parseAbi, type Address, type PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLensQuoter } from "@/lib/swap/lens";
import { QuoteRefusedError } from "@/lib/swap/types";

import { planPredict, QuoteFailedError, STEP_ID } from "../plan";
import { chainState, ctx, fakeReader, option, snapshot } from "./support/fakes";

const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)",
]);
const SWAPR_ROUTER = "0xfFB643E73f280B97809A8b41f7232AB401a04ee1" as Address;
const ATTACKER = "0xBAd0000000000000000000000000000000000Bad" as Address;

const lensQuote = vi.fn();

vi.mock("@seer-pm/lens/client", () => ({
  Lens: class {
    quote = lensQuote;
  },
}));

type LensArgs = { tokenIn: Address; tokenOut: Address; amount: bigint; recipient: Address; deadline: bigint };

/** A node whose LensQuoter answers every swap with `target` as the router and `recipient` paid. */
function lensAnswers(answer: { target: Address; recipient?: Address }) {
  lensQuote.mockImplementation((args: LensArgs) =>
    Promise.resolve({
      amountIn: args.amount,
      amountOut: args.amount / 2n,
      target: answer.target,
      msgValue: 0n,
      data: encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: args.tokenIn,
            tokenOut: args.tokenOut,
            recipient: answer.recipient ?? args.recipient,
            deadline: args.deadline,
            amountIn: args.amount,
            amountOutMinimum: 0n,
            limitSqrtPrice: 0n,
          },
        ],
      }),
    }),
  );
}

async function build() {
  const snap = snapshot({ options: [option(1), option(2)] });
  const onLeftOut = vi.fn();
  const quoter = createLensQuoter({} as PublicClient, 100, () => Promise.resolve(0n));
  const step = planPredict(snap, { reader: fakeReader({ state: () => chainState() }), quoter, onLeftOut }).find(
    (each) => each.id === STEP_ID.predict(1),
  )!;
  const built = await Promise.resolve(step.build(ctx(), snap)).catch((caught: unknown) => caught);
  return { built, onLeftOut };
}

describe("a predict batch quoted by an RPC that answers for another swap", () => {
  beforeEach(() => {
    lensQuote.mockReset();
  });

  it.each([
    ["routes every leg through its own router", { target: ATTACKER }],
    ["pays every leg's output to someone else", { target: SWAPR_ROUTER, recipient: ATTACKER }],
  ])("is not built when the node %s, and leaves no option out", async (_, answer) => {
    lensAnswers(answer);

    const { built, onLeftOut } = await build();

    expect(built).toBeInstanceOf(QuoteFailedError);
    expect((built as QuoteFailedError).cause).toBeInstanceOf(QuoteRefusedError);
    expect(onLeftOut).not.toHaveBeenCalled();
  });

  it("is built when the node answers for the swap asked", async () => {
    lensAnswers({ target: SWAPR_ROUTER });

    const { built, onLeftOut } = await build();

    expect(built).toMatchObject({ to: ctx().executor });
    expect(onLeftOut).not.toHaveBeenCalled();
  });
});
