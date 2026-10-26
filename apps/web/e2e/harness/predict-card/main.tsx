import { createRoot } from "react-dom/client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAddress, type Address } from "viem";
import { hardhat } from "viem/chains";
import { createConfig, http, mock, WagmiProvider } from "wagmi";
import { connect } from "wagmi/actions";

import type { PredictSnapshot } from "@/features/predict/flow/types";
import { predictFlowId } from "@/features/predict/run/interrupted";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { SessionDetail, SessionOption, SessionStatus } from "@/features/sessions/types";

import { Dialog } from "@/components/ui/Dialog";
import { SectionCard } from "@/components/ui/SectionCard";

import { createRunStore } from "@/lib/flowRunStore";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { PredictCard } from "@/app/market/[parentMarket]/_components/PredictCard";

import "@/styles/global.css";
import "../inter.css";

const params = new URLSearchParams(window.location.search);
/** `?set=normal` three picks, `worst` six with a 54-character name and a seven-digit value, `none` no picks. */
const set = params.get("set") ?? "normal";
/** `?wallet=0` no wallet connected. */
const isConnected = params.get("wallet") !== "0";
/** `?status=closed` or `setting-up`; trading otherwise. */
const status = (params.get("status") ?? "trading") as SessionStatus;
/** `?run=stored` an unfinished run of 3 sDAI is stored for the wallet, `pending` one whose deposit awaits a receipt. */
const run = params.get("run");
/** `?rows=N` options in all, the unpicked ones after the picks, so the card sits below a phone's fold. */
const rows = Number(params.get("rows") ?? "0");
/** `?dialog=1` a dialog open over the page. */
const isDialogOpen = params.get("dialog") === "1";
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
const MORE = ["Kraków", "Medellín", "Osaka", "Tbilisi", "Quito", "Perth", "Tunis", "Oslo", "Lima", "Pune", "Hobart"];
const names = [...picks.map(([name]) => name), ...MORE].slice(0, Math.max(picks.length, rows));

const options: SessionOption[] = names.map((name, index) => ({
  market: getAddress(`0x${(index + 1).toString(16).padStart(2, "0").repeat(20)}`) as Address,
  outcomeIndex: index,
  name,
  color: ["#009aff", "#7e1bd4", "#18a957", "#f59e0b", "#ef4444", "#14b8a6"][index % 6]!,
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
  options.map((option, index) => [option.market.toLowerCase(), picks[index]?.[1] ?? 500]),
);
const picked = Object.fromEntries(
  options.slice(0, picks.length).map((option, index) => [option.market.toLowerCase(), picks[index]![2]]),
);
/** For specs: put the first pick in, pick every option, or take every pick out, as a slider would. */
Object.assign(window, {
  pickFirst: () => useEstimateStore.getState().setEstimate(PARENT, options[0]!.market, picks[0]![2]),
  pickAll: () =>
    options.forEach((option, index) =>
      useEstimateStore.getState().setEstimate(PARENT, option.market, 900 + index * 37),
    ),
  clearPicks: () => useEstimateStore.getState().resetEstimates(PARENT),
});
useEstimateStore.setState({
  estimates:
    set === "none"
      ? {}
      : {
          [PARENT]: picked,
        },
});

const flowId = predictFlowId(session.id, WALLET);
if (run === "stored" || run === "pending") {
  const HASH = `0x${"ab".repeat(32)}` as const;
  createRunStore().save({
    flowId,
    adapterId: "predict-flow",
    // the card reads the deposit, its token and the credits from the snapshot, and only the owner from ctx
    snapshot: { deposit: 3n * 10n ** 18n, depositNative: false, creditsToSpend: 0n } as PredictSnapshot,
    ctx: { owner: WALLET, chainId: DEFAULT_CHAIN_ID },
    steps: [
      {
        stepId: "deposit",
        label: "Add funds",
        outcome: run === "pending" ? { status: "submitted", hash: HASH } : { status: "pending" },
      },
      { stepId: "predict", label: "Predict", outcome: { status: "pending" } },
    ],
    status: "paused",
    reason: "error",
    error: { stepId: "deposit", message: "RPC unavailable", cause: "rpc", hash: HASH },
  });
} else {
  // the page's storage outlives a spec's earlier visits
  createRunStore().clear(flowId);
}

// no transport reaches a node: the card only reads the account
const config = createConfig({
  chains: [hardhat],
  connectors: [mock({ accounts: [WALLET] })],
  // nothing persisted, so mounting the provider cannot restore a disconnected state over the connect below
  storage: null,
  transports: { [hardhat.id]: http("http://127.0.0.1:1") },
});
const queryClient = new QueryClient();

/** MarketPage's frame around the card: the option cards above the card, the trade wallet under it. */
function Harness() {
  return (
    <>
      {/* Header's own frame; its menus need Next's app router */}
      <header className="fs-header sticky top-0 z-30 flex w-full">
        <div className="fs-page text-fs-text-primary flex h-16 items-center font-semibold">Foresight</div>
      </header>
      <main className="fs-page flex-1 py-10">
        <div className="mx-auto flex w-full max-w-294 flex-col">
          <h1 className="text-fs-text-primary text-2xl font-semibold">{session.name}</h1>
          <section className="mt-12 flex flex-col gap-4">
            {options.map((option) => (
              <div key={option.market} data-testid="option-card">
                <SectionCard className="text-fs-text-secondary h-14 p-4 text-sm">{option.name}</SectionCard>
              </div>
            ))}
            <PredictCard session={session} status={status} marketEstimates={marketEstimates} />
            <SectionCard className="text-fs-text-secondary h-28 p-4 text-sm">Trade wallet</SectionCard>
          </section>
        </div>
      </main>
      <Dialog isOpen={isDialogOpen} onClose={() => {}} title="A dialog" hint="Open over the page.">
        <div className="h-40 w-72" />
      </Dialog>
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
