import { createRoot } from "react-dom/client";

import { parseUnits, type Address } from "viem";

import { AmountDialog } from "@/features/trade-executor/components/TradeWallet/AmountDialog";
import { OptionBalances } from "@/features/trade-executor/components/TradeWallet/OptionBalances";
import type { TradeWalletOption } from "@/features/trade-executor/types";

import "@/styles/global.css";
import "../inter.css";

/** From a name wider than any card to a two-letter one, in Latin, German compound and CJK text. */
const NAMES = [
  "Greater Metropolitan Region of São Paulo and Surrounding Areas",
  "Lisbon metropolitan area",
  "Benachrichtigungseinstellungen",
  "東京都特別区部および多摩地域",
  "Jo",
];

const params = new URLSearchParams(window.location.search);
/** `?view=balances` the option balances in a page column; `?view=mint` the Mint dialog. */
const view = params.get("view") ?? "balances";
/** `?available=` what Mint may use, as a decimal. */
const available = parseUnits(params.get("available") ?? "1588.1092", 18);

const address = (index: number, side: string) => `0x${side}${String(index + 1).padStart(39, "0")}` as Address;

const options: TradeWalletOption[] = NAMES.map((name, index) => ({
  token: address(index, "a"),
  name,
  color: "#009aff",
  positions: [
    { side: "UP", token: address(index, "b") },
    { side: "DOWN", token: address(index, "c") },
  ],
}));
const positions = new Map<Address, bigint>(
  options.flatMap((option) => [
    [option.positions[0]!.token, parseUnits("12345678.9", 18)],
    [option.positions[1]!.token, parseUnits("0.5", 18)],
  ]),
);

createRoot(document.getElementById("root")!).render(
  view === "mint" ? (
    <AmountDialog
      isOpen
      onClose={() => {}}
      title="Mint city tokens"
      hint="Turns sDAI in your trade wallet into city tokens."
      actionText="Mint"
      available={available}
      isLoadingBalance={false}
      decimals={18}
      symbol="sDAI"
      onSubmit={() => {}}
      isPending={false}
    />
  ) : (
    <main className="mx-auto w-full max-w-294 px-4 py-6">
      <section aria-label="Trade wallet" className="bg-fs-surface-sunken rounded-fs flex flex-col px-4 py-3 md:px-6">
        <OptionBalances
          options={options}
          balances={options.map(() => parseUnits("123456789.12", 18))}
          positions={positions}
          noun="city"
          decimals={18}
        />
      </section>
    </main>
  ),
);
