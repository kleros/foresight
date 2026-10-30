"use client";

import { useState } from "react";

import { Button } from "@kleros/ui-components-library";

import { AddLiquidityButton } from "./AddLiquidityButton";
import { LiquidityPositionsDialog } from "./LiquidityPositionsDialog";
import { LiquidityRunStatus } from "./LiquidityRunStatus";
import type { LiquidityRun } from "../hooks/useLiquidityRun";
import { mergeShownOf, type ShownMerge, type ShownPosition } from "../hooks/useSessionLiquidity";
import { POSITIONS_UNREAD } from "../utils/runSteps";

function summary(positions: number, canMerge: boolean, unread: boolean): string {
  const merging = canMerge ? "Complete sets can merge back to sDAI." : "";
  if (unread) return merging ? `${POSITIONS_UNREAD} ${merging}` : POSITIONS_UNREAD;
  if (positions === 0) return merging || "This wallet holds no liquidity in this session.";
  const held = `${positions} ${positions === 1 ? "position" : "positions"} in this session.`;
  return merging ? `${held} ${merging}` : held;
}

/**
 * The session's liquidity, at the bottom of its page: what the wallet holds in a line, Add liquidity until
 * the close, and Your positions, which opens the popup with each position's Remove and the merge.
 */
export function LiquiditySection({
  closed = false,
  reason,
  onAdd,
  names,
  positions,
  positionsUnread = false,
  onRereadPositions,
  merge,
  run,
}: {
  closed?: boolean;
  reason?: string;
  onAdd: () => void;
  names: string[];
  positions: ShownPosition[];
  positionsUnread?: boolean;
  onRereadPositions?: () => void;
  merge?: ShownMerge;
  run: LiquidityRun;
}) {
  const [isManaging, setManaging] = useState(false);
  const request = run.progress?.request;
  // a held merge signs its stored amounts, which today's balances may no longer give
  const shownMerge = run.isHeld && request?.kind === "merge" ? mergeShownOf(request.input, names) : merge;
  const canManage = positions.length > 0 || shownMerge !== undefined;

  return (
    <section aria-labelledby="liquidity-heading" className="fs-card mt-8 flex flex-col gap-3 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-48 flex-1">
          <h2 id="liquidity-heading" className="text-fs-text-primary text-base font-semibold">
            Liquidity
          </h2>
          <p data-testid="liquidity-summary" className="type-label text-fs-text-secondary text-pretty tabular-nums">
            {summary(
              positions.reduce((sum, row) => sum + row.count, 0),
              shownMerge !== undefined,
              positionsUnread,
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {positionsUnread && onRereadPositions ? (
            <Button small variant="secondary" text="Read again" onPress={onRereadPositions} />
          ) : null}
          {canManage ? (
            <Button
              small
              variant="secondary"
              text="Your positions"
              aria-haspopup="dialog"
              onPress={() => setManaging(true)}
            />
          ) : null}
          {closed ? null : <AddLiquidityButton small reason={reason} onPress={onAdd} />}
        </div>
      </div>

      <LiquidityRunStatus run={run} onReview={run.progress?.kind === "seed" ? onAdd : () => setManaging(true)} />

      <LiquidityPositionsDialog
        isOpen={isManaging}
        onClose={() => setManaging(false)}
        names={names}
        positions={positions}
        positionsUnread={positionsUnread}
        merge={shownMerge}
        run={run}
      />
    </section>
  );
}
