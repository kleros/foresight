import { render, screen, within } from "@testing-library/react";
import { gnosis } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import { explorerTxUrl } from "@/config/site";

import { type PlacedPrediction, PredictSuccessView } from "../PredictSuccessView";

const WAD = 10n ** 18n;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const WALLET = "0xdcee0000000000000000000000000000000c664f" as const;

const view = (placed: Partial<PlacedPrediction>) =>
  render(
    <PredictSuccessView
      isOpen
      placed={{ estimates: 2, amount: 10n * WAD, symbol: "sDAI", decimals: 18, ...placed }}
      leftOut={[]}
      onClose={vi.fn()}
      subscribed
      signUp={null}
      optionNoun="city"
      txUrl={(tx) => explorerTxUrl(tx, gnosis)}
    />,
  );

describe("PredictSuccessView's receipt", () => {
  it("links each step to its transaction on the explorer, in a new tab", () => {
    view({
      steps: [
        { id: "create-wallet", hash: hash(1) },
        { id: "deposit", hash: hash(2) },
        { id: "predict-1", hash: hash(3) },
      ],
      funds: { toAdd: 10n * WAD, symbol: "sDAI", decimals: 18 },
      wallet: WALLET,
    });
    const list = screen.getByRole("list", { name: "Transactions" });

    expect(
      within(list)
        .getAllByRole("link")
        .map((link) => [link.getAttribute("aria-label"), link.getAttribute("href"), link.getAttribute("target")]),
    ).toEqual([
      ["Trade wallet transaction, 0x000000…0001", `https://gnosisscan.io/tx/${hash(1)}`, "_blank"],
      ["Funds transaction, 0x000000…0002", `https://gnosisscan.io/tx/${hash(2)}`, "_blank"],
      ["Prediction transaction, 0x000000…0003", `https://gnosisscan.io/tx/${hash(3)}`, "_blank"],
    ]);
    expect(within(list).getByText("0xdcee...664f")).toBeInTheDocument();
  });

  it("numbers each batch's link on the one prediction row", () => {
    view({ steps: [1, 2, 3].map((n) => ({ id: `predict-${n}`, hash: hash(n + 2) })) });
    const row = screen.getByRole("listitem");

    expect(
      within(row)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["1", "2", "3"]);
    expect(within(row).getByRole("link", { name: "Prediction transaction 2 of 3, 0x000000…0004" })).toBeVisible();
  });

  it("draws a done bullet per row and no check mark of its own", () => {
    view({
      steps: [
        { id: "deposit", hash: hash(2) },
        { id: "predict-1", hash: hash(3) },
      ],
    });

    expect(document.querySelectorAll('[data-bullet="done"]')).toHaveLength(2);
    expect(screen.queryByTestId("success-mark")).toBeNull();
  });
});
