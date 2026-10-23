import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { downloadTextFile } from "@/utils/download";

import { addresses } from "@/testing/fixtures";
import type { OptionScale } from "@/types/optionScale";

import { useEstimateStore } from "../../stores/estimateStore";
import { EstimateActions } from "../EstimateActions";

vi.mock("@/utils/download", () => ({ downloadTextFile: vi.fn() }));

const PARENT = addresses.parentMarket;
const [FIRST, SECOND] = addresses.childMarkets;

const scales: OptionScale[] = [
  { market: FIRST, name: "Villeneuve", color: "#009aff", unit: "$M", lowerBound: 0, upperBound: 500 },
  { market: SECOND, name: "Gerwig", color: "#ff0000", unit: "$M", lowerBound: 0, upperBound: 500 },
];
const marketEstimates = { [FIRST]: 312, [SECOND]: 280 };

const renderActions = () =>
  render(<EstimateActions parentMarket={PARENT} scales={scales} marketEstimates={marketEstimates} />);

beforeEach(() => {
  useEstimateStore.setState({ estimates: {} });
  vi.mocked(downloadTextFile).mockReset();
});

describe("EstimateActions", () => {
  it("shows nothing while no estimate differs from the market", () => {
    useEstimateStore.getState().setEstimate(PARENT, FIRST, 312);

    const { container } = renderActions();

    expect(container).toBeEmptyDOMElement();
  });

  it("resets this session's estimates and leaves other sessions alone", async () => {
    useEstimateStore.getState().setEstimate(PARENT, FIRST, 250);
    useEstimateStore.getState().setEstimate(addresses.deployer, FIRST, 250);
    renderActions();

    await userEvent.click(screen.getByRole("button", { name: "Reset estimates" }));

    expect(useEstimateStore.getState().estimates).toEqual({ [addresses.deployer]: { [FIRST]: 250 } });
    expect(screen.queryByRole("button", { name: "Reset estimates" })).toBeNull();
  });

  it("cannot reset once the session has stopped trading", () => {
    useEstimateStore.getState().setEstimate(PARENT, FIRST, 250);
    render(<EstimateActions parentMarket={PARENT} scales={scales} marketEstimates={marketEstimates} isDisabled />);

    expect(screen.getByRole("button", { name: "Reset estimates" })).toBeDisabled();
  });

  it("exports the set estimates as a CSV stamped with the local date and time", async () => {
    useEstimateStore.getState().setEstimate(PARENT, SECOND, 300);
    useEstimateStore.getState().setEstimate(PARENT, FIRST, 250);
    renderActions();

    await userEvent.click(screen.getByRole("button", { name: "Export estimates" }));

    expect(downloadTextFile).toHaveBeenCalledWith(
      expect.stringMatching(/^estimates-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.csv$/),
      "\uFEFFname,estimate\nVilleneuve,250\nGerwig,300",
      "text/csv",
    );
  });
});
