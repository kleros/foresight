import type { Metadata } from "next";

import { Unsubscribe } from "./_components/Unsubscribe";

export const metadata: Metadata = {
  title: { absolute: "Unsubscribe | Foresight" },
  robots: { index: false },
};

export default function UnsubscribePage() {
  return <Unsubscribe />;
}
