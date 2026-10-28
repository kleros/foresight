import { Button } from "@kleros/ui-components-library";

import { formatDisplayAmount } from "@/utils/amount";

import { AddLiquidityButton } from "./AddLiquidityButton";
import { LiquidityRunStatus } from "./LiquidityRunStatus";
import type { LiquidityRun } from "../hooks/useLiquidityRun";
import type { ShownMerge, ShownPosition, TokenAmount } from "../hooks/useSessionLiquidity";

const amounts = (list: TokenAmount[]) =>
  list.map(({ label, amount }) => `${formatDisplayAmount(amount, 18)} ${label}`).join(" + ");

/** The session's liquidity, at the bottom of its page: Add, the wallet's positions, then the merge of complete sets. */
export function LiquiditySection({
  reason,
  onAdd,
  positions,
  merge,
  run,
}: {
  reason?: string;
  onAdd: () => void;
  positions: ShownPosition[];
  merge?: ShownMerge;
  run: LiquidityRun;
}) {
  return (
    <section aria-labelledby="liquidity-heading" className="fs-card mt-8 flex flex-col gap-4 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="liquidity-heading" className="text-fs-text-primary text-base font-semibold">
          Liquidity
        </h2>
        <AddLiquidityButton small reason={reason} onPress={onAdd} />
      </div>

      {positions.length > 0 ? (
        <ul className="border-fs-border divide-fs-border rounded-fs divide-y border">
          {positions.map((position) => (
            <li key={position.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="type-label text-fs-text-primary">{position.pool}</div>
                <div className="type-caption text-fs-text-secondary tabular-nums">
                  Returns {amounts(position.returns)}
                </div>
              </div>
              <Button
                small
                variant="secondary"
                text="Remove"
                aria-label={`Remove ${position.pool}`}
                isDisabled={run.isHeld}
                onPress={() => run.start(position.request)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-label text-fs-text-secondary">This wallet holds no liquidity in this session.</p>
      )}

      {merge ? (
        <div className="rounded-fs bg-fs-surface-sunken flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="type-label text-fs-text-primary">Merge complete sets back to sDAI</div>
            <div className="type-caption text-fs-text-secondary tabular-nums">
              {merge.branches.length > 0 ? `Branch merges return ${amounts(merge.branches)}. ` : null}
              {merge.parentMerge !== undefined
                ? `The parent merge returns ${formatDisplayAmount(merge.parentMerge, 18)} sDAI.`
                : null}
            </div>
          </div>
          <Button
            small
            variant="secondary"
            text="Merge"
            isDisabled={run.isHeld}
            onPress={() => run.start(merge.request)}
          />
        </div>
      ) : null}

      <LiquidityRunStatus run={run} />
    </section>
  );
}
