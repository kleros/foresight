import { waitForTransactionReceipt, type Config } from "@wagmi/core";
import {
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

  it("reports a revert and rejects", async () => {
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
});
