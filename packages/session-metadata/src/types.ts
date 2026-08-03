export const SCHEMA_VERSION = 1;

/** Everything beyond name and colour is a block, and a v1 block is markdown. */
export type DisplayBlock = {
  type: "markdown";
  label?: string;
  body: string;
};

/** Display entry for one child market, keyed by its parent outcome index. */
export type ChildDisplay = {
  outcomeIndex: number;
  displayName: string;
  color: string;
  blocks: DisplayBlock[];
};

/** Session-level display fields. */
export type SessionDisplay = {
  title: string;
  description: string;
  heroImage: string;
  icon?: string;
  itemName: string;
  itemNamePlural: string;
  blocks: DisplayBlock[];
};

export type SessionMetadataDocument = {
  schemaVersion: typeof SCHEMA_VERSION;
  session: SessionDisplay;
  children: ChildDisplay[];
};
