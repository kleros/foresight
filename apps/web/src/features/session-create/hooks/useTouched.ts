import { useCallback, useState } from "react";

/**
 * The fields the user has left at least once. An empty required field stays quiet until then.
 * Held per mount, not in the persisted draft: a reload starts every field untouched again.
 */
export function useTouched() {
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set());
  const touch = useCallback(
    (key: string) => setLeft((current) => (current.has(key) ? current : new Set(current).add(key))),
    [],
  );
  const touched = useCallback((key: string) => left.has(key), [left]);
  return { touched, touch };
}
