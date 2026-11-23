import { createRoot } from "react-dom/client";

import { SessionCard } from "@/features/sessions/components/SessionCard";
import type { SessionSummary } from "@/features/sessions/types";

import "@/styles/global.css";
import "../inter.css";

const params = new URLSearchParams(window.location.search);
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");

/** `?winners=` the resolved card's winning names, `|`-separated; `?title=` its name; `?icon` gives it an icon. */
const session: SessionSummary = {
  id: "1",
  parentMarket: "0x7777777777777777777777777777777777777777",
  deployer: "0x8888888888888888888888888888888888888888",
  name: params.get("title") ?? "Devcon talks",
  description: "Which talks at Devcon would change minds the most? Trade on each talk's expected attendance score.",
  iconUri: params.has("icon")
    ? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%237e1bd4'/%3E%3C/svg%3E"
    : null,
  heroUri: null,
  closesAt: new Date("2025-09-03T12:00:00Z"),
  branchCount: 4,
  branchNoun: "Talks",
  keyword: "devcon talks",
  resolved: true,
  winningOptionNames: (params.get("winners") ?? "Scaling with blobs").split("|"),
};

/** The homepage's column and grid, so the card takes a homepage card's width. */
function Harness() {
  return (
    <main className="fs-page py-10">
      <div className="mx-auto w-full max-w-294">
        <div className="fs-session-grid">
          <SessionCard session={session} />
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
