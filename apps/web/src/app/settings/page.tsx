import type { Metadata } from "next";

import { SettingsScreen } from "@/features/settings";

export const metadata: Metadata = {
  title: "Settings | Foresight",
};

export default function SettingsPage() {
  return <SettingsScreen />;
}
