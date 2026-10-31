import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getAddress, parseEther, type Address } from "viem";
import { gnosis } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExternalLeg,
  ExternalTrade,
  PredictionTrade,
  TradeOperation,
  TradeOptionDetail,
} from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";
import { toPredictions } from "@/features/sessions/utils/toSessionTrades";

import { formatLocalInstant } from "@/utils/date";

import type { SessionTradeRowsQuery } from "@/lib/graphql/generated/graphql";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { TradeList } from "../TradeList";

const account = vi.hoisted(() => ({ address: undefined as string | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: account.address }) }));
/* Production reads Gnosis; the test runner's default is the local chain, which has no explorer. */
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN: (await import("viem/chains")).gnosis,
  DEFAULT_CHAIN_ID: 100,
}));

const wei = (amount: string) => parseEther(amount).toString();
const e = parseEther;

const GERWIG = addresses.childMarkets[0]!.toLowerCase() as Address;
const VILLENEUVE = addresses.childMarkets[1]!.toLowerCase() as Address;

/** The session's collateral and two options; each session below sets its own outcome count. */
const SESSION_ROW = {
  collateralDecimals: 18,
  collateralSymbol: "sDAI",
  children: [
    sessionChildRow({ id: GERWIG, displayName: "Greta Gerwig" }),
    sessionChildRow({ id: VILLENEUVE, parentOutcomeIndex: "0", displayName: "Denis Villeneuve" }),
  ],
};
/** One outcome, so an amount of underlying reads as the same amount of collateral. */
const session = toSessionDetail({ ...sessionDetailColumns, ...SESSION_ROW, outcomeCount: "1" }, GATEWAY);

const TRADER = "0x777777777777777777777777777777777777a001" as Address;
const OTHER = "0x777777777777777777777777777777777777a002" as Address;
const OUTSIDER = "0x51d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabeef" as Address;
const TX = `0x${"01".repeat(32)}`;
/** 30 Oct 2026, 12:00 UTC, in Unix seconds. */
const NOW = 1_793_361_600;

type PredictionRow = SessionTradeRowsQuery["Prediction"][number];
type TransferRow = SessionTradeRowsQuery["Transfer"][number];

/** One option's slice of a prediction in the trade wallet's own columns, every one zero unless set. */
function row(tx: string, columns: Partial<PredictionRow>): PredictionRow {
  return {
    transactionHash: tx,
    blockNumber: "100",
    timestamp: "1756000000",
    childMarket_id: addresses.childMarkets[0]!,
    childMarket: { downToken: addresses.downToken, upToken: addresses.upToken },
    executor_id: TRADER,
    executor: { owner: TRADER },
    downDelta: "0",
    upDelta: "0",
    downBalance: "0",
    upBalance: "0",
    downSwapUnderlying: "0",
    downSwapTokens: "0",
    upSwapUnderlying: "0",
    upSwapTokens: "0",
    downAvgPrice: null,
    upAvgPrice: null,
    downPriceBefore: null,
    downPriceAfter: null,
    upPriceBefore: null,
    upPriceAfter: null,
    ...columns,
  };
}

/** The router moving one of the option's tokens into the trade wallet (positive) or out of it. */
const routerTransfer = (tx: string, logIndex: number, token: string, amount: string): TransferRow => ({
  id: `${tx}-${logIndex}-${TRADER}`,
  transactionHash: tx,
  executor_id: TRADER,
  token,
  amount,
});

/** An option's slice with only the columns a test sets, and the steps it lists. */
function option(childMarket: Address, overrides: Partial<TradeOptionDetail> = {}): TradeOptionDetail {
  return {
    childMarket,
    downDelta: 0n,
    upDelta: 0n,
    downBalance: 0n,
    upBalance: 0n,
    downSwapUnderlying: 0n,
    downSwapTokens: 0n,
    upSwapUnderlying: 0n,
    upSwapTokens: 0n,
    downAvgPrice: null,
    upAvgPrice: null,
    downPriceBefore: null,
    downPriceAfter: null,
    upPriceBefore: null,
    upPriceAfter: null,
    operations: [],
    ...overrides,
  };
}

function prediction(overrides: Partial<PredictionTrade> & { options: TradeOptionDetail[] }): PredictionTrade {
  return {
    kind: "prediction",
    id: `${TX}-${TRADER}`,
    transactionHash: TX,
    blockNumber: 100n,
    timestamp: NOW - 60,
    executor: TRADER,
    owner: TRADER,
    cost: 0n,
    ...overrides,
  };
}

function external(overrides: Partial<ExternalTrade> & { legs: ExternalLeg[] }): ExternalTrade {
  return {
    kind: "external",
    id: `0x${"02".repeat(32)}`,
    transactionHash: `0x${"02".repeat(32)}`,
    blockNumber: 99n,
    timestamp: NOW - 120,
    sender: OUTSIDER,
    ...overrides,
  };
}

const swap = (logIndex: number, side: "UP" | "DOWN", bought: boolean, tokens: string, underlying: string) =>
  ({ kind: "swap", logIndex, side, bought, tokens: e(tokens), underlying: e(underlying) }) satisfies TradeOperation;

// jsdom computes no Tailwind, so a row's hover look is read from its classes.
const HOVER_LOOK = ["cursor-pointer", "hover:bg-fs-surface-tint"];

/** The text of the popup line a label starts. */
const lineOf = (dialog: HTMLElement, label: string) => within(dialog).getByText(label).parentElement!.textContent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
  account.address = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TradeList rows", () => {
  it("sizes a prediction that took more underlying out than it put in by the amount, unsigned", () => {
    // 10 UP sold for 3.1: cost -3.1
    const trades = toPredictions(
      [
        row("0x01", {
          upDelta: `-${wei("10")}`,
          upSwapTokens: `-${wei("10")}`,
          upSwapUnderlying: wei("3.1"),
          upAvgPrice: wei("0.31"),
        }),
      ],
      [],
      [],
    );

    render(<TradeList session={session} trades={trades} />);

    const prediction = screen.getByRole("button");
    expect(prediction.textContent).toContain("~3.1 sDAI");
    expect(prediction.textContent).not.toMatch(/~-/);
  });

  it("sizes a prediction in collateral at its underlying over the decision's outcome count", () => {
    // 10 underlying in a four-outcome decision is 2.5 collateral
    const fourOutcomes = toSessionDetail({ ...sessionDetailColumns, ...SESSION_ROW, outcomeCount: "4" }, GATEWAY);

    render(<TradeList session={fourOutcomes} trades={[prediction({ cost: e("10"), options: [option(GERWIG)] })]} />);

    expect(screen.getByRole("button").textContent).toContain("~2.5 sDAI");
  });

  it("sizes an external swap in collateral at its underlying over the decision's outcome count", () => {
    // 6 underlying in a four-outcome decision is 1.5 collateral
    const fourOutcomes = toSessionDetail({ ...sessionDetailColumns, ...SESSION_ROW, outcomeCount: "4" }, GATEWAY);
    const outside = external({ legs: [{ childMarket: GERWIG, side: "UP", bought: true, underlying: e("6") }] });

    render(<TradeList session={fourOutcomes} trades={[outside]} />);

    expect(screen.getByRole("listitem").textContent).toContain("~1.5 sDAI");
  });

  it("shows the first option a prediction traded and +1 for the second", () => {
    render(<TradeList session={session} trades={[prediction({ options: [option(GERWIG), option(VILLENEUVE)] })]} />);

    const row = screen.getByRole("button");
    expect(within(row).getByText("Greta Gerwig")).toBeInTheDocument();
    expect(within(row).getByText("+1")).toBeInTheDocument();
  });

  it("shows the first option a prediction traded and +2 for the other two", () => {
    const COPPOLA = `0x${"c3".repeat(20)}` as Address;
    const threeOptions = toSessionDetail(
      {
        ...sessionDetailColumns,
        ...SESSION_ROW,
        children: [
          ...SESSION_ROW.children,
          sessionChildRow({ id: COPPOLA, parentOutcomeIndex: "2", displayName: "Sofia Coppola" }),
        ],
        outcomeCount: "1",
      },
      GATEWAY,
    );

    render(
      <TradeList
        session={threeOptions}
        trades={[prediction({ options: [option(GERWIG), option(VILLENEUVE), option(COPPOLA)] })]}
      />,
    );

    const row = screen.getByRole("button");
    expect(within(row).getByText("Greta Gerwig")).toBeInTheDocument();
    expect(within(row).getByText("+2")).toBeInTheDocument();
  });

  it("names every option a prediction traded in its row's tooltip", () => {
    render(<TradeList session={session} trades={[prediction({ options: [option(GERWIG), option(VILLENEUVE)] })]} />);

    expect(within(screen.getByRole("button")).getByTitle("Greta Gerwig, Denis Villeneuve")).toBeInTheDocument();
  });

  it("names the connected account's own prediction You and another trader's by short address", () => {
    account.address = getAddress(TRADER);
    render(
      <TradeList
        session={session}
        trades={[
          prediction({ options: [option(GERWIG)] }),
          prediction({ id: `${TX}-${OTHER}`, executor: OTHER, owner: OTHER, options: [option(GERWIG)] }),
        ]}
      />,
    );

    const [mine, theirs] = screen.getAllByRole("button");
    expect(within(mine!).getByText("You")).toBeInTheDocument();
    expect(theirs!.textContent).toContain(`${OTHER.slice(0, 6)}`);
    expect(theirs!.textContent).not.toContain("You");
  });

  it("shows how long ago a trade was, with its exact time on hover", () => {
    const timestamp = NOW - 5 * 60;
    render(<TradeList session={session} trades={[prediction({ timestamp, options: [option(GERWIG)] })]} />);

    const when = within(screen.getByRole("button")).getByText("5 min. ago");
    expect(when).toHaveAttribute("title", formatLocalInstant(new Date(timestamp * 1000)));
  });

  it("shows a trade stamped ahead of this clock as now", () => {
    render(
      <TradeList session={session} trades={[prediction({ timestamp: NOW + 3_600, options: [option(GERWIG)] })]} />,
    );

    expect(within(screen.getByRole("button")).getByText("now")).toBeInTheDocument();
  });

  it("links every row to its transaction on the chain's explorer", () => {
    const outside = external({ legs: [{ childMarket: GERWIG, side: "UP", bought: true, underlying: e("1") }] });
    render(<TradeList session={session} trades={[prediction({ options: [option(GERWIG)] }), outside]} />);

    const links = screen.getAllByRole("link", { name: /transaction/i }).map((link) => link.getAttribute("href"));
    expect(links).toEqual([
      `${gnosis.blockExplorers.default.url}/tx/${TX}`,
      `${gnosis.blockExplorers.default.url}/tx/${outside.transactionHash}`,
    ]);
  });
});

describe("TradeList external rows", () => {
  it("says buy for a swap the pool paid tokens out on and sell for one it took tokens in on", () => {
    const bought = external({ legs: [{ childMarket: GERWIG, side: "UP", bought: true, underlying: e("1") }] });
    const sold = external({
      id: `0x${"03".repeat(32)}`,
      transactionHash: `0x${"03".repeat(32)}`,
      sender: OTHER,
      legs: [{ childMarket: GERWIG, side: "DOWN", bought: false, underlying: e("2") }],
    });
    render(<TradeList session={session} trades={[bought, sold]} />);

    const [first, second] = screen.getAllByRole("listitem");
    expect(first!.textContent).toContain("Greta Gerwig · UP buy");
    expect(second!.textContent).toContain("Greta Gerwig · DOWN sell");
  });

  it("says buy for a DOWN the pool paid out and sell for an UP it took in", () => {
    const boughtDown = external({ legs: [{ childMarket: GERWIG, side: "DOWN", bought: true, underlying: e("1") }] });
    const soldUp = external({
      id: `0x${"03".repeat(32)}`,
      transactionHash: `0x${"03".repeat(32)}`,
      sender: OTHER,
      legs: [{ childMarket: GERWIG, side: "UP", bought: false, underlying: e("2") }],
    });
    render(<TradeList session={session} trades={[boughtDown, soldUp]} />);

    const [first, second] = screen.getAllByRole("listitem");
    expect(first!.textContent).toContain("Greta Gerwig · DOWN buy");
    expect(second!.textContent).toContain("Greta Gerwig · UP sell");
  });

  it("shows +2 beside the first swap of an external transaction that swapped three times", () => {
    const three = external({
      legs: [
        { childMarket: GERWIG, side: "UP", bought: true, underlying: e("1") },
        { childMarket: VILLENEUVE, side: "DOWN", bought: false, underlying: e("1") },
        { childMarket: GERWIG, side: "DOWN", bought: true, underlying: e("1") },
      ],
    });
    render(<TradeList session={session} trades={[three]} />);

    const [only] = screen.getAllByRole("listitem");
    expect(within(only!).getByText("Greta Gerwig · UP buy")).toBeInTheDocument();
    expect(within(only!).getByText("+2")).toBeInTheDocument();
  });

  it("shows a dash for the sender of an external swap indexed without one", () => {
    const unsent = external({
      sender: null,
      legs: [{ childMarket: GERWIG, side: "UP", bought: true, underlying: e("1") }],
    });
    render(<TradeList session={session} trades={[unsent]} />);

    const [only] = screen.getAllByRole("listitem");
    expect(within(only!).getByText("-")).toBeInTheDocument();
  });

  it("gives an external row none of the hover look of a prediction row", () => {
    const outside = external({ legs: [{ childMarket: GERWIG, side: "UP", bought: true, underlying: e("1") }] });
    render(<TradeList session={session} trades={[prediction({ options: [option(GERWIG)] }), outside]} />);

    const [predictionItem, externalItem] = screen.getAllByRole("listitem");
    for (const look of HOVER_LOOK) {
      expect(within(predictionItem!).getByRole("button")).toHaveClass(look);
      expect(externalItem!.firstElementChild).not.toHaveClass(look);
    }
  });

  it("shows a transaction's swaps as one row: the first, +1 for the second, and their underlying summed", () => {
    const both = external({
      legs: [
        { childMarket: GERWIG, side: "UP", bought: true, underlying: e("1.25") },
        { childMarket: VILLENEUVE, side: "DOWN", bought: false, underlying: e("2.5") },
      ],
    });
    render(<TradeList session={session} trades={[both]} />);

    const [only] = screen.getAllByRole("listitem");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(within(only!).getByText("Greta Gerwig · UP buy")).toBeInTheDocument();
    expect(within(only!).getByText("+1")).toBeInTheDocument();
    expect(within(only!).getByTitle("Greta Gerwig · UP buy, Denis Villeneuve · DOWN sell")).toBeInTheDocument();
    expect(only!.textContent).toContain("~3.75 sDAI");
  });

  it("opens nothing when an external row's marker or sender is clicked beside a prediction", async () => {
    const outside = external({ legs: [{ childMarket: GERWIG, side: "UP", bought: true, underlying: e("1") }] });
    render(<TradeList session={session} trades={[prediction({ options: [option(GERWIG)] }), outside]} />);
    const row = screen.getAllByRole("listitem")[1]!;

    await userEvent.click(within(row).getByText("External"));
    await userEvent.click(within(row).getByText(new RegExp(OUTSIDER.slice(-4), "i")));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the prediction popup from TradeList", () => {
  it("shows the sets a prediction merged", async () => {
    // 4 UP and 4 DOWN handed back to the router for 4 underlying, no swaps
    const trades = toPredictions(
      [row("0x02", { upDelta: `-${wei("4")}`, downDelta: `-${wei("4")}`, upBalance: wei("6"), downBalance: wei("6") })],
      [],
      [
        routerTransfer("0x02", 3, addresses.downToken, `-${wei("4")}`),
        routerTransfer("0x02", 4, addresses.upToken, `-${wei("4")}`),
      ],
    );
    render(<TradeList session={session} trades={trades} />);

    await userEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Merge").parentElement!.textContent).toContain("4 DOWN + UP");
    expect(within(dialog).queryByText("Mint")).toBeNull();
  });

  it("shows the sets a prediction minted", async () => {
    // 10 sets minted from the router, the 10 DOWN sold for 6.5
    const trades = toPredictions(
      [
        row("0x03", {
          upDelta: wei("10"),
          upBalance: wei("10"),
          downSwapTokens: `-${wei("10")}`,
          downSwapUnderlying: wei("6.5"),
          downAvgPrice: wei("0.65"),
        }),
      ],
      [],
      [
        routerTransfer("0x03", 1, addresses.downToken, wei("10")),
        routerTransfer("0x03", 2, addresses.upToken, wei("10")),
      ],
    );
    render(<TradeList session={session} trades={trades} />);

    await userEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Mint").parentElement!.textContent).toContain("10 DOWN + UP");
  });

  it("labels each swap with its side and direction, beside its tokens, price and underlying", async () => {
    const trade = prediction({
      options: [
        option(GERWIG, { operations: [swap(10, "DOWN", false, "8", "3.2"), swap(20, "UP", true, "6.5", "1.95")] }),
      ],
    });
    render(<TradeList session={session} trades={[trade]} />);

    await userEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    expect(lineOf(dialog, "Sell DOWN")).toContain("8 at 0.4 · 3.2 underlying");
    expect(lineOf(dialog, "Buy UP")).toContain("6.5 at 0.3 · 1.95 underlying");
  });

  it("labels a DOWN buy and an UP sell by their direction", async () => {
    const trade = prediction({
      options: [
        option(GERWIG, { operations: [swap(10, "DOWN", true, "5", "3.5"), swap(20, "UP", false, "4", "1.2")] }),
      ],
    });
    render(<TradeList session={session} trades={[trade]} />);

    await userEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    expect(lineOf(dialog, "Buy DOWN")).toContain("5 at 0.7 · 3.5 underlying");
    expect(lineOf(dialog, "Sell UP")).toContain("4 at 0.3 · 1.2 underlying");
  });

  it("lists two buys on one side as two lines", async () => {
    const trade = prediction({
      options: [option(GERWIG, { operations: [swap(3, "UP", true, "2", "0.5"), swap(7, "UP", true, "3", "0.9")] })],
    });
    render(<TradeList session={session} trades={[trade]} />);

    await userEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    const buys = within(dialog)
      .getAllByText("Buy UP")
      .map((label) => label.parentElement!.textContent);
    expect(buys).toHaveLength(2);
    expect(buys[0]).toContain("2 at 0.25 · 0.5 underlying");
    expect(buys[1]).toContain("3 at 0.3 · 0.9 underlying");
  });

  it("shows a mint, a sale and a merge of the same prediction in the order they ran", async () => {
    const trade = prediction({
      options: [
        option(GERWIG, {
          operations: [
            { kind: "mint", logIndex: 5, sets: e("10") },
            swap(8, "DOWN", false, "6", "3.6"),
            { kind: "merge", logIndex: 11, sets: e("4") },
          ],
        }),
      ],
    });
    render(<TradeList session={session} trades={[trade]} />);

    await userEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    const labels = within(dialog)
      .getAllByRole("listitem")
      .map((line) => line.textContent!.trim().split(/\s+/).slice(0, 2).join(" "));
    expect(labels.slice(0, 3)).toEqual(["Mint 10", "Sell DOWN", "Merge 4"]);
  });

  it("shows each side's balance after the trade beside its own label", async () => {
    const trade = prediction({ options: [option(GERWIG, { downBalance: e("3.75"), upBalance: e("12.5") })] });
    render(<TradeList session={session} trades={[trade]} />);

    await userEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    const balances = lineOf(dialog, "Balance after");
    expect(balances).toContain("3.75 DOWN");
    expect(balances).toContain("12.5 UP");
  });

  it("names the connected account You as the popup's trader", async () => {
    account.address = getAddress(TRADER);
    render(<TradeList session={session} trades={[prediction({ options: [option(GERWIG)] })]} />);

    await userEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/^You · /)).toBeInTheDocument();
  });

  it("links the popup to the prediction's transaction on the chain's explorer", async () => {
    render(<TradeList session={session} trades={[prediction({ options: [option(GERWIG)] })]} />);

    await userEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: /view transaction/i })).toHaveAttribute(
      "href",
      `${gnosis.blockExplorers.default.url}/tx/${TX}`,
    );
  });

  it("opens from the keyboard", async () => {
    render(<TradeList session={session} trades={[prediction({ options: [option(GERWIG)] })]} />);

    await userEvent.tab();
    await userEvent.keyboard("{Enter}");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
