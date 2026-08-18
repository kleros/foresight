import type { ReactNode } from "react";

import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";

export function Shell({ children, walletSlot }: { children: ReactNode; walletSlot?: ReactNode }) {
  return (
    <>
      <Header walletSlot={walletSlot} />
      <main className="fs-page flex-1 py-10">{children}</main>
      <Footer />
    </>
  );
}
