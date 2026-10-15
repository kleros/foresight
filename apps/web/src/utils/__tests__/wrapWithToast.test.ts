import { waitForTransactionReceipt, type Config } from "@wagmi/core";
import {
  CallExecutionError,
  ExecutionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  InternalRpcError,
  RpcRequestError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
  type Hash,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorToast, infoToast, successToast } from "../toast";
import { wrapWithToast } from "../wrapWithToast";

vi.mock("../toast", () => ({ infoToast: vi.fn(), successToast: vi.fn(), errorToast: vi.fn() }));
/* Waiting is wagmi's; the only field read off what it returns is `status`, typed against viem's receipt. */
vi.mock("@wagmi/core", () => ({ waitForTransactionReceipt: vi.fn() }));

const HASH: Hash = `0x${"ab".repeat(32)}`;
const config = {} as Config;

type Receipt = Awaited<ReturnType<typeof waitForTransactionReceipt>>;

const rpcError = (message: string) =>
  new RpcRequestError({ body: {}, error: { code: -32000, message }, url: "https://rpc.example" });

const receipt = (status: Receipt["status"]) => ({ status, chainId: 100 }) as Receipt;

beforeEach(() => {
  vi.mocked(waitForTransactionReceipt).mockReset();
  vi.mocked(infoToast).mockReset();
  vi.mocked(successToast).mockReset();
  vi.mocked(errorToast).mockReset();
});

describe("wrapWithToast", () => {
  it("announces the transaction, then its confirmation", async () => {
    vi.mocked(waitForTransactionReceipt).mockResolvedValue(receipt("success"));

    await expect(wrapWithToast(config, () => Promise.resolve(HASH))).resolves.toEqual(receipt("success"));

    expect(infoToast).toHaveBeenCalledWith("Confirm in your wallet.");
    expect(successToast).toHaveBeenCalledWith("Transaction confirmed.");
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("reports a reverted receipt, should one be returned rather than thrown, and rejects", async () => {
    vi.mocked(waitForTransactionReceipt).mockResolvedValue(receipt("reverted"));

    await expect(wrapWithToast(config, () => Promise.resolve(HASH))).rejects.toThrow("Transaction reverted.");

    expect(errorToast).toHaveBeenCalledWith("Transaction failed.");
    expect(successToast).not.toHaveBeenCalled();
  });

  it("reports the wallet's refusal in the app's words, not the wallet's, and rejects", async () => {
    const refusal = new UserRejectedRequestError(new Error("User denied transaction signature."));

    await expect(wrapWithToast(config, () => Promise.reject(refusal))).rejects.toBe(refusal);

    expect(errorToast).toHaveBeenCalledExactlyOnceWith("You declined in your wallet.");
    expect(waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the network did not answer",
      new HttpRequestError({ url: "https://rpc.example", details: "fetch failed" }),
      "The network did not answer.",
    ],
    ["anything it does not recognise", new Error("execution reverted: 0x4e487b71"), "Transaction failed."],
  ])("reports %s in the app's words and rejects", async (_name, error, toast) => {
    await expect(wrapWithToast(config, () => Promise.reject(error))).rejects.toBe(error);

    expect(errorToast).toHaveBeenCalledExactlyOnceWith(toast);
  });

  it.each([
    [
      "an out-of-funds send over http",
      new InsufficientFundsError({ cause: rpcError("insufficient funds for gas * price + value") }),
      "Not enough in your wallet for this and the network fee.",
    ],
    [
      "an out-of-funds send through an injected wallet",
      new InsufficientFundsError({ cause: new InternalRpcError(new Error("insufficient funds for transfer")) }),
      "Not enough in your wallet for this and the network fee.",
    ],
    [
      "a send that reverts while gas is estimated",
      new ExecutionRevertedError({ cause: rpcError("execution reverted") }),
      "Transaction failed.",
    ],
  ])("reports %s as what it is rather than a silent network", async (_name, error, toast) => {
    await expect(wrapWithToast(config, () => Promise.reject(error))).rejects.toBe(error);

    expect(errorToast).toHaveBeenCalledExactlyOnceWith(toast);
  });

  it("says a sent transaction may still confirm when waiting for its receipt fails", async () => {
    const timeout = new WaitForTransactionReceiptTimeoutError({ hash: HASH });
    vi.mocked(waitForTransactionReceipt).mockRejectedValue(timeout);

    await expect(wrapWithToast(config, () => Promise.resolve(HASH))).rejects.toBe(timeout);

    expect(errorToast).toHaveBeenCalledExactlyOnceWith(
      "Sent, not confirmed yet. Check your wallet before trying again.",
    );
  });

  describe("with wagmi's own receipt wait, which throws once a mined transaction reverts", () => {
    const actual = async () =>
      (await vi.importActual<typeof import("@wagmi/core")>("@wagmi/core")).waitForTransactionReceipt;
    /** A Error(string) revert of "nope", as `call` returns it when the transaction is replayed. */
    const NOPE = `0x08c379a0${"0".repeat(62)}20${"0".repeat(62)}04${"6e6f7065".padEnd(64, "0")}`;

    /** A client whose receipt is reverted; `replay` is what replaying the transaction answers. */
    const revertedOn = (replay: () => Promise<{ data?: string }>) =>
      ({
        getClient: () => ({
          chain: { id: 100 },
          waitForTransactionReceipt: async () => ({ status: "reverted", transactionHash: HASH }),
          getTransaction: async () => ({ from: `0x${"01".repeat(20)}`, input: "0x", type: "eip1559" }),
          call: replay,
        }),
      }) as unknown as Config;

    it.each([
      ["with a reason", () => Promise.resolve({ data: NOPE })],
      ["with no reason", () => Promise.resolve({})],
      [
        "whose replay itself reverts",
        () =>
          Promise.reject(
            new CallExecutionError(new ExecutionRevertedError({ cause: rpcError("execution reverted") }), {}),
          ),
      ],
    ])("reports a mined revert %s as failed, not as still pending", async (_name, replay) => {
      vi.mocked(waitForTransactionReceipt).mockImplementation(await actual());

      await expect(wrapWithToast(revertedOn(replay), () => Promise.resolve(HASH))).rejects.toThrow();

      expect(errorToast).toHaveBeenCalledExactlyOnceWith("Transaction failed.");
      expect(successToast).not.toHaveBeenCalled();
    });
  });
});
