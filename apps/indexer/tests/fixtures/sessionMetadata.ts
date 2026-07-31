export const SESSION_METADATA = {
  schemaVersion: 1,
  chainId: 100,
  session: {
    title: "Dune: Part Three — Director Decision",
    description: "If hired, what worldwide opening-weekend box office would the director deliver?",
    heroImage: "ipfs://bafybeigd7cvhmnq4dune3hero/hero.jpg",
    icon: "ipfs://bafybeigd7cvhmnq4legendary0icon/icon.png",
    itemName: "Director",
    itemNamePlural: "Directors",
    blocks: [
      {
        type: "markdown",
        label: "Resolution",
        body: "Resolves from **Box Office Mojo** worldwide opening-weekend gross.",
      },
    ],
  },
  children: [
    {
      outcomeIndex: 0,
      displayName: "Denis Villeneuve",
      color: "#7e1bd4",
      // everything beyond name and colour is a block, and a v1 block is markdown
      blocks: [{ type: "markdown", body: "Director of Parts One and Two. Continuity with the visual language." }],
    },
    {
      outcomeIndex: 1,
      displayName: "Greta Gerwig",
      color: "#009aff",
      blocks: [],
    },
  ],
} as const;

export const METADATA_CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
export const METADATA_URI = `ipfs://${METADATA_CID}`;

export const [FIRST_CHILD, SECOND_CHILD] = SESSION_METADATA.children;
