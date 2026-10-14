import type { ReactNode } from "react";

import { Modal } from "@kleros/ui-components-library";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { hardhat } from "viem/chains";
import { describe, expect, it, vi } from "vitest";
import { createConfig, http, WagmiProvider } from "wagmi";

import { DevWallet } from "../DevWallet";

/* The app's AppKit config is never read here: the panel only connects on a click. */
vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));

const config = createConfig({ chains: [hardhat], transports: { [hardhat.id]: http() } });

function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

/** The z-index of the outermost ancestor-or-self carrying Tailwind's `z-N`, the one that orders it among page layers. */
function layerOf(element: Element): number {
  let layer = Number.NaN;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const match = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(node.getAttribute("class") ?? "");
    if (match) layer = Number(match[1]);
  }
  return layer;
}

describe("DevWallet", () => {
  it("sits below an open modal", () => {
    render(
      <Providers>
        <DevWallet />
        <Modal isOpen ariaLabel="Predict">
          <button type="button">Cancel</button>
        </Modal>
      </Providers>,
    );

    const panel = layerOf(screen.getByRole("complementary", { name: "Development wallet", hidden: true }));
    const modal = layerOf(screen.getByRole("dialog", { name: "Predict" }));

    expect(panel).toBeLessThan(modal);
  });
});
