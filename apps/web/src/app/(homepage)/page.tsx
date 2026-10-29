import type { Metadata } from "next";

import { JsonLd } from "@/components/JsonLd";

import { pageMetadata, siteDescription, siteTitle, siteUrl } from "@/config/metadata";
import { siteConfig } from "@/config/site";

import { Hero } from "./_components/Hero";
import { Outro } from "./_components/Outro";
import { SessionBrowser } from "./_components/SessionBrowser";

export const metadata: Metadata = pageMetadata({ title: siteTitle, description: siteDescription, path: "/" });

const jsonLd = [
  { "@context": "https://schema.org", "@type": "WebSite", name: siteConfig.name, url: siteUrl.href },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Kleros",
    url: siteConfig.links.kleros,
    logo: new URL("/apple-icon.png", siteUrl).href,
    sameAs: [siteConfig.links.x, "https://github.com/kleros"],
  },
];

export default function HomePage() {
  return (
    <>
      <JsonLd data={jsonLd} />
      <Hero />
      <SessionBrowser />
      <Outro />
    </>
  );
}
