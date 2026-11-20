import { MaxUint256, parseEther, toBeHex } from "ethers";

// Reality.eth's reserved answer for INVALID; Seer's RealityProxy pays only the INVALID outcome for it.
export const INVALID_ANSWER = toBeHex(MaxUint256, 32);

// Multi-select (template 3) answers are a bitmask of winning outcomes; single-select (template 2) the outcome index.
export function encodeParentAnswer(winners: readonly number[], multiCategorical: boolean): string {
  if (winners.length === 0) throw new Error("At least one winning outcome is required");
  if (multiCategorical)
    return toBeHex(
      winners.reduce((mask, index) => mask | (1n << BigInt(index)), 0n),
      32,
    );
  const [winner] = winners;
  if (winner === undefined || winners.length > 1) throw new Error("A categorical parent has exactly one winner");
  return toBeHex(winner, 32);
}

// Scalar (template 1) answers are the value scaled by 1e18; "invalid" answers INVALID.
export function encodeChildAnswer(value: string): string {
  return value.toLowerCase() === "invalid" ? INVALID_ANSWER : toBeHex(parseEther(value), 32);
}
