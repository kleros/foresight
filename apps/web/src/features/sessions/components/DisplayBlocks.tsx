import type { DisplayBlock } from "@foresight/session-metadata";

import { Markdown } from "@/components/ui/Markdown";

/** The creator's extra content: markdown passages and captioned images. */
export function DisplayBlocks({ blocks }: { blocks: DisplayBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {blocks.map((block, index) =>
        block.type === "markdown" ? (
          <div key={index} className="flex flex-col gap-1.5">
            {block.label ? <h4 className="text-fs-text-primary text-sm font-semibold">{block.label}</h4> : null}
            <Markdown>{block.body}</Markdown>
          </div>
        ) : (
          <figure key={index} className="flex flex-col gap-1.5">
            {/* The caption below carries the label, so the image stays silent to a screen reader. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- the gateway is env-configured, so no static remotePattern can cover it */}
            <img
              className="rounded-fs max-h-80 max-w-full self-start object-contain"
              src={block.url}
              alt=""
              loading="lazy"
            />
            <figcaption className="type-caption text-fs-text-secondary">{block.label}</figcaption>
          </figure>
        ),
      )}
    </div>
  );
}
