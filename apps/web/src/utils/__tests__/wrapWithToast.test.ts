import { waitForTransactionReceipt, type Config } from "@wagmi/core";
import { UserRejectedRequestError, type Hash } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorToast, infoToast, successToast } from "../toast";
import { wrapWithToast } from "../wrapWithToast";

vi.mock("../toast", () => ({ infoToast: vi.fn(), successToast: vi.fn(), errorToast: vi.fn() }));
/* Waiting is wagmi's; the only field read off what it returns is `status`, typed against viem's receipt. */
vi.mock("@wagmi/core", () => ({ waitForTransactionReceipt: vi.fn() }));

const HASH: Hash = `0x${"ab".repeat(32)}`;
const config = {} as Config;

type Receipt = Awaited<ReturnType<typeof waitForTransactionReceipt>>;

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

    expect(infoToast).toHaveBeenCalledWith("Transaction initiated.");
    expect(successToast).toHaveBeenCalledWith("Transaction confirmed.");
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("reports a revert and rejects", async () => {
    vi.mocked(waitForTransactionReceipt).mockResolvedValue(receipt("reverted"));

    await expect(wrapWithToast(config, () => Promise.resolve(HASH))).rejects.toThrow("Transaction reverted.");

    expect(errorToast).toHaveBeenCalledWith("Transaction reverted.");
    expect(successToast).not.toHaveBeenCalled();
  });

  it("reports the wallet's refusal in its own words and rejects", async () => {
    const refusal = new UserRejectedRequestError(new Error("User denied transaction signature."));

    await expect(wrapWithToast(config, () => Promise.reject(refusal))).rejects.toBe(refusal);

    expect(errorToast).toHaveBeenCalledWith(refusal.shortMessage);
    expect(waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
  });
});
