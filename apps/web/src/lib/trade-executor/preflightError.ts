/** Thrown before a transaction is built, so no wallet prompt or transaction toast has shown it. */
export class PreflightError extends Error {
  override name = "PreflightError";
}
