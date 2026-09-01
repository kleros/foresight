import { describe, expect, it } from "vitest";

import { createUploadMemory, MAX_REMEMBERED } from "../uploadMemory";

/**
 * What this remembers stands in for an upload that will never happen again, so
 * the dangerous direction is recalling a uri for bytes that never went up.
 */

function fakeStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
}

describe("createUploadMemory", () => {
  it("recalls nothing it was never told", async () => {
    const memory = createUploadMemory({ storage: null });

    await expect(memory.recall(new File(["x"], "hero.png"))).resolves.toBeUndefined();
  });

  it("recalls a kept upload without a store to write to", async () => {
    const memory = createUploadMemory({ storage: null });
    const file = new File(["x"], "hero.png");

    await memory.keep(file, "/ipfs/QmKept");

    await expect(memory.recall(file)).resolves.toBe("/ipfs/QmKept");
  });

  it("recalls a kept upload on the next visit by its bytes, whatever it is named now", async () => {
    const storage = fakeStorage();
    await createUploadMemory({ storage }).keep(new File(["same-bytes"], "before.png"), "/ipfs/QmKept");

    const nextVisit = createUploadMemory({ storage });

    await expect(nextVisit.recall(new File(["same-bytes"], "renamed.png"))).resolves.toBe("/ipfs/QmKept");
  });

  it("does not recall different bytes under a familiar name", async () => {
    const storage = fakeStorage();
    await createUploadMemory({ storage }).keep(new File(["original"], "hero.png"), "/ipfs/QmKept");

    const nextVisit = createUploadMemory({ storage });

    await expect(nextVisit.recall(new File(["edited"], "hero.png"))).resolves.toBeUndefined();
  });

  it("lets the oldest upload go once it holds the agreed number", async () => {
    const storage = fakeStorage();
    const memory = createUploadMemory({ storage });
    for (let i = 0; i <= MAX_REMEMBERED; i++) {
      await memory.keep(new File([`bytes-${i}`], `f${i}.png`), `/ipfs/Qm${i}`);
    }

    const nextVisit = createUploadMemory({ storage });

    await expect(nextVisit.recall(new File(["bytes-0"], "f0.png"))).resolves.toBeUndefined();
    await expect(nextVisit.recall(new File([`bytes-${MAX_REMEMBERED}`], "last.png"))).resolves.toBe(
      `/ipfs/Qm${MAX_REMEMBERED}`,
    );
  });

  it("still remembers for the visit when the store will not take the write", async () => {
    const memory = createUploadMemory({
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    const file = new File(["x"], "hero.png");

    await memory.keep(file, "/ipfs/QmKept");

    await expect(memory.recall(file)).resolves.toBe("/ipfs/QmKept");
  });

  it("treats a memory it cannot read as empty", async () => {
    const memory = createUploadMemory({ storage: { getItem: () => "not json", setItem: () => undefined } });

    await expect(memory.recall(new File(["x"], "hero.png"))).resolves.toBeUndefined();
  });
});
