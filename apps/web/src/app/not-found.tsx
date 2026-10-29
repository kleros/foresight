import type { Metadata } from "next";

import { PageMessage } from "@/components/layout/PageMessage";
import { Shell } from "@/components/layout/Shell";

export const metadata: Metadata = {
  title: { absolute: "Page not found | Foresight" },
  robots: { index: false },
};

export default function NotFound() {
  return (
    <Shell>
      <PageMessage title="Page not found" hint="There is nothing at this address." />
    </Shell>
  );
}
