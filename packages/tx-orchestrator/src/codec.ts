/**
 * JSON that survives `bigint`.
 */

/**
 * Deliberately unlovely: a snapshot may legitimately contain `{ $bigint: "7" }`
 * as domain data, and decoding that as a number would corrupt it silently.
 */
const BIGINT_TAG = "__txflow:bigint__";

type BigintEnvelope = { [BIGINT_TAG]: string };

function isBigintEnvelope(value: unknown): value is BigintEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    BIGINT_TAG in value &&
    typeof (value as BigintEnvelope)[BIGINT_TAG] === "string"
  );
}

export function encodeState(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) =>
    typeof raw === "bigint" ? ({ [BIGINT_TAG]: raw.toString() } satisfies BigintEnvelope) : raw,
  );
}

export function decodeState<T>(text: string): T {
  return JSON.parse(text, (_key, raw: unknown) => (isBigintEnvelope(raw) ? BigInt(raw[BIGINT_TAG]) : raw)) as T;
}
