"use client";

import { useId, useMemo, useState } from "react";

import clsx from "clsx";
import type { Address } from "viem";

import { Modal } from "@/components/ui/Modal";
import { POPUP_FRAME, PopupCloseButton } from "@/components/ui/Popup";
import { ScrollFade } from "@/components/ui/ScrollFade";
import { StatusCallout } from "@/components/ui/StatusCallout";
import { StepsTimeline } from "@/components/ui/StepsTimeline";

import { formatDisplayAmount } from "@/utils/amount";

import { AmountRow } from "./AmountRow";
import { LiquidityPopupFooter } from "./LiquidityPopupFooter";
import type { LiquidityBalances } from "../api/getLiquidityBalances";
import type { LiquidityRun } from "../hooks/useLiquidityRun";
import { formOf, useLiquiditySeed, type SeedForm } from "../hooks/useLiquiditySeed";
import type { SeedCollateral, SessionPools } from "../types";
import { runStatus, runSteps } from "../utils/runSteps";

const COLLATERALS: SeedCollateral[] = ["sDAI", "xDAI"];

/** A remove or merge holds the session, so this popup cannot start one. */
const HELD_ELSEWHERE = "Removing or merging from this wallet is unfinished. Finish it in Your positions first.";

const FIELD = clsx(
  "rounded-fs-control bg-fs-surface text-fs-popup-text h-10 w-full min-w-0 border border-(--fs-popup-line) px-3",
  "text-[15px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-fs-focus-ring",
  "read-only:bg-transparent read-only:text-fs-popup-text-2",
);

/**
 * The Add liquidity popup, on the predict popup's frame: the total, each branch's depth and UP price with what
 * its pools get, what stays in the wallet, then the steps to sign, the status line and the button.
 */
export function LiquidityDialog({
  isOpen,
  onClose,
  names,
  pools,
  owner,
  balances,
  chainTime,
  closed,
  run,
}: {
  isOpen: boolean;
  onClose: () => void;
  names: string[];
  pools: SessionPools | undefined;
  owner: Address | undefined;
  balances: LiquidityBalances | undefined;
  chainTime: bigint | undefined;
  closed: boolean;
  run: LiquidityRun;
}) {
  const [typed, setForm] = useState<SeedForm>({ total: "", collateral: "sDAI", depths: [], prices: [] });
  const { isRunning, progress } = run;
  // a remove or merge holds the same slot; its steps and actions are the positions popup's
  const isOwn = progress?.kind === undefined || progress.kind === "seed";
  const isLocked = isRunning || (run.isHeld && isOwn);
  // a held seed shows the request it signs, which a run recovered from storage does not share with what was typed
  const signing = isLocked && progress?.request?.kind === "seed" ? progress.request.input : undefined;
  const form = useMemo(() => (signing ? formOf(signing) : typed), [signing, typed]);
  const seed = useLiquiditySeed({ pools, owner, names, balances, chainTime, closed, form });
  const id = useId();
  const balance = form.collateral === "sDAI" ? balances?.collateral : balances?.native;

  const edit = (key: "depths" | "prices", index: number, value: string) =>
    setForm((now) => {
      const list = [...now[key]];
      list[index] = value;
      return { ...now, [key]: list };
    });

  const steps = runSteps({
    kind: "seed",
    planned: seed.shown?.steps ?? [],
    progress,
    title: (row) =>
      row === "parent" ? "Split into outcomes" : `Seed ${names[Number(row.split(":")[1])] ?? "a branch"}`,
  });
  const ran = isOwn ? runStatus(progress) : run.isHeld ? { text: HELD_ELSEWHERE, tone: "warning" as const } : null;
  const problem = seed.problem;
  const status = ran ?? (problem ? { text: problem, tone: "neutral" as const } : null);
  const stopped = isOwn && (progress?.stage === "halted" || progress?.stage === "moved");

  return (
    <Modal
      ariaLabel="Add liquidity"
      isOpen={isOpen}
      isDismissable={!isRunning}
      onOpenChange={(open) => (open || isRunning ? undefined : onClose())}
      className={POPUP_FRAME}
    >
      <div className="landscape-phone:overflow-y-auto relative flex min-h-0 w-full flex-col">
        <div className="bg-fs-surface landscape-phone:sticky landscape-phone:top-0 landscape-phone:z-20 mb-2 flex h-8 shrink-0 items-center justify-between">
          <h2 className="text-fs-popup-text text-lg font-semibold tracking-[-0.01em]">Add liquidity</h2>
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
            <section
              className={clsx(
                "rounded-fs-panel bg-fs-popup-panel p-4 short:px-3.5 short:py-2",
                "[background-image:var(--fs-popup-wash)]",
                // the field draws no ring of its own, so the panel wears the focus ring, inside its edge
                "has-[[data-id=total]:focus-visible]:ring-fs-focus-ring has-[[data-id=total]:focus-visible]:ring-2",
                "has-[[data-id=total]:focus-visible]:ring-inset",
              )}
            >
              <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3">
                <label htmlFor={`${id}-total`} className="type-label text-fs-popup-text-2 font-medium">
                  Total
                </label>
                {balance !== undefined ? (
                  <span className="text-fs-popup-text-2 min-w-0 truncate text-[13px] leading-5 tabular-nums">
                    Balance: {formatDisplayAmount(balance, 18)} {form.collateral}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex h-11 items-center gap-3 short:mt-1.5 short:h-10">
                <input
                  id={`${id}-total`}
                  data-id="total"
                  inputMode="decimal"
                  placeholder="0"
                  autoComplete="off"
                  value={form.total}
                  readOnly={isLocked}
                  onChange={(event) => setForm((now) => ({ ...now, total: event.target.value }))}
                  className={clsx(
                    "h-11 min-w-0 flex-1 border-none bg-transparent px-0 outline-none",
                    "text-fs-popup-text placeholder:text-fs-popup-text-3 text-[30px] leading-9 font-medium tracking-[-0.02em] tabular-nums",
                    "read-only:opacity-50",
                  )}
                />
                <div role="group" aria-label="Pay in" className="bg-fs-popup-chip flex shrink-0 rounded-full p-0.5">
                  {COLLATERALS.map((collateral) => (
                    <button
                      key={collateral}
                      type="button"
                      aria-pressed={form.collateral === collateral}
                      disabled={isLocked}
                      onClick={() => setForm((now) => ({ ...now, collateral }))}
                      className={clsx(
                        "h-9 rounded-full px-3 text-[15px] font-semibold",
                        "transition-colors duration-(--fs-dur-echo) ease-(--fs-ease-enter) disabled:cursor-default",
                        form.collateral === collateral
                          ? "bg-fs-surface text-fs-popup-text shadow-sm"
                          : "text-fs-popup-text-2 [@media(hover:hover)]:enabled:hover:text-fs-popup-text",
                      )}
                    >
                      {collateral}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-fs-popup-text-2 mt-1.5 text-[13px] leading-[18px] text-pretty">
                Split into every outcome, then paired with each branch&apos;s UP and DOWN.
              </p>
            </section>

            {seed.fields.map((field, index) => {
              const name = names[index] ?? `Branch ${index + 1}`;
              const noteId = `${id}-lock-${index}`;
              const pool = seed.shown?.pools[index];
              return (
                <section key={name} className="@container rounded-fs-panel bg-fs-popup-panel px-4 py-3">
                  <h3 className="text-fs-popup-text text-sm font-semibold wrap-anywhere">{name}</h3>
                  <div className="mt-2 grid grid-cols-2 gap-3 @max-[17rem]:grid-cols-1">
                    <label className="text-fs-popup-text-2 flex min-w-0 flex-col gap-1 text-xs font-medium">
                      <span>
                        <span className="sr-only">{name} </span>Depth
                      </span>
                      <input
                        className={FIELD}
                        inputMode="decimal"
                        autoComplete="off"
                        value={field.depth}
                        readOnly={isLocked}
                        onChange={(event) => edit("depths", index, event.target.value)}
                      />
                    </label>
                    <label className="text-fs-popup-text-2 flex min-w-0 flex-col gap-1 text-xs font-medium">
                      <span>
                        <span className="sr-only">{name} </span>UP price
                      </span>
                      <input
                        className={FIELD}
                        inputMode="decimal"
                        autoComplete="off"
                        value={field.price}
                        readOnly={field.priceLocked || isLocked}
                        aria-describedby={field.priceLocked ? noteId : undefined}
                        onChange={(event) => edit("prices", index, event.target.value)}
                      />
                    </label>
                  </div>
                  {field.priceLocked ? (
                    <p id={noteId} className="text-fs-popup-text-2 mt-1.5 text-xs leading-4 text-pretty">
                      Locked to the price of this branch&apos;s pool, which already holds liquidity.
                    </p>
                  ) : null}
                  {pool ? (
                    <dl className="mt-2 flex flex-col gap-1.5 border-t border-(--fs-popup-line) pt-2 text-[13px] leading-[18px] tabular-nums">
                      <AmountRow label="UP pool gets" amounts={pool.up} />
                      <AmountRow label="DOWN pool gets" amounts={pool.down} />
                    </dl>
                  ) : null}
                </section>
              );
            })}

            {seed.shown ? (
              <section className="rounded-fs-panel bg-fs-popup-panel px-4 py-3">
                <h3 className="type-label text-fs-popup-text-2 font-medium">Stays in your wallet</h3>
                <ul className="text-fs-popup-text mt-1 flex flex-col gap-0.5 text-[13px] leading-[18px] tabular-nums wrap-anywhere">
                  {seed.shown.leftovers.map((each) => (
                    <li key={each.label}>
                      {formatDisplayAmount(each.amount, 18)} {each.label}
                    </li>
                  ))}
                </ul>
                <p className="text-fs-popup-text-2 mt-1 text-xs leading-4">
                  Rounding dust of a few wei per token may stay too.
                </p>
              </section>
            ) : null}

            <div className="pt-1">
              <StepsTimeline rows={steps} stopped={stopped} className="liquidity-steps" />
            </div>
            {stopped && !run.progress?.holdsSend ? (
              <p className="text-fs-popup-text-2 px-1 pb-1 text-xs leading-4 text-pretty">
                Starting over keeps what this run already signed in your wallet; a new run splits again.
              </p>
            ) : null}
          </div>
        </ScrollFade>

        <StatusCallout id={`${id}-status`} status={status} />

        <LiquidityPopupFooter
          run={run}
          isOwn={isOwn}
          idle={{
            text: "Add liquidity",
            isDisabled: run.isHeld || problem !== undefined || !seed.request,
            onPress: () => seed.request && run.start(seed.request),
            describedBy: !ran && problem ? `${id}-status` : undefined,
          }}
        />
      </div>
    </Modal>
  );
}
