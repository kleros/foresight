import {
  SCHEMA_VERSION,
  type ChildDisplay,
  type DisplayBlock,
  type SessionMetadataDocument,
} from "@foresight/session-metadata";

import type { SessionMetadataInput } from "./types";

const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function requireColour(colour: string, outcomeIndex: number): string {
  if (!HEX_COLOUR.test(colour)) {
    throw new Error(`Branch ${outcomeIndex + 1} has "${colour}" as its colour. It has to be a hex colour.`);
  }
  return colour;
}

export const MAX_BLOCK_CHARS = 25_000;
export const MAX_BLOCKS = 20;

/** Whitespace-only markdown is nothing, not an empty block. */
function blocks(sections: string[] = [], what: string): DisplayBlock[] {
  const bodies = sections.map((body) => body.trim()).filter(Boolean);

  if (bodies.length > MAX_BLOCKS) {
    throw new Error(`${what} has ${bodies.length} sections. The limit is ${MAX_BLOCKS}.`);
  }
  const oversized = bodies.findIndex((body) => body.length > MAX_BLOCK_CHARS);
  if (oversized !== -1) {
    throw new Error(
      `Section ${oversized + 1} of ${what} is ${bodies[oversized]?.length} characters. ` +
        `The limit is ${MAX_BLOCK_CHARS}.`,
    );
  }

  return bodies.map((body) => ({ type: "markdown", body }));
}

export function buildSessionMetadata(input: SessionMetadataInput): SessionMetadataDocument {
  const children = [...input.children].sort((a, b) => a.outcomeIndex - b.outcomeIndex);

  children.forEach((child, position) => {
    if (child.outcomeIndex !== position) {
      throw new Error(`The display metadata has no entry for outcome ${position + 1}.`);
    }
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    session: {
      title: input.title,
      description: input.description,
      heroImage: input.heroImage,
      // Omitted rather than empty: the field is optional in the schema.
      ...(input.icon ? { icon: input.icon } : {}),
      itemName: input.itemName,
      itemNamePlural: input.itemNamePlural,
      blocks: blocks(input.sections, "the session"),
    },
    children: children.map((child): ChildDisplay => ({
      outcomeIndex: child.outcomeIndex,
      displayName: child.displayName,
      color: requireColour(child.color, child.outcomeIndex),
      blocks: blocks(child.sections, `branch ${child.outcomeIndex + 1}`),
    })),
  };
}
