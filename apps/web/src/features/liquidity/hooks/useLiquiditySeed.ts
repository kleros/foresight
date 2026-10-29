"use client";

import { useMemo } from "react";

import type { Address } from "viem";

import { formatAmount, parseAmount } from "@/utils/amount";

import { LIQUIDITY_CLOSED_REASON } from "@/config/liquidity";

import { tokenLabels, type TokenAmount } from "./useSessionLiquidity";
import { useSDaiPreviewDeposit, type LiquidityBalances } from "../api/getLiquidityBalances";
import { BPS, bpsForSqrtPrice } from "../flow/math";
import { planSeed } from "../flow/plan";
import { MAX_SEED_PRICE_BPS, MIN_SEED_PRICE_BPS } from "../oracle/tolerances";
import { rowsOf } from "../run/rows";
import type { LiquidityRequest, SeedCollateral, SeedInput, SeedPlan, SessionPools } from "../types";
import type { PlannedRow } from "../utils/runSteps";

const PRICE_DECIMALS = 4;
export const DEFAULT_UP_PRICE = formatAmount(BPS / 2n, PRICE_DECIMALS);

/** What the visitor typed; an undefined entry has not been edited and takes its default. */
export interface SeedForm {
  total: string;
  collateral: SeedCollateral;
  depths: (string | undefined)[];
  prices: (string | undefined)[];
}

/** The form a seed request was reviewed from, so a stored run shows the amounts it signs. */
export const formOf = (input: SeedInput): SeedForm => ({
  total: formatAmount(input.total, 18),
  collateral: input.collateral,
  depths: input.branches.map((branch) => formatAmount(branch.depth, 18)),
  prices: input.branches.map((branch) => formatAmount(branch.upPriceBps, PRICE_DECIMALS)),
});

const childIsToken0 = (child: Address, outcome: Address) => BigInt(child) < BigInt(outcome);

/** UP's price where a pool of the branch holds liquidity: the UP pool's own, else one less the DOWN pool's (L2, L3). */
function lockedUpBps(pools: SessionPools, index: number): bigint | undefined {
  const tokens = pools.session.branches[index]!;
  const { up, down } = pools.branches[index]!;
  if (up.status === "live") return bpsForSqrtPrice(up.sqrtPriceX96, childIsToken0(tokens.upToken, tokens.outcome));
  if (down.status === "live")
    return BPS - bpsForSqrtPrice(down.sqrtPriceX96, childIsToken0(tokens.downToken, tokens.outcome));
  return undefined;
}

function planned(input: SeedInput): SeedPlan | undefined {
  try {
    return planSeed(input);
  } catch {
    return undefined;
  }
}

/** The popup's form read against the pools: each field's shown value, the plan, and why it cannot be signed yet. */
export function useLiquiditySeed({
  pools,
  owner,
  names,
  balances,
  chainTime,
  closed,
  form,
}: {
  pools: SessionPools | undefined;
  owner: Address | undefined;
  names: string[];
  balances: LiquidityBalances | undefined;
  chainTime: bigint | undefined;
  closed: boolean;
  form: SeedForm;
}) {
  const total = parseAmount(form.total, 18) ?? undefined;
  const previewDeposit = useSDaiPreviewDeposit(
    form.collateral === "xDAI" ? pools?.session.collateral : undefined,
    form.collateral === "xDAI" ? total : undefined,
  );

  return useMemo(() => {
    const count = pools?.branches.length ?? 0;
    const locked = Array.from({ length: count }, (_, index) => (pools ? lockedUpBps(pools, index) : undefined));
    const fields = locked.map((bps, index) => ({
      depth: form.depths[index] ?? form.total,
      price: bps !== undefined ? formatAmount(bps, PRICE_DECIMALS) : (form.prices[index] ?? DEFAULT_UP_PRICE),
      priceLocked: bps !== undefined,
    }));
    const depths = fields.map((field) => parseAmount(field.depth, 18));
    const prices = fields.map((field, index) => locked[index] ?? parseAmount(field.price, PRICE_DECIMALS));
    const inRange = (bps: bigint | null) => bps !== null && bps >= MIN_SEED_PRICE_BPS && bps <= MAX_SEED_PRICE_BPS;

    const problem = (() => {
      if (closed) return LIQUIDITY_CLOSED_REASON;
      if (!owner) return "Connect a wallet to add liquidity.";
      if (!pools || chainTime === undefined) return "Reading the pools…";
      if (total === undefined) return "Enter a total.";
      if (depths.some((depth) => depth === null)) return "Enter a depth for each branch.";
      if (depths.some((depth) => depth !== null && depth > total)) return "A branch can't be deeper than the total.";
      if (!prices.every(inRange)) {
        const [min, max] = [MIN_SEED_PRICE_BPS, MAX_SEED_PRICE_BPS].map((bps) => formatAmount(bps, PRICE_DECIMALS));
        return `An UP price is between ${min} and ${max}.`;
      }
      if (form.collateral === "xDAI" && previewDeposit.data === undefined) return "Reading the sDAI rate…";
      return undefined;
    })();
    // the plan is shown whenever the form reads, even where it cannot be signed yet
    if (!pools || !owner || chainTime === undefined || total === undefined) return { fields, problem };
    if (!depths.every((depth) => depth !== null && depth <= total) || !prices.every(inRange))
      return { fields, problem };
    if (form.collateral === "xDAI" && previewDeposit.data === undefined) return { fields, problem };

    const input: SeedInput = {
      session: pools.session,
      owner,
      total,
      collateral: form.collateral,
      ...(form.collateral === "xDAI" ? { previewDeposit: previewDeposit.data } : {}),
      chainTime,
      branches: pools.branches.map((branchPools, index) => ({
        depth: depths[index]!,
        upPriceBps: prices[index]!,
        pools: branchPools,
      })),
    };
    const plan = planned(input);
    if (!plan) return { fields, problem: problem ?? "Too small to seed. Raise the amounts." };

    const label = tokenLabels(pools.session, names);
    const amount = (token: Address, value: bigint): TokenAmount => ({ label: label(token), amount: value });
    const balance = form.collateral === "sDAI" ? balances?.collateral : balances?.native;
    const request: LiquidityRequest = { kind: "seed", input };
    return {
      fields,
      problem: problem ?? (balance !== undefined && total > balance ? `Not enough ${form.collateral}.` : undefined),
      request,
      shown: {
        pools: plan.branches.map((branch, index) => ({
          name: names[index] ?? "",
          up: [
            amount(branch.pools.up.token0, branch.pools.up.amount0),
            amount(branch.pools.up.token1, branch.pools.up.amount1),
          ],
          down: [
            amount(branch.pools.down.token0, branch.pools.down.amount0),
            amount(branch.pools.down.token1, branch.pools.down.amount1),
          ],
        })),
        leftovers: plan.leftovers.map((each) => amount(each.token, each.amount)),
        /** The timeline's rows: the parent split, then each branch, with their signature counts. */
        steps: rowsOf(request, plan.steps).map((row): PlannedRow => ({ id: row.id, signatures: row.stepIds.length })),
      },
    };
  }, [pools, owner, names, balances, chainTime, closed, form, total, previewDeposit.data]);
}
