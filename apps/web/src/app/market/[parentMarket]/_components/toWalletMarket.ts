import type { SessionDetail, SessionOption } from "@/features/sessions/types";
import type { TradeWalletMarket, TradeWalletPosition } from "@/features/trade-executor/types";

/**
 * The wallet mints and merges the parent market's whole outcome set, so it needs the
 * collateral behind it and every outcome's token. Null where a market read failed at
 * indexing time and left one of them missing, since a partial set cannot be minted or merged.
 */
export function toWalletMarket(session: SessionDetail): TradeWalletMarket | null {
  const { collateralToken, collateralDecimals, collateralSymbol, invalidToken } = session;
  if (!collateralToken || collateralDecimals === null || !collateralSymbol || !invalidToken) return null;

  const options = session.options.flatMap((option) =>
    option.underlyingToken
      ? [{ token: option.underlyingToken, name: option.name, color: option.color, positions: positionsOf(option) }]
      : [],
  );
  if (options.length === 0 || options.length !== session.options.length) return null;

  return {
    parentMarket: session.parentMarket,
    collateral: { address: collateralToken, decimals: collateralDecimals, symbol: collateralSymbol },
    options,
    invalidToken,
  };
}

const positionsOf = (option: SessionOption): TradeWalletPosition[] => [
  ...(option.upToken ? [{ side: "UP" as const, token: option.upToken }] : []),
  ...(option.downToken ? [{ side: "DOWN" as const, token: option.downToken }] : []),
];
