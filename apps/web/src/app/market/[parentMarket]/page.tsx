import type { Metadata } from "next";

import { getSessionMetadata } from "@/features/sessions/api/getSessionMetadata";

import { JsonLd } from "@/components/JsonLd";

import { MarketPage } from "./_components/MarketPage";
import { generateSessionMetadata, sessionJsonLd } from "./sessionMetadata";

type Props = { params: { parentMarket: string } };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return generateSessionMetadata(params.parentMarket);
}

export default async function Page({ params }: Props) {
  const jsonLd = sessionJsonLd(params.parentMarket, await getSessionMetadata(params.parentMarket));
  return (
    <>
      {jsonLd && <JsonLd data={jsonLd} />}
      <MarketPage parentMarket={params.parentMarket} />
    </>
  );
}
