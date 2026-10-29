"use client";

import { useState } from "react";

import { Button } from "@kleros/ui-components-library";

import { AddLiquidityButton } from "./AddLiquidityButton";
import { LiquidityPositionsDialog } from "./LiquidityPositionsDialog";
import { LiquidityRunStatus } from "./LiquidityRunStatus";
import type { LiquidityRun } from "../hooks/useLiquidityRun";
import type { ShownMerge, ShownPosition } from "../hooks/useSessionLiquidity";

function summary(positions: number, canMerge: boolean): string {
  const merging = canMerge ? "Complete sets can merge back to sDAI." : "";
  if (positions === 0) return merging || "This wallet holds no liquidity in this session.";
  const held = `${positions} ${positions === 1 ? "position" : "positions"} in this session.`;
  return merging ? `${held} ${merging}` : held;
}

/**
 * The session's liquidity, at the bottom of its page: what the wallet holds in a line, Add liquidity, and
 * Your positions, which opens the popup with each position's Remove and the merge.
 */
export function LiquiditySection({
  reason,
  onAdd,
  names,
  positions,
  merge,
  run,
}: {
  reason?: string;
  onAdd: () => void;
  names: string[];
  positions: ShownPosition[];
  merge?: ShownMerge;
  run: LiquidityRun;
}) {
  const [isManaging, setManaging] = useState(false);
  const canManage = positions.length > 0 || merge !== undefined;

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
              merge !== undefined,
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canManage ? (
            <Button
              small
              variant="secondary"
              text="Your positions"
              aria-haspopup="dialog"
              onPress={() => setManaging(true)}
            />
          ) : null}
          <AddLiquidityButton small reason={reason} onPress={onAdd} />
        </div>
      </div>

      <LiquidityRunStatus run={run} />

      <LiquidityPositionsDialog
        isOpen={isManaging}
        onClose={() => setManaging(false)}
        names={names}
        positions={positions}
        merge={merge}
        run={run}
      />
    </section>
  );
}
