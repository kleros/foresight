import type { Metadata } from "next";

import { HomeScreen } from "@/features/home/HomeScreen";

export const metadata: Metadata = {
  title: "Sessions | Foresight",
  description: "Browse open decision markets and their branches.",
};

export default function HomePage() {
  return <HomeScreen />;
}
