/** One row per executor per child market per transaction; the swap handler joins on the same key. */
export const predictionId = (transactionHash: string, executor: string, childMarket: string) =>
  `${transactionHash}-${executor}-${childMarket}`;

export const positionId = (executor: string, token: string) => `${executor}-${token}`;

export const transferId = (transactionHash: string, logIndex: number, executor: string) =>
  `${transactionHash}-${logIndex}-${executor}`;

export const swapId = (transactionHash: string, logIndex: number) => `${transactionHash}-${logIndex}`;
