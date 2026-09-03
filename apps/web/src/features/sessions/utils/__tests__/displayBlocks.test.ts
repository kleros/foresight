import { describe, expect, it } from "vitest";

import { GATEWAY } from "@/testing/fixtures";

import { displayBlocks } from "../displayBlocks";

const markdown = { type: "markdown", label: "Synopsis", body: "**Arrakis**, again." };
const image = { type: "image", label: "Poster", url: "ipfs://QmPoster" };

describe("displayBlocks", () => {
  it("keeps well-formed blocks in their written order", () => {
    expect(displayBlocks([markdown, image], GATEWAY)).toEqual([markdown, { ...image, url: `${GATEWAY}/QmPoster` }]);
  });

  it("accepts a markdown block without a label", () => {
    expect(displayBlocks([{ type: "markdown", body: "plain" }], GATEWAY)).toEqual([
      { type: "markdown", body: "plain" },
    ]);
  });

  it("returns nothing where the column holds no list", () => {
    expect(displayBlocks(null, GATEWAY)).toEqual([]);
    expect(displayBlocks(undefined, GATEWAY)).toEqual([]);
    expect(displayBlocks("markdown", GATEWAY)).toEqual([]);
    expect(displayBlocks(markdown, GATEWAY)).toEqual([]);
  });

  it("drops an entry whose type it does not know, keeping the rest", () => {
    expect(displayBlocks([{ type: "video", url: "ipfs://QmClip" }, markdown], GATEWAY)).toEqual([markdown]);
  });

  it("drops a markdown block whose body is not text", () => {
    expect(displayBlocks([{ type: "markdown", body: 42 }, markdown], GATEWAY)).toEqual([markdown]);
  });

  it("drops a markdown block whose label is not text", () => {
    expect(displayBlocks([{ type: "markdown", label: 7, body: "plain" }], GATEWAY)).toEqual([]);
  });

  it("drops an image block missing its label or url", () => {
    expect(displayBlocks([{ type: "image", url: "ipfs://QmPoster" }], GATEWAY)).toEqual([]);
    expect(displayBlocks([{ type: "image", label: "Poster" }], GATEWAY)).toEqual([]);
  });

  it("drops an image whose uri the gateway refuses", () => {
    expect(displayBlocks([{ type: "image", label: "Poster", url: "javascript:alert(1)" }, markdown], GATEWAY)).toEqual([
      markdown,
    ]);
  });
});
