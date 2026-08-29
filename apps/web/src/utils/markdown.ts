/** Literal `\n` sequences, as pasted from a JSON-escaped source, become real newlines. */
export function unescapeNewlines(text: string): string {
  return text.replace(/\\r\\n|\\n/g, "\n");
}
