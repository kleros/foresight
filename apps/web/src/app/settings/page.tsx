import type { Metadata } from "next";

import { Settings } from "./_components/Settings";

export const metadata: Metadata = {
  title: "Settings | Foresight",
};

export default function SettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  return <Settings defaultTab={searchParams.tab} />;
}
