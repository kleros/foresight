import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { gnosis, hardhat } from "viem/chains";
import { describe, expect, it } from "vitest";

import { shortHash } from "@/utils/hash";

import { TxHashLink } from "../TxHashLink";

/**
 * A transaction is the only proof a deploy step happened, and the text is too
 * short to read one off: what the href points at and what a copy yields are the
 * whole value of this component.
 */

const HASH = `0x${"ab".repeat(32)}`;

/** The copy control sits inside a tooltip trigger that claims the role too. */
const copyControl = () => screen.getAllByRole("button").find((element) => element.tagName === "BUTTON")!;

describe("TxHashLink", () => {
  it("shows nothing at all without a hash", () => {
    const { container } = render(<TxHashLink chain={gnosis} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("points at the transaction on the chain's explorer", () => {
    render(<TxHashLink hash={HASH} chain={gnosis} />);

    const link = screen.getByRole("link", { name: shortHash(HASH) });
    expect(link).toHaveAttribute("href", `${gnosis.blockExplorers.default.url}/tx/${HASH}`);
    expect(link).toHaveAttribute("target", "_blank");
    // The shortened text hides the middle; hovering gives the whole thing.
    expect(link).toHaveAttribute("title", HASH);
  });

  // Locally there is no explorer, and a link to nowhere is worse than text.
  it("falls back to plain text on a chain with no explorer", () => {
    render(<TxHashLink hash={HASH} chain={hardhat} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(shortHash(HASH))).toBeInTheDocument();
  });

  it("offers no copy control unless asked", () => {
    render(<TxHashLink hash={HASH} chain={gnosis} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("copies the whole hash, which the text on screen does not carry", async () => {
    const user = userEvent.setup();
    render(<TxHashLink hash={HASH} chain={gnosis} copiable />);

    await user.click(copyControl());

    await expect(navigator.clipboard.readText()).resolves.toBe(HASH);
  });

  it("keeps the explorer link beside the copy control", () => {
    render(<TxHashLink hash={HASH} chain={gnosis} copiable />);

    expect(screen.getByRole("link", { name: shortHash(HASH) })).toHaveAttribute(
      "href",
      `${gnosis.blockExplorers.default.url}/tx/${HASH}`,
    );
  });
});
