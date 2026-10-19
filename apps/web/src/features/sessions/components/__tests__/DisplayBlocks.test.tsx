import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DisplayBlocks } from "../DisplayBlocks";

describe("DisplayBlocks", () => {
  it("drops an image block and its caption when the image fails to load", () => {
    render(
      <DisplayBlocks blocks={[{ type: "image", url: "https://gateway.example/ipfs/QmPoster", label: "The poster" }]} />,
    );

    fireEvent.error(screen.getByRole("presentation", { hidden: true }));

    expect(screen.queryByText("The poster")).toBeNull();
  });
});
