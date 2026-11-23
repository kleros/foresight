import { createRoot } from "react-dom/client";

import { SessionGrid } from "@/features/sessions/components/SessionGrid";
import type { SessionSummary } from "@/features/sessions/types";

import "@/styles/global.css";
import "../inter.css";

const params = new URLSearchParams(window.location.search);
/** `?winners=` the winning names, `|`-separated; with none the cards are still trading. */
const winners = params.get("winners")?.split("|");
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");

const session = (n: number): SessionSummary => ({
  id: String(n),
  parentMarket: `0x${String(n).padStart(40, "0")}`,
  deployer: "0x5555555555555555555555555555555555555555",
  name: params.get("title") ?? "Devcon 8: which talks fill the main stage",
  description: "Estimate how many people attend each talk. The result is the attendance count at the door.",
  iconUri: null,
  heroUri: null,
  closesAt: new Date("2026-11-01T12:00:00Z"),
  branchCount: 24,
  branchNoun: "Talks",
  keyword: "devcon",
  resolved: winners !== undefined,
  winningOptionNames: winners,
});

createRoot(document.getElementById("root")!).render(
  <div className="fs-page py-10">
    <div className="mx-auto w-full max-w-294">
      <SessionGrid sessions={[session(1), session(2), session(3)]} />
    </div>
  </div>,
);
