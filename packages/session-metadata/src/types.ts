export const SCHEMA_VERSION = 1;

/**
 * Two parsers gate this union: the indexer refuses a document carrying a type it does not know,
 * and the web drops unknown blocks on read (features/sessions displayBlocks). A new member must reach both.
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
