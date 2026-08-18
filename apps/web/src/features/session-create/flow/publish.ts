import type { SessionMetadataDocument } from "@foresight/session-metadata";

import type { MetadataUploader } from "@/lib/atlas/types";

import { buildSessionMetadata } from "./metadata";
import type { SessionMetadataInput } from "./types";

/**
 * Puts the display metadata on IPFS and proves it is there before any gas is
 * spent.
 */

/** A file to upload, or a uri for something already on IPFS (a resumed deploy). */
export type ImageSource = File | string;

type PublishStage = "images" | "document" | "verifying";

export const READ_BACK_ATTEMPTS = 5;
const READ_BACK_BASE_MS = 1_000;

/**
 * Doubling: 1s, 2s, 4s, 8s. A gateway that has not seen a just-uploaded CID
 * usually catches up in seconds, but not always, and giving up early means
 * refusing a deploy over a document that was going to resolve. The suite holds
 * these to a minimum window, so retune them freely above it.
 */
const backoffMs = (retry: number) => READ_BACK_BASE_MS * 2 ** (retry - 1);

const isUploaded = (image: ImageSource): image is string => typeof image === "string";

export async function publishSessionMetadata(args: {
  uploader: MetadataUploader;
  images: { hero: ImageSource; icon?: ImageSource };
  metadata: Omit<SessionMetadataInput, "heroImage" | "icon">;
  onProgress?: (stage: PublishStage) => void;
  /** How many times to ask the gateway before giving up. */
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ uri: string; document: SessionMetadataDocument }> {
  const { uploader, images, metadata, onProgress } = args;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const attempts = Math.max(1, args.attempts ?? READ_BACK_ATTEMPTS);

  onProgress?.("images");
  const put = async (image: ImageSource) => (isUploaded(image) ? image : uploader.uploadFile(image));
  const heroImage = await put(images.hero);
  const icon = images.icon ? await put(images.icon) : undefined;

  onProgress?.("document");
  const document = buildSessionMetadata({ ...metadata, heroImage, icon });
  const uri = await uploader.uploadJson("session-metadata.json", document);

  onProgress?.("verifying");
  let readBack: unknown;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(backoffMs(attempt - 1));
    try {
      readBack = await uploader.readJson(uri);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError !== undefined) {
    throw new Error(
      `The session details could not be read back after ${attempts} attempts ` +
        `(${lastError instanceof Error ? lastError.message : String(lastError)}).`,
    );
  }

  // Compared as JSON rather than field by field: the point is that what a
  // reader will fetch is byte-identical to what was built here.
  if (JSON.stringify(readBack) !== JSON.stringify(document)) {
    throw new Error("The session details read back do not match what was uploaded.");
  }

  return { uri, document };
}
