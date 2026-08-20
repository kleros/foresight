import type { Metadata } from "next";

import { Hero } from "./_components/Hero";
import { Outro } from "./_components/Outro";
import { SessionBrowser } from "./_components/SessionBrowser";

export const metadata: Metadata = {
  title: "Sessions | Foresight",
  description: "Browse open decision markets and their branches.",
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <SessionBrowser />
      <Outro />
    </>
  );
}
