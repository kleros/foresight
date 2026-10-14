/** The ids a predict run's steps carry, in storage and in the popup's timeline. */
export const STEP_ID = {
  createExecutor: "create-wallet",
  deposit: "deposit",
  predict: (batch: number) => `predict-${batch}`,
} as const;
