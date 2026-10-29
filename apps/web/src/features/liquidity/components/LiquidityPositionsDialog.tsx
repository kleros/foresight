"use client";

import { useState } from "react";

import { Button } from "@kleros/ui-components-library";

import { Modal } from "@/components/ui/Modal";
import { POPUP_FRAME, PopupCloseButton } from "@/components/ui/Popup";
import { ScrollFade } from "@/components/ui/ScrollFade";
import { StatusCallout } from "@/components/ui/StatusCallout";
import { StepsTimeline } from "@/components/ui/StepsTimeline";

import { AmountRow } from "./AmountRow";
import { LiquidityPopupFooter } from "./LiquidityPopupFooter";
import type { LiquidityRun } from "../hooks/useLiquidityRun";
import type { ShownMerge, ShownPosition } from "../hooks/useSessionLiquidity";
import { runStatus, runSteps } from "../utils/runSteps";

/** A seed holds the session, so nothing here can start until it is finished or started over. */
const HELD_BY_SEED = "Adding liquidity from this wallet is unfinished. Finish it in Add liquidity first.";

/** The wallet's positions in this session, one row per pool with its Remove, then the merge of complete sets, then the run's steps. */
export function LiquidityPositionsDialog({
  isOpen,
  onClose,
  names,
  positions,
  merge,
  run,
}: {
  isOpen: boolean;
  onClose: () => void;
  names: string[];
  positions: ShownPosition[];
  merge?: ShownMerge;
  run: LiquidityRun;
}) {
  const { isRunning, progress } = run;
  const kind = progress?.kind;
  // a completed remove burns its NFTs, so the refetched list no longer holds them
  const [pressed, setPressed] = useState<{ tokenId: bigint; pool: string }>();
  const removingId = progress?.tokenIds?.[0];
  const removing =
    positions.find(
      (position) => position.request.kind === "remove" && position.request.input.positions[0]?.tokenId === removingId,
    )?.pool ?? (pressed && pressed.tokenId === removingId ? pressed.pool : undefined);
  const isOwn = kind === "remove" || kind === "merge";

  const steps = isOwn
    ? runSteps({
        kind,
        planned: [],
        progress,
        title: (row) => {
          if (row === "remove") {
            if (removing) return `Remove ${removing}`;
            return (progress?.tokenIds?.length ?? 1) > 1 ? "Remove the positions" : "Remove the position";
          }
          if (row === "parent") return "Merge back to sDAI";
          return `Merge ${names[Number(row.split(":")[1])] ?? "a branch"}`;
        },
      })
    : [];
  const status = isOwn ? runStatus(progress) : run.isHeld ? { text: HELD_BY_SEED, tone: "warning" as const } : null;
  const stopped = isOwn && (progress?.stage === "halted" || progress?.stage === "moved");

  return (
    <Modal
      ariaLabel="Your positions"
      isOpen={isOpen}
      isDismissable={!isRunning}
      onOpenChange={(open) => (open || isRunning ? undefined : onClose())}
      className={POPUP_FRAME}
    >
      <div className="landscape-phone:overflow-y-auto relative flex min-h-0 w-full flex-col">
        <div className="bg-fs-surface landscape-phone:sticky landscape-phone:top-0 landscape-phone:z-20 mb-2 flex h-8 shrink-0 items-center justify-between">
          <h2 className="text-fs-popup-text text-lg font-semibold tracking-[-0.01em]">Your positions</h2>
          <PopupCloseButton isDisabled={isRunning} onPress={onClose} />
        </div>

        <ScrollFade
          className="landscape-phone:min-h-0 landscape-phone:flex-none min-h-32 w-full"
          cue="More below"
          cueTone="border-(--fs-popup-line) text-fs-popup-text-2"
          cueLift={status ? 2 : 3}
          cueDrop={status ? 3 : 6}
          minOverflow={1}
          fadeSize={40}
        >
          <div className="flex flex-col gap-2 pt-2 short:pt-1">
            <section aria-label="Positions" className="rounded-fs-panel bg-fs-popup-panel px-4 py-1">
              {positions.length > 0 ? (
                <ul className="divide-y divide-(--fs-popup-line)">
                  {positions.map((position) => (
                    <li key={position.key} className="py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-fs-popup-text text-sm font-semibold wrap-anywhere">{position.pool}</div>
                          {position.count > 1 ? (
                            <div className="text-fs-popup-text-2 text-xs leading-4">{position.count} positions</div>
                          ) : null}
                        </div>
                        <Button
                          small
                          variant="secondary"
                          text="Remove"
                          aria-label={`Remove ${position.pool}`}
                          isDisabled={run.isHeld}
                          onPress={() => {
                            const first =
                              position.request.kind === "remove" ? position.request.input.positions[0] : undefined;
                            if (first) setPressed({ tokenId: first.tokenId, pool: position.pool });
                            run.start(position.request);
                          }}
                        />
                      </div>
                      <dl className="mt-1 text-[13px] leading-[18px] tabular-nums">
                        <AmountRow label="Returns" amounts={position.returns} />
                      </dl>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-fs-popup-text-2 py-2.5 text-sm">This wallet holds no liquidity in this session.</p>
              )}
            </section>

            {merge ? (
              <section aria-label="Merge" className="rounded-fs-panel bg-fs-popup-panel px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="text-fs-popup-text min-w-0 flex-1 text-sm font-semibold">
                    Merge complete sets back to sDAI
                  </div>
                  <Button
                    small
                    variant="secondary"
                    text="Merge"
                    isDisabled={run.isHeld}
                    onPress={() => run.start(merge.request)}
                  />
                </div>
                <dl className="mt-1 flex flex-col gap-1 text-[13px] leading-[18px] tabular-nums">
                  {merge.branches.length > 0 ? (
                    <AmountRow label="Branch merges return" amounts={merge.branches} />
                  ) : null}
                  {merge.parentMerge !== undefined ? (
                    <AmountRow
                      label="The parent merge returns"
                      amounts={[{ label: "sDAI", amount: merge.parentMerge }]}
                    />
                  ) : null}
                </dl>
              </section>
            ) : null}

            {steps.length > 0 ? (
              <div className="pt-1">
                <StepsTimeline rows={steps} stopped={stopped} className="liquidity-steps" />
              </div>
            ) : null}
            {stopped && !run.progress?.holdsSend ? (
              <p className="text-fs-popup-text-2 px-1 pb-1 text-xs leading-4 text-pretty">
                Starting over keeps what this run already signed in your wallet.
              </p>
            ) : null}
          </div>
        </ScrollFade>

        <StatusCallout status={status} />

        <LiquidityPopupFooter
          run={run}
          isOwn={isOwn}
          idle={{ text: "Done", isDisabled: isRunning, onPress: onClose }}
        />
      </div>
    </Modal>
  );
}
