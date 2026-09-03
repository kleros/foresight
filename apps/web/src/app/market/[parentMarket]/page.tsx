import type { Metadata } from "next";

import { MarketPage } from "./_components/MarketPage";

export const metadata: Metadata = {
  title: "Session | Foresight",
  description: "Read what the market expects for each option, disagree, and back it.",
};

export default function Page({ params }: { params: { parentMarket: string } }) {
  return <MarketPage parentMarket={params.parentMarket} />;
}
