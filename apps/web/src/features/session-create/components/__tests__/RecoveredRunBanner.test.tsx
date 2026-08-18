import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DeployResume, SessionDeployDriver } from "../../deploy/types";
import { RecoveredRunBanner } from "../RecoveredRunBanner";

// The chain gate reads a wagmi provider this suite has no use for; what it
// guards is covered where the wallet is, in e2e.
vi.mock("@/components/wallet/EnsureChain", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const HASH = `0x${"e1".repeat(32)}`;

const resumeOf = (over: Partial<DeployResume> = {}): DeployResume => ({
  stepId: "parent",
  label: "Create the decision market",
  outcome: "none",
  canSelfCheck: true,
  ...over,
});

/** The banner only ever tells the driver things, so recording the calls is enough. */
function stubDriver(): SessionDeployDriver {
  return {
    start: vi.fn(),
    recover: vi.fn(),
    continueRecovered: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    getProgress: () => {
      throw new Error("The banner renders from its `resume` prop, never from the driver.");
    },
    subscribe: () => () => {},
  };
}

const WARNING = /if you already signed this, continuing pays for it twice/;

describe("RecoveredRunBanner", () => {
  it("names the step it stopped at", () => {
    render(<RecoveredRunBanner resume={resumeOf()} driver={stubDriver()} />);

    expect(screen.getByText(/It stopped at create the decision market\./)).toBeInTheDocument();
  });

  it("says a step that landed went through, however that was found out", () => {
    // The wallet stopped reporting, and it turned up on chain anyway.
    render(<RecoveredRunBanner resume={resumeOf({ outcome: "unknown", hash: HASH })} driver={stubDriver()} />);

    expect(screen.getByText(/It went through while you were away\./)).toBeInTheDocument();
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it("warns about paying twice only when nothing can tell whether it was signed", () => {
    render(<RecoveredRunBanner resume={resumeOf({ outcome: "unknown", canSelfCheck: false })} driver={stubDriver()} />);

    expect(screen.getByText(WARNING)).toBeInTheDocument();
  });

  it("drops the warning once the step is known to have landed", () => {
    const landed = resumeOf({ outcome: "unknown", canSelfCheck: false, hash: HASH });

    render(<RecoveredRunBanner resume={landed} driver={stubDriver()} />);

    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it("discards the deploy without undoing what exists", async () => {
    const driver = stubDriver();
    const user = userEvent.setup();
    render(<RecoveredRunBanner resume={resumeOf()} driver={driver} />);

    await user.click(screen.getByRole("button", { name: "Discard it" }));

    expect(driver.reset).toHaveBeenCalled();
    expect(screen.getByText("Discarding undoes nothing already created.")).toBeInTheDocument();
  });
});
