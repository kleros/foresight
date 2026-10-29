import type { Metadata } from "next";

import { getSessionMetadata, type SessionMetadataResult } from "@/features/sessions/api/getSessionMetadata";

import { pageMetadata, siteUrl } from "@/config/metadata";
import { paths } from "@/config/paths";
import { siteConfig } from "@/config/site";

const FALLBACK_DESCRIPTION = "Read what the market expects for each option, disagree, and back it.";
/** Google truncates snippets near this length. */
const DESCRIPTION_LIMIT = 160;

export function summarize(text: string | null): string {
  const flat = text?.replace(/\s+/g, " ").trim();
  if (!flat) return FALLBACK_DESCRIPTION;
  return flat.length > DESCRIPTION_LIMIT ? `${flat.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…` : flat;
}

export function toSessionPageMetadata(parentMarket: string, result: SessionMetadataResult): Metadata {
  const path = paths.market.getHref(parentMarket.toLowerCase());
  if (result.status === "missing") {
    return { title: { absolute: `Session not found | ${siteConfig.name}` }, robots: { index: false } };
  }
  if (result.status === "unavailable") {
    return pageMetadata({ title: `Session | ${siteConfig.name}`, description: FALLBACK_DESCRIPTION, path });
  }
  const { session } = result;
  return pageMetadata({
    title: `${session.name} | ${siteConfig.name}`,
    description: summarize(session.description),
    path,
    image: session.heroUri ?? session.iconUri ?? undefined,
  });
}

export async function generateSessionMetadata(parentMarket: string): Promise<Metadata> {
  return toSessionPageMetadata(parentMarket, await getSessionMetadata(parentMarket));
}

/** WebPage plus a Home → session breadcrumb; there is no richer schema.org type a market fits honestly. */
export function sessionJsonLd(parentMarket: string, result: SessionMetadataResult) {
  if (result.status !== "found") return null;
  const url = new URL(paths.market.getHref(parentMarket.toLowerCase()), siteUrl).href;
  const { name, description } = result.session;
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name,
      description: summarize(description),
      url,
      isPartOf: { "@type": "WebSite", name: siteConfig.name, url: siteUrl.href },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Sessions", item: siteUrl.href },
        { "@type": "ListItem", position: 2, name, item: url },
      ],
    },
  ];
}
