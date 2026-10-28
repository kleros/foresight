"use client";

import { useId, useState } from "react";

import { Button, CustomTimeline } from "@kleros/ui-components-library";
import clsx from "clsx";
import type { Address } from "viem";

import LightButton from "@/components/ui/LightButton";
import { Modal } from "@/components/ui/Modal";

import CloseIcon from "@/assets/svg/close.svg";

import { formatDisplayAmount } from "@/utils/amount";

import { LiquidityRunStatus } from "./LiquidityRunStatus";
import type { LiquidityBalances } from "../api/getLiquidityBalances";
import type { LiquidityRun } from "../hooks/useLiquidityRun";
import { useLiquiditySeed, type SeedForm } from "../hooks/useLiquiditySeed";
import type { TokenAmount } from "../hooks/useSessionLiquidity";
import type { SeedCollateral, SessionPools } from "../types";

const COLLATERALS: SeedCollateral[] = ["sDAI", "xDAI"];

const amounts = (list: TokenAmount[]) =>
  list.map(({ label, amount }) => `${formatDisplayAmount(amount, 18)} ${label}`).join(" + ");

const INPUT = clsx(
  "rounded-fs border-fs-border bg-fs-surface text-fs-popup-text w-full border px-3 py-2 text-sm tabular-nums",
  "read-only:bg-fs-popup-panel read-only:text-fs-popup-text-2",
);

/** The liquidity popup: the total, each branch's depth and UP price, what each pool gets and what stays, the steps. */
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
  const [form, setForm] = useState<SeedForm>({ total: "", collateral: "sDAI", depths: [], prices: [] });
  const { isRunning } = run;
  const seed = useLiquiditySeed({ pools, owner, names, balances, chainTime, closed, form });
  const problemId = useId();
  const balance = form.collateral === "sDAI" ? balances?.collateral : balances?.native;

  const edit = (key: "depths" | "prices", index: number, value: string) =>
    setForm((now) => {
      const list = [...now[key]];
      list[index] = value;
      return { ...now, [key]: list };
    });

  const steps = (seed.shown?.steps ?? []).map((row) => ({
    title:
      row.branch === null
        ? `Split ${form.total} ${form.collateral} into the session's outcomes`
        : `Seed ${names[row.branch] ?? "a branch"}`,
    party: `${row.signatures} ${row.signatures === 1 ? "signature" : "signatures"}`,
    subtitle: "",
  }));
  const [firstStep, ...restSteps] = steps;

  return (
    <Modal
      ariaLabel="Add liquidity"
      isOpen={isOpen}
      isDismissable={!isRunning}
      onOpenChange={(open) => (open || isRunning ? undefined : onClose())}
      className={clsx(
        "fixed top-18 left-1/2 -translate-x-1/2 transform",
        "h-auto max-h-[calc(100dvh-5rem)] w-[calc(100vw-2rem)] max-w-[520px]",
        "flex flex-col overflow-y-auto p-4 md:p-5",
        "fs-aurora rounded-fs-popup bg-fs-surface border border-(--fs-popup-edge) shadow-(--fs-popup-shadow)",
      )}
    >
      <div className="mb-3 flex h-8 shrink-0 items-center justify-between">
        <h2 className="text-fs-popup-text text-lg font-semibold tracking-[-0.01em]">Add liquidity</h2>
        <LightButton
          text=""
          aria-label="Close"
          icon={<CloseIcon className="text-fs-popup-text-2 size-4.5" />}
          isDisabled={isRunning}
          onPress={onClose}
          className="-mr-1.5 size-8 justify-center rounded-full! p-0"
        />
      </div>

      <section className="rounded-fs-panel bg-fs-popup-panel flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${problemId}-total`} className="type-label text-fs-popup-text-2 font-medium">
            Total
          </label>
          <div className="flex gap-1" role="group" aria-label="Pay in">
            {COLLATERALS.map((collateral) => (
              <button
                key={collateral}
                type="button"
                aria-pressed={form.collateral === collateral}
                disabled={isRunning}
                onClick={() => setForm((now) => ({ ...now, collateral }))}
                className={clsx(
                  "type-caption rounded-full px-2.5 py-0.5",
                  form.collateral === collateral ? "bg-fs-popup-chip text-fs-popup-text" : "text-fs-popup-text-2",
                )}
              >
                {collateral}
              </button>
            ))}
          </div>
        </div>
        <input
          id={`${problemId}-total`}
          className={INPUT}
          inputMode="decimal"
          placeholder="0.0"
          value={form.total}
          readOnly={isRunning}
          onChange={(event) => setForm((now) => ({ ...now, total: event.target.value }))}
        />
        {balance !== undefined ? (
          <p className="type-caption text-fs-popup-text-2 tabular-nums">
            Balance: {formatDisplayAmount(balance, 18)} {form.collateral}
          </p>
        ) : null}
      </section>

      <div className="mt-3 flex flex-col gap-3">
        {seed.fields.map((field, index) => {
          const name = names[index] ?? `Branch ${index + 1}`;
          const noteId = `${problemId}-lock-${index}`;
          const pool = seed.shown?.pools[index];
          return (
            <div key={name} className="rounded-fs-panel bg-fs-popup-panel flex flex-col gap-2 px-4 py-3">
              <p className="text-fs-popup-text text-sm font-semibold">{name}</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="type-caption text-fs-popup-text-2 flex flex-col gap-1">
                  {`${name} depth`}
                  <input
                    className={INPUT}
                    inputMode="decimal"
                    value={field.depth}
                    readOnly={isRunning}
                    onChange={(event) => edit("depths", index, event.target.value)}
                  />
                </label>
                <label className="type-caption text-fs-popup-text-2 flex flex-col gap-1">
                  {`${name} UP price`}
                  <input
                    className={INPUT}
                    inputMode="decimal"
                    value={field.price}
                    readOnly={field.priceLocked || isRunning}
                    aria-describedby={field.priceLocked ? noteId : undefined}
                    onChange={(event) => edit("prices", index, event.target.value)}
                  />
                </label>
              </div>
              {field.priceLocked ? (
                <p id={noteId} className="type-caption text-fs-popup-text-2">
                  Locked to the price of this branch&apos;s pool, which already holds liquidity.
                </p>
              ) : null}
              {pool ? (
                <dl className="type-caption text-fs-popup-text-2 flex flex-col gap-0.5 tabular-nums">
                  <div className="flex justify-between gap-3">
                    <dt>UP pool gets</dt>
                    <dd className="text-right">{amounts(pool.up)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>DOWN pool gets</dt>
                    <dd className="text-right">{amounts(pool.down)}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
          );
        })}
      </div>

      {seed.shown ? (
        <section className="mt-3 px-1">
          <h3 className="type-label text-fs-popup-text-2 font-medium">Stays in your wallet</h3>
          <ul className="type-caption text-fs-popup-text mt-1 flex flex-col gap-0.5 tabular-nums">
            {seed.shown.leftovers.map((each) => (
              <li key={each.label}>
                {formatDisplayAmount(each.amount, 18)} {each.label}
              </li>
            ))}
          </ul>
          <p className="type-caption text-fs-popup-text-2 mt-1">Rounding dust of a few wei per token may stay too.</p>
        </section>
      ) : null}

      {firstStep ? (
        <div className="mt-3 px-1">
          <h3 className="type-label text-fs-popup-text-2 pb-2 font-medium">Steps to sign</h3>
          <CustomTimeline items={[firstStep, ...restSteps]} />
        </div>
      ) : null}

      <div className="mt-3">
        {seed.problem ? (
          <p id={problemId} className="type-label text-fs-popup-text-2 mb-2">
            {seed.problem}
          </p>
        ) : null}
        <LiquidityRunStatus run={run} />
      </div>

      <div className="mt-3">
        <Button
          className="w-full"
          text="Add liquidity"
          isLoading={isRunning}
          isDisabled={run.isHeld || seed.problem !== undefined || !seed.request}
          aria-describedby={seed.problem ? problemId : undefined}
          onPress={() => seed.request && run.start(seed.request)}
        />
      </div>
    </Modal>
  );
}
