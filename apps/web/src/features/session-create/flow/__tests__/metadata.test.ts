import { SCHEMA_VERSION } from "@foresight/session-metadata";
import { describe, expect, it } from "vitest";

import { buildSessionMetadata, MAX_BLOCK_CHARS, MAX_BLOCKS } from "../metadata";
import type { SessionMetadataInput } from "../types";

/**
 * The document this builds is uploaded once and its CID goes on chain, so it is
 * the last chance to get display data right. Every child must find an entry, or
 * a branch renders nameless and colourless forever.
 */

const base: SessionMetadataInput = {
  title: "Dune: Part Three, director",
  description: "Opening weekend gross per director.",
  itemName: "Director",
  itemNamePlural: "Directors",
  heroImage: "/ipfs/QmHero",
  icon: "/ipfs/QmIcon",
  children: [
    { outcomeIndex: 0, displayName: "Villeneuve", color: "#7e1bd4" },
    { outcomeIndex: 1, displayName: "Gerwig", color: "#009aff" },
  ],
};

describe("buildSessionMetadata", () => {
  it("stamps the schema version", () => {
    expect(buildSessionMetadata(base).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("carries the session display fields across", () => {
    const { session } = buildSessionMetadata(base);

    const { children: _children, ...display } = base;
    expect(session).toMatchObject(display);
  });

  it("omits the icon when there is none", () => {
    const { session } = buildSessionMetadata({ ...base, icon: undefined });

    expect("icon" in session).toBe(false);
  });

  it("writes one child entry per outcome, keyed by index", () => {
    expect(buildSessionMetadata(base).children).toEqual([
      { outcomeIndex: 0, displayName: "Villeneuve", color: "#7e1bd4", blocks: [] },
      { outcomeIndex: 1, displayName: "Gerwig", color: "#009aff", blocks: [] },
    ]);
  });

  it("turns each session section into a markdown block", () => {
    const { session } = buildSessionMetadata({ ...base, sections: ["Resolves from **Box Office Mojo**."] });

    expect(session.blocks).toEqual([{ type: "markdown", body: "Resolves from **Box Office Mojo**." }]);
  });

  it("keeps a branch's sections in the order they were given", () => {
    const { children } = buildSessionMetadata({
      ...base,
      children: [
        {
          outcomeIndex: 0,
          displayName: "Villeneuve",
          color: "#7e1bd4",
          sections: ["The incumbent.", "Directed one and two."],
        },
        { outcomeIndex: 1, displayName: "Gerwig", color: "#009aff" },
      ],
    });

    expect(children[0]?.blocks).toEqual([
      { type: "markdown", body: "The incumbent." },
      { type: "markdown", body: "Directed one and two." },
    ]);
  });

  it("labels no section", () => {
    const { session } = buildSessionMetadata({ ...base, sections: ["Anything."] });

    expect(session.blocks[0]).not.toHaveProperty("label");
  });

  it("drops blank sections", () => {
    const { session, children } = buildSessionMetadata({
      ...base,
      sections: ["   ", ""],
      children: [{ outcomeIndex: 0, displayName: "V", color: "#7e1bd4", sections: [""] }],
    });

    expect(session.blocks).toEqual([]);
    expect(children[0]?.blocks).toEqual([]);
  });

  it("sorts children by outcome index", () => {
    const { children } = buildSessionMetadata({
      ...base,
      children: [
        { outcomeIndex: 1, displayName: "Gerwig", color: "#009aff" },
        { outcomeIndex: 0, displayName: "Villeneuve", color: "#7e1bd4" },
      ],
    });

    expect(children.map((c) => c.displayName)).toEqual(["Villeneuve", "Gerwig"]);
  });

  it("accepts the short hex form", () => {
    const { children } = buildSessionMetadata({
      ...base,
      children: [{ outcomeIndex: 0, displayName: "V", color: "#f0a" }],
    });

    expect(children[0]?.color).toBe("#f0a");
  });

  it("refuses a gap in the outcome indices", () => {
    expect(() =>
      buildSessionMetadata({
        ...base,
        children: [
          { outcomeIndex: 0, displayName: "Villeneuve", color: "#7e1bd4" },
          { outcomeIndex: 2, displayName: "Gerwig", color: "#009aff" },
        ],
      }),
    ).toThrow(/no entry for outcome 2/i);
  });
});

/** `color` reaches a `style` attribute and `blocks` reach a markdown renderer. */
describe("buildSessionMetadata, bounds on what reaches a renderer", () => {
  const withColour = (color: string) => () =>
    buildSessionMetadata({ ...base, children: [{ outcomeIndex: 0, displayName: "V", color }] });

  it("refuses a colour carrying a second declaration", () => {
    expect(withColour("red; background-image: url(https://example.test/pixel)")).toThrow(/hex colour/i);
  });

  it("refuses a url as a colour", () => {
    expect(withColour("url(https://example.test/pixel)")).toThrow(/hex colour/i);
  });

  it("refuses a named colour", () => {
    expect(withColour("rebeccapurple")).toThrow(/hex colour/i);
  });

  it("refuses a section longer than the cap", () => {
    expect(() => buildSessionMetadata({ ...base, sections: ["x".repeat(MAX_BLOCK_CHARS + 1)] })).toThrow(
      new RegExp(String(MAX_BLOCK_CHARS)),
    );
  });

  it("accepts a section right at the cap", () => {
    expect(() => buildSessionMetadata({ ...base, sections: ["x".repeat(MAX_BLOCK_CHARS)] })).not.toThrow();
  });

  it("refuses more sections than the cap, counting after trimming", () => {
    const sections = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => `Section ${i}`);

    expect(() => buildSessionMetadata({ ...base, sections })).toThrow(new RegExp(`limit is ${MAX_BLOCKS}`));
    expect(() => buildSessionMetadata({ ...base, sections: [...sections.slice(0, MAX_BLOCKS), "   "] })).not.toThrow();
  });

  it("caps a branch section, naming the branch", () => {
    expect(() =>
      buildSessionMetadata({
        ...base,
        children: [
          { outcomeIndex: 0, displayName: "V", color: "#7e1bd4", sections: ["x".repeat(MAX_BLOCK_CHARS + 1)] },
        ],
      }),
    ).toThrow(/branch 1/i);
  });
});
