import type { Metadata } from "next";

import { pageMetadata } from "@/config/metadata";
import { paths } from "@/config/paths";

import { Settings } from "./_components/Settings";

export const metadata: Metadata = pageMetadata({
  title: "Settings | Foresight",
  description: "Your Foresight settings and email notifications.",
  path: paths.settings.getHref(),
});

export default function SettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  return <Settings defaultTab={searchParams.tab} />;
}
