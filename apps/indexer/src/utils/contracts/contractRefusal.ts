import { ContractFunctionRevertedError, ContractFunctionZeroDataError } from "viem";

/**
 * True when the contract itself refused (revert, or no code behind the call),
 * a permanent fact safe to cache. A transport failure is not, so effects rethrow
 * it rather than let the cache keep a blip forever.
 */
export function isContractRefusal(error: unknown): boolean {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    if (cause instanceof ContractFunctionRevertedError || cause instanceof ContractFunctionZeroDataError) return true;
  }
  return false;
}
