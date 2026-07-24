import type { Metadata } from "next";

import { Unsubscribe } from "./_components/Unsubscribe";

export const metadata: Metadata = {
  title: "Unsubscribe | Foresight",
};

export default function UnsubscribePage() {
  return <Unsubscribe />;
}
