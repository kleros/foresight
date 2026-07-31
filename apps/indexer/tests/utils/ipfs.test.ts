import type { EffectContext } from "envio";
import { afterEach, describe, it, vi } from "vitest";

import { ipfsPath } from "../../src/utils";
import { tryFetchIpfsFile } from "../../src/utils/ipfs";
import { parseSessionMetadata } from "../../src/utils/ipfs/fetchSessionMetadata";
import { FIRST_CHILD, METADATA_CID as CID, SESSION_METADATA } from "../fixtures/sessionMetadata";

describe("ipfsPath", () => {
  it("strips every accepted prefix, and leaves a bare CID alone", (t) => {
    t.expect(ipfsPath(`ipfs://${CID}`)).toBe(CID);
    t.expect(ipfsPath(`ipfs:/${CID}`)).toBe(CID);
    t.expect(ipfsPath(`ipfs::/${CID}`)).toBe(CID);
    t.expect(ipfsPath(`/ipfs/${CID}`)).toBe(CID);
    t.expect(ipfsPath(`ipfs/${CID}`)).toBe(CID);
    t.expect(ipfsPath(`/${CID}`)).toBe(CID);
    t.expect(ipfsPath(CID)).toBe(CID);
  });

  it("keeps the path after the CID, since the document may not be at the root", (t) => {
    t.expect(ipfsPath(`ipfs://${CID}/session.json`)).toBe(`${CID}/session.json`);
  });

  it("extracts only - deciding what is safe to request is the fetcher's job", (t) => {
    t.expect(ipfsPath("ipfs://../../admin")).toBe("../../admin");
    t.expect(ipfsPath("https://example.com/metadata.json")).toBe("https://example.com/metadata.json");
  });
});

const silentContext = { log: { info: () => {}, warn: () => {}, error: () => {} } } as unknown as EffectContext;
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("tryFetchIpfsFile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses a path outright, before any request is made", async (t) => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    const refused: [string, RegExp][] = [
      ["../../admin/purge", /escapes the gateway root/],
      [`${CID}/../../admin`, /escapes the gateway root/],
      ["data:application/json,{}", /uri of its own/],
      ["file:///etc/passwd", /uri of its own/],
      ["javascript:alert(1)", /uri of its own/],
      ["https://evil/x", /uri of its own/],
    ];

    for (const [uri, message] of refused) {
      await t.expect(tryFetchIpfsFile(uri, silentContext), uri).rejects.toThrow(message);
    }
    t.expect(request).not.toHaveBeenCalled();
  });

  it("treats `..` inside a segment as an ordinary filename", async (t) => {
    const request = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", request);

    await tryFetchIpfsFile(`${CID}/a..b.json`, silentContext);

    t.expect(request).toHaveBeenCalledTimes(1);
  });

  it("falls through to the next gateway, and gives up with null when none has it", async (t) => {
    const request = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", request);

    t.expect(await tryFetchIpfsFile(CID, silentContext)).toBeNull();
    // one attempt per configured gateway, none of them silently skipped
    t.expect(request.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("parseSessionMetadata", () => {
  const valid = (overrides: Record<string, unknown> = {}) => ({ ...SESSION_METADATA, ...overrides });

  it("reads a complete document, and drops the keys it does not know", (t) => {
    t.expect(parseSessionMetadata(SESSION_METADATA)).toEqual({
      schemaVersion: 1,
      session: SESSION_METADATA.session,
      children: SESSION_METADATA.children,
    });
  });

  it("treats icon as the one optional display field, per its documented fallback", (t) => {
    const { icon, ...withoutIcon } = SESSION_METADATA.session;

    t.expect(parseSessionMetadata(valid({ session: withoutIcon })).session.icon).toBeUndefined();
  });

  it("rejects a document missing any other display field, since the card cannot render it", (t) => {
    for (const field of ["title", "description", "heroImage", "itemName", "itemNamePlural", "blocks"]) {
      const { [field]: _dropped, ...session } = SESSION_METADATA.session as Record<string, unknown>;

      t.expect(() => parseSessionMetadata(valid({ session })), `missing ${field}`).toThrow();
    }

    for (const field of ["displayName", "color", "blocks"]) {
      const { [field]: _dropped, ...child } = FIRST_CHILD as Record<string, unknown>;

      t.expect(() => parseSessionMetadata(valid({ children: [child] })), `missing child ${field}`).toThrow();
    }
  });

  it("rejects a schemaVersion this reader was not written for", (t) => {
    t.expect(() => parseSessionMetadata(valid({ schemaVersion: 2 }))).toThrow();
    t.expect(() => parseSessionMetadata({ session: SESSION_METADATA.session, children: [] })).toThrow();
  });

  it("takes markdown blocks, and only markdown for now", (t) => {
    const withBlocks = (...blocks: unknown[]) => valid({ session: { ...SESSION_METADATA.session, blocks } });

    t.expect(parseSessionMetadata(withBlocks({ type: "markdown", body: "ok" })).session.blocks).toHaveLength(1);
    t.expect(() => parseSessionMetadata(withBlocks({ type: "link", label: "a", url: "u" }))).toThrow();
    // blocks are validated through the array, not just counted
    t.expect(() => parseSessionMetadata(withBlocks({ type: "markdown", label: "no body" }))).toThrow();
  });
});
