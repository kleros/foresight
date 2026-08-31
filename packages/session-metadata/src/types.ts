export const SCHEMA_VERSION = 1;

/**
 * The indexer's parser refuses a type it does not know, so a new member here must reach it first.
 */
export type DisplayBlock =
  | {
      type: "markdown";
      label?: string;
      body: string;
    }
  | {
      type: "image";
      label: string;
      /** An ipfs uri or a gateway path. */
      url: string;
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
