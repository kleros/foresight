import { describe, expect, it } from "vitest";

import type { MetadataUploader } from "@/lib/atlas/types";

import { dune } from "@/testing/fixtures";

import { publishSessionMetadata, READ_BACK_ATTEMPTS, type UnpublishedMetadata } from "../publish";
import { fakeIpfs } from "./support/ipfs";

/**
 * Publishing happens before any gas is spent, which is the whole point: the
 * document is read back and compared before a transaction can reference it.
 * A session whose metadata uri resolves to nothing cannot be repaired.
 */

const metadata: UnpublishedMetadata = {
  title: dune.title,
  description: dune.description,
  itemName: dune.itemName,
  itemNamePlural: dune.itemNamePlural,
  children: [
    { outcomeIndex: 0, displayName: "Villeneuve", color: "#7e1bd4" },
    { outcomeIndex: 1, displayName: "Gerwig", color: "#009aff" },
  ],
};

/** Records what the backoff asked for without ever waiting. */
function fakeClock() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

/** How long a slow gateway is given, in total, before the deploy is refused. */
const MIN_READ_BACK_WINDOW_MS = 12_000;

const hero = () => new File(["hero-bytes"], "hero.jpg", { type: "image/jpeg" });
const icon = () => new File(["icon-bytes"], "icon.png", { type: "image/png" });

/** Runs the read-back to exhaustion against a gateway that never answers. */
async function exhaustTheGateway() {
  const ipfs = fakeIpfs();
  const uploader: MetadataUploader = { ...ipfs.uploader, readJson: () => Promise.reject(new Error("gateway down")) };
  const clock = fakeClock();

  await expect(
    publishSessionMetadata({ uploader, images: { hero: hero() }, metadata, sleep: clock.sleep }),
  ).rejects.toThrow();

  return clock;
}

describe("publishSessionMetadata", () => {
  it("uploads the hero image and points the document at it", async () => {
    const ipfs = fakeIpfs();

    const { document } = await publishSessionMetadata({ uploader: ipfs.uploader, images: { hero: hero() }, metadata });

    expect(ipfs.filesUploaded).toEqual(["hero.jpg"]);
    expect(document.session.heroImage).toMatch(/^\/ipfs\//);
  });

  it("uploads the icon too when there is one", async () => {
    const ipfs = fakeIpfs();

    const { document } = await publishSessionMetadata({
      uploader: ipfs.uploader,
      images: { hero: hero(), icon: icon() },
      metadata,
    });

    expect(ipfs.filesUploaded).toEqual(["hero.jpg", "icon.png"]);
    expect(document.session.icon).toMatch(/^\/ipfs\//);
  });

  it("returns the uri the document landed at", async () => {
    const ipfs = fakeIpfs();

    const { uri, document } = await publishSessionMetadata({
      uploader: ipfs.uploader,
      images: { hero: hero() },
      metadata,
    });

    expect(ipfs.stored.get(uri)).toEqual(document);
  });

  it("reads the document back again when the gateway has not seen it yet", async () => {
    const ipfs = fakeIpfs();
    let attempts = 0;
    const uploader: MetadataUploader = {
      ...ipfs.uploader,
      readJson: async (uri) => {
        attempts += 1;
        if (attempts === 1) throw new Error("not found yet");
        return ipfs.uploader.readJson(uri);
      },
    };
    const clock = fakeClock();

    const { uri } = await publishSessionMetadata({ uploader, images: { hero: hero() }, metadata, sleep: clock.sleep });

    expect(uri).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("doubles each wait", async () => {
    const clock = await exhaustTheGateway();

    expect(clock.waits.length).toBeGreaterThan(1);
    clock.waits.forEach((ms, i) => i > 0 && expect(ms).toBe((clock.waits[i - 1] ?? 0) * 2));
  });

  it("waits at least the window a slow gateway needs", async () => {
    const clock = await exhaustTheGateway();

    expect(clock.waits.reduce((total, ms) => total + ms, 0)).toBeGreaterThanOrEqual(MIN_READ_BACK_WINDOW_MS);
  });

  it("gives up after the agreed attempts", async () => {
    const ipfs = fakeIpfs();
    let attempts = 0;
    const uploader: MetadataUploader = {
      ...ipfs.uploader,
      readJson: () => {
        attempts += 1;
        return Promise.reject(new Error("gateway down"));
      },
    };
    const clock = fakeClock();

    await expect(
      publishSessionMetadata({ uploader, images: { hero: hero() }, metadata, sleep: clock.sleep }),
    ).rejects.toThrow(new RegExp(`could not be read back after ${READ_BACK_ATTEMPTS} attempts`, "i"));
    expect(attempts).toBe(READ_BACK_ATTEMPTS);
  });

  it("takes a caller's own attempt count", async () => {
    const ipfs = fakeIpfs();
    let asked = 0;
    const uploader: MetadataUploader = {
      ...ipfs.uploader,
      readJson: () => {
        asked += 1;
        return Promise.reject(new Error("gateway down"));
      },
    };
    const clock = fakeClock();

    await expect(
      publishSessionMetadata({ uploader, images: { hero: hero() }, metadata, attempts: 2, sleep: clock.sleep }),
    ).rejects.toThrow(/after 2 attempts/i);
    expect(asked).toBe(2);
    expect(clock.waits).toHaveLength(1);
  });

  it("asks once when given an attempt count below one", async () => {
    const ipfs = fakeIpfs();
    let asked = 0;
    const uploader: MetadataUploader = {
      ...ipfs.uploader,
      readJson: async (uri) => {
        asked += 1;
        return ipfs.uploader.readJson(uri);
      },
    };

    await publishSessionMetadata({ uploader, images: { hero: hero() }, metadata, attempts: 0 });

    expect(asked).toBe(1);
  });

  it("refuses when the document read back is not the one uploaded", async () => {
    const ipfs = fakeIpfs();
    let attempts = 0;
    const uploader: MetadataUploader = {
      ...ipfs.uploader,
      readJson: async () => {
        attempts += 1;
        return { schemaVersion: 1, session: {}, children: [] };
      },
    };
    const clock = fakeClock();

    await expect(
      publishSessionMetadata({ uploader, images: { hero: hero() }, metadata, sleep: clock.sleep }),
    ).rejects.toThrow(/do not match what was uploaded/i);
    // A wrong answer is not a slow one, so it is not asked again.
    expect(attempts).toBe(1);
  });

  it("reports each stage", async () => {
    const stages: string[] = [];

    await publishSessionMetadata({
      uploader: fakeIpfs().uploader,
      images: { hero: hero(), icon: icon() },
      metadata,
      onProgress: (stage) => void (stages.at(-1) !== stage && stages.push(stage)),
    });

    expect(stages).toEqual(["images", "document", "verifying"]);
  });

  it("counts every image up as it lands, the gallery included", async () => {
    const counts: Array<{ done: number; total: number }> = [];
    const poster = new File(["poster-bytes"], "poster.png", { type: "image/png" });

    await publishSessionMetadata({
      uploader: fakeIpfs().uploader,
      images: { hero: hero(), icon: icon(), gallery: [{ outcomeIndex: 1, label: "The poster", source: poster }] },
      metadata,
      onProgress: (_stage, images) => void (images && counts.push(images)),
    });

    expect(counts).toEqual([0, 1, 2, 3].map((done) => ({ done, total: 3 })));
  });

  it("uploads a branch's gallery and writes each image into that branch's blocks", async () => {
    const ipfs = fakeIpfs();
    const poster = new File(["poster-bytes"], "poster.png", { type: "image/png" });

    const { document } = await publishSessionMetadata({
      uploader: ipfs.uploader,
      images: { hero: hero(), gallery: [{ outcomeIndex: 1, label: "The poster", source: poster }] },
      metadata,
    });

    expect(ipfs.filesUploaded).toEqual(["hero.jpg", "poster.png"]);
    expect(document.children[0]?.blocks).toEqual([]);
    expect(document.children[1]?.blocks).toEqual([
      { type: "image", label: "The poster", url: expect.stringMatching(/^\/ipfs\//) as string },
    ]);
  });

  it("keeps a gallery image already on IPFS instead of uploading it again", async () => {
    const ipfs = fakeIpfs();
    ipfs.stored.set("/ipfs/QmHero", "hero-bytes");
    ipfs.stored.set("/ipfs/QmPoster", "poster-bytes");

    const { document } = await publishSessionMetadata({
      uploader: ipfs.uploader,
      images: { hero: "/ipfs/QmHero", gallery: [{ outcomeIndex: 0, label: "The poster", source: "/ipfs/QmPoster" }] },
      metadata,
    });

    expect(ipfs.filesUploaded).toEqual([]);
    expect(document.children[0]?.blocks).toContainEqual({ type: "image", label: "The poster", url: "/ipfs/QmPoster" });
  });

  it("refuses an image pointing at a branch the session does not have", async () => {
    const ipfs = fakeIpfs();
    ipfs.stored.set("/ipfs/QmPoster", "poster-bytes");

    await expect(
      publishSessionMetadata({
        uploader: ipfs.uploader,
        images: { hero: hero(), gallery: [{ outcomeIndex: 7, label: "The poster", source: "/ipfs/QmPoster" }] },
        metadata,
      }),
    ).rejects.toThrow(/branch the session does not have/i);
  });

  it("keeps an image already on IPFS instead of uploading it again", async () => {
    const ipfs = fakeIpfs();
    ipfs.stored.set("/ipfs/QmAlreadyThere", "hero-bytes");

    const { document } = await publishSessionMetadata({
      uploader: ipfs.uploader,
      images: { hero: "/ipfs/QmAlreadyThere" },
      metadata,
    });

    expect(ipfs.filesUploaded).toEqual([]);
    expect(document.session.heroImage).toBe("/ipfs/QmAlreadyThere");
  });

  it("refuses a carried-over image the gateway no longer serves, naming it", async () => {
    const failed = publishSessionMetadata({
      uploader: fakeIpfs().uploader,
      images: { hero: "/ipfs/QmGoneWithTheStore" },
      metadata,
    });

    await expect(failed).rejects.toThrow(/hero image uploaded earlier can no longer be found/);
  });

  it("names the gallery image that no longer serves by its label", async () => {
    const ipfs = fakeIpfs();

    const failed = publishSessionMetadata({
      uploader: ipfs.uploader,
      images: { hero: hero(), gallery: [{ outcomeIndex: 0, label: "The poster", source: "/ipfs/QmGone" }] },
      metadata,
    });

    await expect(failed).rejects.toThrow(/"The poster" image uploaded earlier can no longer be found/);
  });
});
