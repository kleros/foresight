/**
 * Seer packs a scalar market's unit into its name as a trailing `[unit]`
 */
const UNIT_SUFFIX = /^(.*?)\s*\[([^\][]+)\]$/s;

export function splitMarketName(marketName: string): { question: string; unit: string | null } {
  const match = UNIT_SUFFIX.exec(marketName.trim());
  if (!match) return { question: marketName.trim(), unit: null };

  const [, question = "", unit = ""] = match;
  return { question, unit };
}
