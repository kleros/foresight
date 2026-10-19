import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { downloadTextFile } from "@/utils/download";
import { successToast } from "@/utils/toast";

import { addresses } from "@/testing/fixtures";
import type { OptionScale } from "@/types/optionScale";

import { useEstimateStore } from "../../stores/estimateStore";
import { EstimateCsvDialog } from "../EstimateCsvDialog";

vi.mock("@/utils/download", () => ({ downloadTextFile: vi.fn() }));
vi.mock("@/utils/toast", () => ({ successToast: vi.fn() }));

const PARENT = addresses.parentMarket;
const [FIRST, SECOND] = addresses.childMarkets;

const scales: OptionScale[] = [
  { market: FIRST, name: "Villeneuve", color: "#009aff", unit: "$M", lowerBound: 0, upperBound: 500 },
  { market: SECOND, name: "Gerwig", color: "#ff0000", unit: "$M", lowerBound: 0, upperBound: 500 },
];
const marketEstimates = { [FIRST]: 312, [SECOND]: 280 };

const csvFile = (text: string) => new File([text], "estimates.csv", { type: "text/csv" });

async function openDialog() {
  render(
    <EstimateCsvDialog parentMarket={PARENT} scales={scales} marketEstimates={marketEstimates} noun="directors" />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Upload estimates (CSV)" }));
}

/** react-aria's file trigger hides its input; the upload goes straight to it. */
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;

beforeEach(() => {
  useEstimateStore.setState({ estimates: {} });
  vi.mocked(downloadTextFile).mockReset();
  vi.mocked(successToast).mockReset();
});

describe("EstimateCsvDialog", () => {
  it("loads every row into the session's estimates and closes", async () => {
    await openDialog();

    await userEvent.upload(fileInput(), csvFile("name,estimate\nVilleneuve,250\nGerwig,300"));
    await userEvent.click(screen.getByRole("button", { name: "Load estimates" }));

    expect(useEstimateStore.getState().estimates[PARENT]).toEqual({ [FIRST]: 250, [SECOND]: 300 });
    expect(successToast).toHaveBeenCalledWith("Estimates loaded.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("treats a row at the market's own number as no estimate", async () => {
    useEstimateStore.getState().setEstimate(PARENT, FIRST, 250);
    await openDialog();

    await userEvent.upload(fileInput(), csvFile("name,estimate\nVilleneuve,312\nGerwig,300"));
    await userEvent.click(screen.getByRole("button", { name: "Load estimates" }));

    expect(useEstimateStore.getState().estimates[PARENT]).toEqual({ [SECOND]: 300 });
  });

  it("refuses a bad file, names the row, and keeps the dialog open with nothing loaded", async () => {
    await openDialog();

    await userEvent.upload(fileInput(), csvFile("name,estimate\nVilleneuve,250\nNolan,250"));
    await userEvent.click(screen.getByRole("button", { name: "Load estimates" }));

    expect(screen.getByText('Row 3: there is no option named "Nolan".')).toBeInTheDocument();
    expect(useEstimateStore.getState().estimates).toEqual({});
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers a template with every option at your estimate where set and the market's otherwise", async () => {
    useEstimateStore.getState().setEstimate(PARENT, FIRST, 250);
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Download CSV template" }));

    expect(downloadTextFile).toHaveBeenCalledWith(
      "estimates-template.csv",
      "name,estimate\nVilleneuve,250\nGerwig,280",
      "text/csv",
    );
  });

  it("cannot load before a file is chosen", async () => {
    await openDialog();

    expect(screen.getByRole("button", { name: "Load estimates" })).toBeDisabled();
  });
});
