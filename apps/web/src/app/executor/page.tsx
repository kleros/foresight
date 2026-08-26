import type { Metadata } from "next";

import { ExecutorDashboard } from "./_components/ExecutorDashboard";

export const metadata: Metadata = {
  title: "Trade executor | Foresight",
  description: "Set up and fund the wallet that places your trades.",
};

export default function ExecutorPage() {
  return <ExecutorDashboard />;
}
