import type { Address } from "viem";

import { sessionKey, type SessionResolutionRead } from "@/features/resolution/api/useSessionResolution";
import type { SessionDetail } from "@/features/sessions/types";

/** The resolution read for the open session; undefined until the session and the chain's factory are known. */
export function resolutionRead(
  detail: Pick<SessionDetail, "id" | "options"> | undefined,
  sessionFactory: Address | null,
): SessionResolutionRead | undefined {
  const session = detail && sessionKey(detail.id, sessionFactory);
  return session && { ...session, childMarkets: detail.options.map((option) => option.market) };
}
