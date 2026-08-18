import type { SessionMetadataDocument } from "./types";

/**
 * Example document, themed to match the sample sessions deployed by the contracts
 * `simulate-session` task (Movie A-D). Four children cover every outcome count the
 * task supports, so each deployed child market finds its display entry.
 *
 * mock-atlas seeds this document on its IPFS gateway at boot, see
 * `EXAMPLE_METADATA_CID` in ./index.ts.
 */
export const EXAMPLE_METADATA: SessionMetadataDocument = {
  schemaVersion: 1,
  session: {
    title: "Distilled Scooby's Judgement",
    description: "Which movies will Scooby watch, and what percentile score does each one get if he does?",
    heroImage: "ipfs://bafybeigd7cvhmnq4scooby0hero000000000000000000000000000000/hero.jpg",
    icon: "ipfs://bafybeigd7cvhmnq4scooby0icon000000000000000000000000000000/icon.png",
    itemName: "Movie",
    itemNamePlural: "Movies",
    blocks: [
      {
        type: "markdown",
        label: "Resolution",
        body: "Each child market resolves to the percentile score **Scooby** assigns after watching.",
      },
    ],
  },
  children: [
    {
      outcomeIndex: 0,
      displayName: "Movie A",
      color: "#7e1bd4",
      blocks: [{ type: "markdown", body: "The art-house pick." }],
    },
    { outcomeIndex: 1, displayName: "Movie B", color: "#009aff", blocks: [] },
    { outcomeIndex: 2, displayName: "Movie C", color: "#00c42b", blocks: [] },
    { outcomeIndex: 3, displayName: "Movie D", color: "#ff9900", blocks: [] },
  ],
};
