import type { SessionMetadataDocument } from "@foresight/session-metadata";

import type { MetadataUploader } from "@/lib/atlas/types";

import { buildSessionMetadata } from "./metadata";
import type { ChildMetadataInput, GalleryImage, SessionMetadataInput } from "./types";

/**
 * Puts the display metadata on IPFS and proves it is there before any gas is
 * spent.
 */

/** A file to upload, or a uri for something already on IPFS (a resumed deploy). */
export type ImageSource = File | string;

export type GalleryImageSource = {
  outcomeIndex: number;
  label: string;
  source: ImageSource;
};

/** The metadata before its uploads: image locations exist only once this runs. */
export type UnpublishedMetadata = Omit<SessionMetadataInput, "heroImage" | "icon" | "children"> & {
  children: Array<Omit<ChildMetadataInput, "gallery">>;
};

type PublishStage = "images" | "document" | "verifying";

/** Images uploaded so far in this publish, of all it has to put up. */
export type ImageCount = { done: number; total: number };

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
  images: { hero: ImageSource; icon?: ImageSource; gallery?: GalleryImageSource[] };
  metadata: UnpublishedMetadata;
  onProgress?: (stage: PublishStage, images?: ImageCount) => void;
  /** How many times to ask the gateway before giving up. */
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ uri: string; document: SessionMetadataDocument }> {
  const { uploader, images, metadata, onProgress } = args;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const attempts = Math.max(1, args.attempts ?? READ_BACK_ATTEMPTS);

  const count: ImageCount = { done: 0, total: 1 + (images.icon ? 1 : 0) + (images.gallery?.length ?? 0) };
  onProgress?.("images", { ...count });
  // A uri carried over from an earlier attempt has no bytes to fall back on, so a
  // dead one has to stop the deploy here rather than go into the document.
  const putOne = async (image: ImageSource, what: string) => {
    if (!isUploaded(image)) return uploader.uploadFile(image);
    if (!(await uploader.isServed(image))) {
      throw new Error(`The ${what} uploaded earlier can no longer be found. Add it again and redeploy.`);
    }
    return image;
  };
  const put = async (image: ImageSource, what: string) => {
    const uri = await putOne(image, what);
    count.done += 1;
    onProgress?.("images", { ...count });
    return uri;
  };
  const heroImage = await put(images.hero, "hero image");
  const icon = images.icon ? await put(images.icon, "icon") : undefined;
  const uploaded: Array<GalleryImage & { outcomeIndex: number }> = [];
  for (const image of images.gallery ?? []) {
    uploaded.push({
      outcomeIndex: image.outcomeIndex,
      label: image.label,
      url: await put(image.source, `"${image.label}" image`),
    });
  }

  onProgress?.("document");
  const children = metadata.children.map((child) => ({
    ...child,
    gallery: uploaded
      .filter((image) => image.outcomeIndex === child.outcomeIndex)
      .map(({ label, url }) => ({ label, url })),
  }));
  const placed = children.reduce((count, child) => count + child.gallery.length, 0);
  if (placed !== uploaded.length) {
    throw new Error("An image points at a branch the session does not have.");
  }
  const document = buildSessionMetadata({ ...metadata, heroImage, icon, children });
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
