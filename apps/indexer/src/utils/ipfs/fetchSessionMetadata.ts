import type { SessionMetadataDocument } from "@foresight/session-metadata";
import { S, createEffect } from "envio";

import { tryFetchIpfsFile } from ".";

const displayBlock = S.schema({
  type: "markdown" as const,
  label: S.optional(S.string),
  body: S.string,
});

const blocks = S.array(displayBlock);

const childOutput = S.schema({
  outcomeIndex: S.int32,
  displayName: S.string,
  color: S.string,
  blocks,
});

const sessionOutput = S.schema({
  title: S.string,
  description: S.string,
  heroImage: S.string,
  icon: S.optional(S.string),
  itemName: S.string,
  itemNamePlural: S.string,
  blocks,
});

const documentOutput = S.schema({
  schemaVersion: 1 as const,
  session: sessionOutput,
  children: S.array(childOutput),
});

const parseDocument = (document: unknown) => S.parseOrThrow(document, documentOutput);

/**
 * Compile-time drift guard: it fails if the schema's output stops satisfying
 * the shared document type.
 */
export const parseSessionMetadata: (document: unknown) => SessionMetadataDocument = parseDocument;

export const fetchSessionMetadata = createEffect(
  {
    name: "fetchSessionMetadata",
    input: { path: S.string },
    output: S.union([documentOutput, null]),
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    try {
      const document = await tryFetchIpfsFile(input.path, context);

      return parseDocument(document);
    } catch (error) {
      context.log.error(`Session metadata could not be resolved for ${input.path}: ${String(error)}`);

      return null;
    }
  },
);
