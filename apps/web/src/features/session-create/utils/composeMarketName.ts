/**
 * Seer convention: the unit is not a separate field on-chain. It is appended
 * to the market name in square brackets, and that composed string is the
 * question Reality.eth answerers see. The creator never types the brackets.
 */
export function composeMarketName(question: string, unit: string): string {
  const u = unit.trim();
  return u ? `${question} [${u}]` : question;
}

export const OUTCOME_PLACEHOLDER = "{outcome}";

export function resolveChildQuestion(args: { template: string; outcomeLabel: string; override?: string }): string {
  const override = args.override?.trim();
  if (override) return args.override as string;
  return args.template.replaceAll(OUTCOME_PLACEHOLDER, args.outcomeLabel || "…");
}
