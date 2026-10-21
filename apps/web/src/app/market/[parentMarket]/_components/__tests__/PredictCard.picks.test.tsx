import type { ReactNode } from "react";

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { SessionDetail } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

const account = vi.hoisted(() => ({ address: "0xa11ce000000000000000000000000000000a11ce" as string | undefined }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: account.address }),
}));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));

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

function renderCard(detail: SessionDetail, barSlot?: HTMLElement) {
  const marketEstimates = Object.fromEntries(detail.options.map((option) => [option.market.toLowerCase(), MARKET]));
  return render(<PredictCard session={detail} status="trading" marketEstimates={marketEstimates} barSlot={barSlot} />);
}

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

    const chips = within(screen.getByRole("list", { name: "Your estimates" })).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Berlin400 $M", "Lisbon120 $M"]);
    expect(within(chips[0]!).getByRole("img", { name: "above the market" })).toBeInTheDocument();
    expect(within(chips[1]!).getByRole("img", { name: "below the market" })).toBeInTheDocument();
    expect(within(chips[0]!).getByText("Berlin")).toHaveAttribute("title", "Berlin");
  });

  it("names three picks on a wide screen and two on a phone, and counts the rest", () => {
    const detail = session(4);
    pick(detail);
    renderCard(detail);

    const list = screen.getByRole("list", { name: "Your estimates" });
    const chips = within(list)
      .getAllByRole("listitem")
      .filter((item) => !item.hasAttribute("aria-label"));
    expect(chips).toHaveLength(4);
    expect(chips[2]).toHaveClass("max-md:hidden");
    expect(chips[3]).toHaveClass("hidden");
    expect(screen.getByLabelText("1 more estimate")).toHaveClass("max-md:hidden");
    expect(screen.getByLabelText("2 more estimates")).toHaveClass("md:hidden");
  });

  it("shows no picks and no bar while nothing is set away from the market", () => {
    const slot = document.createElement("div");
    document.body.append(slot);
    renderCard(session(2), slot);

    expect(screen.queryByRole("list", { name: "Your estimates" })).toBeNull();
    expect(slot).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Predict estimates" })).toBeDisabled();
  });
});

describe("the phone bar under the header", () => {
  it("says how many picks and names the first two, beside its own Predict", () => {
    const detail = session(4);
    pick(detail);
    const slot = document.createElement("div");
    document.body.append(slot);
    renderCard(detail, slot);

    expect(within(slot).getByText("4 estimates · Berlin, Lisbon +2")).toBeInTheDocument();
    expect(within(slot).getByRole("button", { name: "Predict" })).toBeEnabled();
    // the card keeps its own button for wide screens, where the bar is hidden
    expect(screen.getByRole("button", { name: "Predict 4 estimates" })).toBeInTheDocument();
  });

  it("names one pick alone, in the singular", () => {
    const detail = session(1);
    pick(detail);
    const slot = document.createElement("div");
    document.body.append(slot);
    renderCard(detail, slot);

    expect(within(slot).getByText("1 estimate · Berlin")).toBeInTheDocument();
  });

  it("is off whenever the card's button is, here without a wallet", () => {
    account.address = undefined;
    const detail = session(2);
    pick(detail);
    const slot = document.createElement("div");
    document.body.append(slot);
    renderCard(detail, slot);

    expect(within(slot).getByRole("button", { name: "Predict" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Predict 2 estimates" })).toBeDisabled();
  });

  it("is not drawn where the page gives the card no slot", () => {
    const detail = session(2);
    pick(detail);
    renderCard(detail);

    expect(screen.queryByRole("button", { name: "Predict" })).toBeNull();
  });
});
