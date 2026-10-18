import { TRADE_WALLET_CARD } from "./tradeWalletCard";

export function TradeWalletSkeleton() {
  return (
    <div aria-busy className={TRADE_WALLET_CARD}>
      <div className="fs-skeleton h-11 w-full max-w-120" />
    </div>
  );
}
