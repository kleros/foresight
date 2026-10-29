import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config/env parses at module load, so the module is imported after these are stubbed.
const ENV = {
  NEXT_PUBLIC_REOWN_PROJECT_ID: "test-project",
  NEXT_PUBLIC_ATLAS_URI: "http://localhost:4747",
  NEXT_PUBLIC_IPFS_GATEWAY: "https://gateway.test/ipfs",
  NEXT_PUBLIC_SUBGRAPH_URL: "http://indexer.test/v1/graphql",
  NEXT_PUBLIC_SITE_URL: "https://foresight.test",
};

const PARENT = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const PATH = `/market/${PARENT.toLowerCase()}`;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "7",
  parentMarket: PARENT.toLowerCase(),
  deployer: "0x0000000000000000000000000000000000000001",
  marketName: "Which grant raises GDP most?",
  title: "Grant futarchy",
  description: "Pick the grant\n\nthat the market expects to raise GDP the most.",
  icon: null,
  heroImage: "ipfs://bafyhero/hero.png",
  openingTime: "1900000000",
  ...overrides,
});

const answer = (sessions: unknown[]) => Response.json({ data: { Session: sessions } });

const metadataFor = async (parentMarket = PARENT) => {
  const { generateSessionMetadata } = await import("../sessionMetadata");
  return generateSessionMetadata(parentMarket);
};

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generateSessionMetadata for an indexed session", () => {
  it("titles the page after the session and links its canonical lowercase url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer([row()])),
    );
    const metadata = await metadataFor();

    expect(metadata.title).toEqual({ absolute: "Grant futarchy | Foresight" });
    expect(metadata.alternates?.canonical).toBe(PATH);
    expect(metadata.openGraph).toMatchObject({ url: PATH, title: "Grant futarchy | Foresight" });
    expect(metadata.robots).toBeUndefined();
  });

  it("describes the page with the session's description on one line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer([row()])),
    );
    const metadata = await metadataFor();

    expect(metadata.description).toBe("Pick the grant that the market expects to raise GDP the most.");
    expect(metadata.twitter).toMatchObject({ description: metadata.description });
  });

  it("shares the session's hero image through the gateway in both embeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer([row()])),
    );
    const metadata = await metadataFor();

    expect(metadata.openGraph?.images).toEqual(["https://gateway.test/ipfs/bafyhero/hero.png"]);
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: ["https://gateway.test/ipfs/bafyhero/hero.png"],
    });
  });

  it("falls back to the site image and the market name when metadata never resolved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer([row({ title: null, description: null, heroImage: null })])),
    );
    const metadata = await metadataFor();

    expect(metadata.title).toEqual({ absolute: "Which grant raises GDP most? | Foresight" });
    expect(metadata.openGraph?.images).toEqual(["/futarchy_kleros.png"]);
  });

  it("cuts a long description to a snippet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer([row({ description: "word ".repeat(100) })])),
    );
    const metadata = await metadataFor();

    expect(metadata.description).toHaveLength(160);
    expect(metadata.description?.endsWith("…")).toBe(true);
  });
});

describe("generateSessionMetadata without a session", () => {
  it("keeps an unindexed address out of search results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer([])),
    );
    const metadata = await metadataFor();

    expect(metadata.robots).toEqual({ index: false });
  });

  it("keeps a malformed address out of search results without asking the indexer", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const metadata = await metadataFor("not-an-address");

    expect(metadata.robots).toEqual({ index: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("generateSessionMetadata while the indexer is down", () => {
  const expectGenericSessionPage = (metadata: Awaited<ReturnType<typeof metadataFor>>) => {
    expect(metadata.title).toEqual({ absolute: "Session | Foresight" });
    expect(metadata.alternates?.canonical).toBe(PATH);
    expect(metadata.robots).toBeUndefined();
  };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("serves generic, indexable metadata when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
    );
    expectGenericSessionPage(await metadataFor());
  });

  it("serves generic, indexable metadata when the indexer answers with an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad gateway", { status: 502 })),
    );
    expectGenericSessionPage(await metadataFor());
  });

  it("serves generic, indexable metadata when the indexer answers with GraphQL errors only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ errors: [{ message: "field not found" }] })),
    );
    expectGenericSessionPage(await metadataFor());
  });

  it("stops waiting for an indexer that never answers", async () => {
    // A fetch that settles only when its abort signal fires, as the real one does.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      ),
    );
    const { METADATA_TIMEOUT_MS } = await import("@/features/sessions/api/getSessionMetadata");
    const started = Date.now();

    expectGenericSessionPage(await metadataFor());
    expect(Date.now() - started).toBeLessThan(METADATA_TIMEOUT_MS + 1_000);
  });
});

describe("sessionJsonLd", () => {
  it("escapes markup in a session name inside the script tag", async () => {
    const { sessionJsonLd } = await import("../sessionMetadata");
    const { serializeJsonLd } = await import("@/components/JsonLd");
    const { toSessionCore } = await import("@/features/sessions/utils/toSessionCore");
    const session = toSessionCore(row({ title: "</script><script>alert(1)</script>" }), ENV.NEXT_PUBLIC_IPFS_GATEWAY);

    const html = serializeJsonLd(sessionJsonLd(PARENT, { status: "found", session }));

    expect(html).not.toContain("</script>");
    expect(JSON.parse(html)[0].name).toBe("</script><script>alert(1)</script>");
  });

  it("emits nothing for a session the indexer did not return", async () => {
    const { sessionJsonLd } = await import("../sessionMetadata");
    expect(sessionJsonLd(PARENT, { status: "unavailable" })).toBeNull();
  });
});
