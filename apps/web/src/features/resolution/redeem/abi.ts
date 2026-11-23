import { parseAbi } from "viem";

/** Seer's conditional router; the deployments package does not ship its ABI. */
export const conditionalRouterAbi = parseAbi([
  "function redeemConditionalToCollateral(address collateralToken, address market, uint256[] outcomeIndexes, uint256[] parentOutcomeIndexes, uint256[] amounts)",
]);
