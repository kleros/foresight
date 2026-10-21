import type { ReactNode } from "react";

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { SessionDetail, SessionStatus } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

const account = vi.hoisted(() => ({ address: "0xa11ce000000000000000000000000000000a11ce" as string | undefined }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: account.address }),
}));
const chainGate = vi.hoisted(() => ({ classNames: [] as Array<string | undefined> }));
vi.mock("@/components/wallet/EnsureChain", () => ({
  default: ({ children, className }: { children: ReactNode; className?: string }) => {
    chainGate.classNames.push(className);
    return children;
  },
}));

const NAMES = ["Berlin", "Lisbon", "Nairobi", "Montevideo"];
const MARKETS = ["0x1111", "0x2222", "0x3333", "0x4444"].map((head) => head.padEnd(42, head.slice(-1)));

const session = (count: number): SessionDetail =>
  toSessionDetail(
    {
      ...sessionDetailColumns,
      id: "7",
      outcomeCount: String(count),
      deployedChildCount: String(count),
      children: NAMES.slice(0, count).map((name, index) =>
        sessionChildRow({ id: MARKETS[index], parentOutcomeIndex: String(index), displayName: name }),
      ),
    },
    GATEWAY,
  );

/** Every pool sits at 250; the picks alternate above and below it. */
const MARKET = 250;
const VALUES = [400, 120, 320, 180];

function pick(detail: SessionDetail) {
  detail.options.forEach((option, index) =>
    useEstimateStore.getState().setEstimate(detail.parentMarket, option.market, VALUES[index]!),
  );
}

function renderCard(detail: SessionDetail, status: SessionStatus = "trading") {
  const marketEstimates = Object.fromEntries(detail.options.map((option) => [option.market.toLowerCase(), MARKET]));
  return render(<PredictCard session={detail} status={status} marketEstimates={marketEstimates} />);
}

const dock = () => document.querySelector("[data-predict-dock]");

beforeEach(() => {
  window.localStorage.clear();
  account.address = "0xa11ce000000000000000000000000000000a11ce";
  useEstimateStore.getState().resetEstimates(session(4).parentMarket);
  document.body.replaceChildren();
});

describe("the predict card's picks", () => {
  it("shows each pick as its name, its side of the market and its value, in the option's unit", () => {
    const detail = session(2);
    pick(detail);
    renderCard(detail);

    const chips = within(screen.getByRole("list", { name: "Your estimates" }))
      .getAllByRole("listitem")
      .filter((item) => !item.hasAttribute("aria-label"));
    expect(chips.map((chip) => chip.textContent)).toEqual(["Berlin400 $M", "Lisbon120 $M"]);
    expect(within(chips[0]!).getByRole("img", { name: "above the market" })).toBeInTheDocument();
    expect(within(chips[1]!).getByRole("img", { name: "below the market" })).toBeInTheDocument();
    expect(within(chips[0]!).getByText("Berlin")).toHaveAttribute("title", "Berlin");
  });

  it("names three picks from lg up and two below, and counts the rest", () => {
    const detail = session(4);
    pick(detail);
    renderCard(detail);

    const list = screen.getByRole("list", { name: "Your estimates" });
    const chips = within(list)
      .getAllByRole("listitem")
      .filter((item) => !item.hasAttribute("aria-label"));
    expect(chips).toHaveLength(4);
    expect(chips[2]).toHaveClass("max-lg:hidden");
    expect(chips[3]).toHaveClass("hidden");
    expect(screen.getByLabelText("1 more estimate")).toHaveClass("max-lg:hidden");
    expect(screen.getByLabelText("2 more estimates")).toHaveClass("lg:hidden");
  });

  it("shows no picks and no bar while nothing is set away from the market", () => {
    renderCard(session(2));

    expect(screen.queryByRole("list", { name: "Your estimates" })).toBeNull();
    expect(dock()).toBeNull();
    expect(screen.getByRole("button", { name: "Predict estimates" })).toBeDisabled();
  });
});

describe("the phone bar at the bottom edge", () => {
  it("is offered while Predict is live, its phone button saying Predict and the wide one the count", () => {
    const detail = session(4);
    pick(detail);
    renderCard(detail);

    expect(dock()).not.toBeNull();
    expect(screen.getByRole("button", { name: "Predict" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Predict 4 estimates" })).toBeEnabled();
  });

  it("is not drawn without a wallet; the card keeps its button and says why", () => {
    account.address = undefined;
    const detail = session(2);
    pick(detail);
    renderCard(detail);

    expect(dock()).toBeNull();
    expect(screen.getByRole("button", { name: "Predict 2 estimates" })).toBeDisabled();
    expect(screen.getByText("Connect a wallet to predict.")).toBeInTheDocument();
  });

  it.each(["closed", "setting-up"] as const)("is not drawn while the session is %s", (status) => {
    const detail = session(2);
    pick(detail);
    renderCard(detail, status);

    expect(dock()).toBeNull();
  });

  it("hands its button's look to the wrong-chain switch that stands in for it", () => {
    chainGate.classNames.length = 0;
    const detail = session(2);
    pick(detail);
    renderCard(detail);

    expect(chainGate.classNames.length).toBeGreaterThan(0);
    for (const className of chainGate.classNames) expect(className).toBe("predict-cta predict-card-cta");
  });
});
