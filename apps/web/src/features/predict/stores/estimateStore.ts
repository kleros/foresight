import * as v from "valibot";
import { isAddress } from "viem";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const AddressKey = v.pipe(
  v.string(),
  v.check((key) => isAddress(key, { strict: false })),
);
const Estimate = v.pipe(v.number(), v.finite());

/** Keyed by lowercased parent market, then lowercased child market. */
const EstimatesSchema = v.record(AddressKey, v.record(AddressKey, Estimate));
type Estimates = v.InferOutput<typeof EstimatesSchema>;

const lowercaseKeys = (record: Estimates): Estimates =>
  Object.fromEntries(
    Object.entries(record).map(([parent, options]) => [
      parent.toLowerCase(),
      Object.fromEntries(Object.entries(options).map(([market, estimate]) => [market.toLowerCase(), estimate])),
    ]),
  );

/**
 * Persisted state is untrusted. A record that fits the schema is taken whole; otherwise it is
 * checked entry by entry so one bad value costs itself, not everything saved.
 */
export function normalizeEstimates(value: unknown): Estimates {
  if (v.is(EstimatesSchema, value)) return lowercaseKeys(value);

  const sessions: Estimates = {};
  if (!value || typeof value !== "object") return sessions;

  for (const [parent, saved] of Object.entries(value as Record<string, unknown>)) {
    if (!v.is(AddressKey, parent) || !saved || typeof saved !== "object") continue;

    const options: Estimates[string] = {};
    for (const [market, estimate] of Object.entries(saved as Record<string, unknown>)) {
      if (v.is(AddressKey, market) && v.is(Estimate, estimate)) options[market.toLowerCase()] = estimate;
    }
    if (Object.keys(options).length > 0) sessions[parent.toLowerCase()] = options;
  }

  return sessions;
}

type EstimateStore = {
  estimates: Estimates;
  setEstimate: (parentMarket: string, market: string, value: number) => void;
  clearEstimate: (parentMarket: string, market: string) => void;
  resetEstimates: (parentMarket: string) => void;
};

const key = (address: string) => address.toLowerCase();

const EMPTY: Record<string, number> = {};

export const ESTIMATES_STORAGE_KEY = "foresight-estimates";

export const useEstimateStore = create<EstimateStore>()(
  persist(
    (set) => ({
      estimates: {},

      setEstimate: (parentMarket, market, value) =>
        set((state) => {
          const parent = key(parentMarket);
          return {
            estimates: { ...state.estimates, [parent]: { ...state.estimates[parent], [key(market)]: value } },
          };
        }),

      clearEstimate: (parentMarket, market) =>
        set((state) => {
          const parent = key(parentMarket);
          const { [key(market)]: _cleared, ...rest } = state.estimates[parent] ?? {};
          const { [parent]: _session, ...sessions } = state.estimates;
          return { estimates: Object.keys(rest).length > 0 ? { ...sessions, [parent]: rest } : sessions };
        }),

      resetEstimates: (parentMarket) =>
        set((state) => {
          const { [key(parentMarket)]: _session, ...sessions } = state.estimates;
          return { estimates: sessions };
        }),
    }),
    {
      name: ESTIMATES_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // The server renders every option unset; hydrating after mount keeps the first client render identical.
      skipHydration: true,
      merge: (persisted, current) => ({
        ...current,
        estimates: normalizeEstimates((persisted as { estimates?: unknown } | undefined)?.estimates),
      }),
    },
  ),
);

export const useSessionEstimates = (parentMarket: string) =>
  useEstimateStore((state) => state.estimates[key(parentMarket)] ?? EMPTY);

export const useEstimate = (parentMarket: string, market: string) =>
  useEstimateStore((state) => state.estimates[key(parentMarket)]?.[key(market)]);
