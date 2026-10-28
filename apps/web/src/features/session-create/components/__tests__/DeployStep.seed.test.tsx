import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { paths } from "@/config/paths";

import { draftAssessment } from "../../__tests__/support/drafts";
import type { SessionDeployDriver, SessionDeployProgress } from "../../deploy/types";
import { batchCount, deployMode } from "../../flow/params";
import { useDraftStore } from "../../stores/draftStore";
import { DeployStep } from "../DeployStep";

const PARENT_MARKET = `0x${"b0".repeat(20)}`;

const OUTCOMES = 2;

function stubDriver(): SessionDeployDriver {
  return {
    start: vi.fn(),
    recover: vi.fn(),
    continueRecovered: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    getProgress: () => deployed(""),
    subscribe: () => () => {},
  };
}

const deployed = (parentMarket: string): SessionDeployProgress => ({
  stage: "complete",
  mode: deployMode(OUTCOMES),
  batch: 1,
  batches: batchCount(OUTCOMES),
  parent: { state: "success" },
  children: Array.from({ length: OUTCOMES }, () => ({ state: "success" as const })),
  batchSteps: [],
  parentMarket,
});

function renderDeployed(parentMarket: string) {
  const store = () => useDraftStore.getState();
  store().resetDraft();
  while (store().draft.outcomes.length < OUTCOMES) store().addOutcome();
  return render(
    <DeployStep
      assessment={draftAssessment()}
      active
      walletConnected
      walletSlot={null}
      signedIn
      signInSlot={null}
      progress={deployed(parentMarket)}
      driver={stubDriver()}
      gateway="https://gateway.test/ipfs"
    />,
  );
}

const seedLink = () => screen.getByRole("link", { name: "Seed liquidity" });

beforeEach(() => {
  localStorage.clear();
});

describe("DeployStep's Seed liquidity", () => {
  it("is a link once the session is deployed, not a disabled button", () => {
    renderDeployed(PARENT_MARKET);

    expect(screen.getByRole("link", { name: "Seed liquidity" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Seed liquidity" })).toBeNull();
  });

  it("links to the deployed session's market page, carrying the popup's opening in its query or hash", () => {
    renderDeployed(PARENT_MARKET);

    const href = new URL(seedLink().getAttribute("href") ?? "", "http://localhost");
    expect(href.pathname.toLowerCase()).toBe(paths.market.getHref(PARENT_MARKET).toLowerCase());
    expect(href.search.length + href.hash.length).toBeGreaterThan(0);
  });
});
