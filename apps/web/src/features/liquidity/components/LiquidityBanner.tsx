import { AddLiquidityButton } from "./AddLiquidityButton";

/** Said at the top of a session whose pools hold no liquidity yet. */
export function LiquidityBanner({ reason, onAdd }: { reason?: string; onAdd: () => void }) {
  return (
    <div className="rounded-fs bg-fs-tone-warning-bg border-fs-tone-warning mt-6 flex flex-wrap items-center gap-4 border px-5 py-4">
      <div className="min-w-60 flex-1">
        <div className="text-fs-text-primary text-sm font-semibold">No liquidity yet</div>
        <div className="type-label text-fs-text-primary">This session&apos;s pools need liquidity to be tradable.</div>
      </div>
      <AddLiquidityButton reason={reason} onPress={onAdd} />
    </div>
  );
}
