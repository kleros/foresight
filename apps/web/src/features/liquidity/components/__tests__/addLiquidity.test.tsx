import type { ReactNode } from "react";

import { Button } from "@kleros/ui-components-library";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LiquidityRun } from "../../hooks/useLiquidityRun";
import type { ShownPosition } from "../../hooks/useSessionLiquidity";
import { removeInput, SESSION } from "../../run/__tests__/support/requests";
import { LiquidityBanner } from "../LiquidityBanner";
import { LiquiditySection } from "../LiquiditySection";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const WAD = 10n ** 18n;
const NAMES = ["Denis Villeneuve", "Greta Gerwig"];

const IDLE_RUN: LiquidityRun = {
  progress: { stage: "idle", rows: [], signatures: { done: 0, total: 0 } },
  start: () => {},
  resume: () => {},
  retry: () => {},
  reset: () => {},
  discard: () => {},
  isRunning: false,
  isHeld: false,
};

const POSITION: ShownPosition = {
  key: "78",
  pool: `${NAMES[0]} UP pool`,
  count: 2,
  returns: [{ label: "sDAI", amount: WAD }],
  request: { kind: "remove", session: SESSION, input: removeInput() },
};

const wrap = (children: ReactNode) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

const section = (props: { closed?: boolean; reason?: string } = {}) =>
  wrap(<LiquiditySection {...props} onAdd={() => {}} names={NAMES} positions={[POSITION]} run={IDLE_RUN} />);

/** The class list the kleros secondary Button draws with the same props, which carries no gradient fill. */
function secondaryClass(props: { small?: boolean; isDisabled?: boolean }): string {
  const { container, unmount } = render(<Button text="Add liquidity" variant="secondary" {...props} />);
  const className = container.querySelector("button")!.className;
  unmount();
  return className;
}

describe("the Liquidity section after the session's close", () => {
  it("holds only the heading, the positions line and Your positions", () => {
    render(section({ closed: true }));

    const liquidity = screen.getByRole("region", { name: "Liquidity" });
    expect(
      within(liquidity)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Your positions"]);
    expect(liquidity).toHaveTextContent(/^Liquidity2 positions in this session\.Your positions$/);
  });
});

describe("Add liquidity", () => {
  it("is the kleros secondary button in the banner, with no class added over it", () => {
    render(<LiquidityBanner onAdd={() => {}} />);

    expect(screen.getByRole("button", { name: "Add liquidity" }).className).toBe(secondaryClass({}));
  });

  it("is the small kleros secondary button in the section, with no class added over it", () => {
    render(section());

    expect(screen.getByRole("button", { name: "Add liquidity" }).className).toBe(secondaryClass({ small: true }));
  });

  it("stays the plain secondary button while it is disabled with a reason", () => {
    render(section({ reason: "The session is still being set up." }));

    expect(screen.getByRole("button", { name: "Add liquidity" }).className).toBe(
      secondaryClass({ small: true, isDisabled: true }),
    );
  });
});
