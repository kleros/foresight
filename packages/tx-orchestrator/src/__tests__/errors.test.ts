import { makeError } from "ethers";
import {
  ContractFunctionRevertedError,
  HttpRequestError,
  InternalRpcError,
  TransactionExecutionError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import { describe, expect, it } from "vitest";

import { classifyTxError, describeTxError } from "../errors";

/**
 * Misclassifying here is expensive in both directions: retrying a declined
 * signature re-prompts someone who already said no, and treating an RPC blip as
 * fatal strands a flow that would have succeeded on the next poll.
 */

describe("classifyTxError, against viem", () => {
  it("reads a declined prompt", () => {
    const error = new UserRejectedRequestError(new Error("MetaMask Tx Signature: User denied transaction signature."));

    expect(classifyTxError(error)).toBe("rejected");
  });

  it("unwraps the decline from whatever viem wrapped it in", () => {
    const error = new TransactionExecutionError(new UserRejectedRequestError(new Error("denied")), { account: null });

    expect(classifyTxError(error)).toBe("rejected");
  });

  it("treats transport trouble, a receipt timeout and an internal error as retryable", () => {
    expect(classifyTxError(new HttpRequestError({ url: "https://rpc.example", status: 429 }))).toBe("rpc");
    expect(classifyTxError(new WaitForTransactionReceiptTimeoutError({ hash: `0x${"1".repeat(64)}` }))).toBe("rpc");
    expect(classifyTxError(new InternalRpcError(new Error("Internal JSON-RPC error")))).toBe("rpc");
  });

  it("leaves a revert as unknown, since the run reads that off the receipt rather than off a throw", () => {
    const error = new ContractFunctionRevertedError({
      abi: [],
      functionName: "deposit",
      message: "execution reverted: bounds",
    });

    expect(classifyTxError(error)).toBe("unknown");
  });
});

describe("classifyTxError, against ethers", () => {
  it("reads ethers' ACTION_REJECTED", () => {
    const error = makeError("user rejected action", "ACTION_REJECTED", {
      action: "sendTransaction",
      reason: "rejected",
    });

    expect(classifyTxError(error)).toBe("rejected");
  });
});

/**
 * No library builds these. A bare EIP-1193 provider throws a plain object.
 */
describe("classifyTxError, against shapes no library will build for us", () => {
  it("reads the EIP-1193 code off a bare provider object", () => {
    expect(classifyTxError({ code: 4001, message: "User rejected the request." })).toBe("rejected");
  });

  it("catches a wallet's own wording when it carries no code at all", () => {
    expect(classifyTxError(new Error("MetaMask Tx Signature: User denied transaction signature."))).toBe("rejected");
  });

  it("treats a bare HTTP status as retryable", () => {
    expect(classifyTxError(Object.assign(new Error("Too many requests"), { status: 429 }))).toBe("rpc");
    expect(classifyTxError({ code: -32603, message: "Internal JSON-RPC error" })).toBe("rpc");
  });

  it("treats insufficient funds as unknown, since retrying cannot fix a balance", () => {
    expect(classifyTxError(new Error("insufficient funds for gas * price + value"))).toBe("unknown");
  });

  it("defaults an unrecognized error to unknown", () => {
    expect(classifyTxError(new Error("something nobody has seen before"))).toBe("unknown");
    expect(classifyTxError("a bare string")).toBe("unknown");
    expect(classifyTxError(undefined)).toBe("unknown");
  });
});

describe("describeTxError", () => {
  it("pulls the short message off a real viem error, and not the block around it", () => {
    const error = new UserRejectedRequestError(new Error("User rejected the request."));

    // What viem puts in `message`, and why it must never reach a toast.
    expect(error.message).toContain("Version:");

    const described = describeTxError(error);
    expect(described).toBe(error.shortMessage);
    expect(described).not.toContain("Version:");
    expect(described.split("\n")).toHaveLength(1);
  });

  it("finds the readable line when something outside viem has wrapped it", () => {
    // The wrapper is wagmi, an app or an embedded wallet SDK, so it is built by
    // hand on purpose: what it wraps is real, and it is the wrapper that hides
    // the good line one level down.
    const wrapped = Object.assign(new Error("Transaction failed."), {
      cause: new UserRejectedRequestError(new Error("User rejected the request.")),
    });

    expect(describeTxError(wrapped)).toBe("User rejected the request.");
  });

  it("trims a multi-line message to its first line", () => {
    const error = new Error("The request timed out.\n\nDetails: socket hang up");

    expect(describeTxError(error)).toBe("The request timed out.");
  });

  it("falls back to the message, then to something printable", () => {
    expect(describeTxError(new Error("plain"))).toBe("plain");
    expect(describeTxError({ nope: true })).toBe("Unknown transaction error");
  });
});
