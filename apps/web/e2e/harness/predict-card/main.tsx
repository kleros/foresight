import { useState } from "react";
import { createRoot } from "react-dom/client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAddress, type Address } from "viem";
import { hardhat } from "viem/chains";
import { createConfig, http, mock, WagmiProvider } from "wagmi";
import { connect } from "wagmi/actions";

import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { SessionDetail, SessionOption } from "@/features/sessions/types";

import { SectionCard } from "@/components/ui/SectionCard";

import { PREDICT_BAR_SLOT, PredictCard } from "@/app/market/[parentMarket]/_components/PredictCard";

import "@/styles/global.css";
import "../inter.css";

const params = new URLSearchParams(window.location.search);
/** `?set=normal` three picks, `worst` six with a 54-character name and a seven-digit value, `none` no picks. */
const set = params.get("set") ?? "normal";
/** `?wallet=0` no wallet connected. */
const isConnected = params.get("wallet") !== "0";
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");

const WALLET = "0xdcee0000000000000000000000000000000c664f";
const PARENT = "0x7777777777777777777777777777777777777777";

const PICKS: Record<string, [name: string, market: number, estimate: number][]> = {
  normal: [
    ["Berlin", 300, 400],
    ["Lisbon", 420, 360],
    ["Nairobi", 250, 320],
  ],
  worst: [
    ["Greater Lisbon and Setúbal Peninsula metropolitan area", 1_000_000, 1_234_567],
    ["Berlin", 420, 360],
    ["Nairobi", 250, 320],
    ["Montevideo", 330, 280],
    ["Hanoi", 200, 240],
    ["Accra", 260, 200],
  ],
};
const picks = PICKS[set] ?? PICKS.normal!;

const options: SessionOption[] = picks.map(([name], index) => ({
  market: getAddress(`0x${String(index + 1).repeat(40)}`.slice(0, 42)) as Address,
  outcomeIndex: index,
  name,
  color: ["#009aff", "#7e1bd4", "#18a957", "#f59e0b", "#ef4444", "#14b8a6"][index]!,
  unit: null,
  lowerBound: 0,
  upperBound: 2_000_000,
  question: `What will ${name} reach?`,
  upToken: null,
  downToken: null,
  invalidToken: null,
  underlyingToken: null,
  blocks: [],
}));

const session: SessionDetail = {
  id: "7",
  parentMarket: PARENT,
  deployer: WALLET,
  name: "City populations",
  description: null,
  iconUri: null,
  heroUri: null,
  closesAt: null,
  question: "How many people will live in each city?",
  itemName: "city",
  itemNamePlural: "cities",
  metadataResolved: true,
  outcomeCount: options.length,
  deployedChildCount: options.length,
  setupComplete: true,
  openedAt: new Date("2026-10-01T00:00:00Z"),
  collateralToken: null,
  collateralDecimals: 18,
  collateralSymbol: "sDAI",
  invalidToken: null,
  blocks: [],
  options,
};

const marketEstimates = Object.fromEntries(
  options.map((option, index) => [option.market.toLowerCase(), picks[index]![1]]),
);
useEstimateStore.setState({
  estimates:
    set === "none"
      ? {}
      : {
          [PARENT]: Object.fromEntries(options.map((option, index) => [option.market.toLowerCase(), picks[index]![2]])),
        },
});

// no transport reaches a node: the card only reads the account
const config = createConfig({
  chains: [hardhat],
  connectors: [mock({ accounts: [WALLET] })],
  // nothing persisted, so mounting the provider cannot restore a disconnected state over the connect below
  storage: null,
  transports: { [hardhat.id]: http("http://127.0.0.1:1") },
});
const queryClient = new QueryClient();

/** MarketPage's frame around the card: the bar's slot first in the column, the option cards above the card. */
function Harness() {
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  return (
    <>
      {/* Header's own frame; its menus need Next's app router */}
      <header className="fs-header sticky top-0 z-30 flex w-full">
        <div className="fs-page text-fs-text-primary flex h-16 items-center font-semibold">Foresight</div>
      </header>
      <main className="fs-page flex-1 py-10">
        <div className="mx-auto flex w-full max-w-294 flex-col">
          <div ref={setBar} className={PREDICT_BAR_SLOT} />
          <h1 className="text-fs-text-primary text-2xl font-semibold">{session.name}</h1>
          <section className="mt-12 flex flex-col gap-4">
            {options.map((option) => (
              <SectionCard key={option.market} className="text-fs-text-secondary h-14 p-4 text-sm">
                {option.name}
              </SectionCard>
            ))}
            <PredictCard session={session} status="trading" marketEstimates={marketEstimates} barSlot={bar} />
            <div className="h-[600px]" />
          </section>
        </div>
      </main>
    </>
  );
}

async function start() {
  if (isConnected) await connect(config, { connector: config.connectors[0]! });
  createRoot(document.getElementById("root")!).render(
    <WagmiProvider config={config} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    </WagmiProvider>,
  );
}

void start();
