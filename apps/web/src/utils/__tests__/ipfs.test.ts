import { describe, expect, it } from "vitest";

import { gatewayUrl, tryGatewayUrl } from "../ipfs";

/**
 * This decides which URL gets fetched from a string an untrusted deployer put
 * on chain. A prefix left unstripped is a 404; a prefix stripped too eagerly is
 * a request somewhere else entirely.
 */

const CID = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR";
const GATEWAY = "https://ipfs.io/ipfs";

describe("gatewayUrl, normalising", () => {
  // `/ipfs/<cid>` is what Atlas answers an upload with, so it is the form this
  // app's own sessions carry. The rest arrive from sessions deployed elsewhere.
  it.each([`/ipfs/${CID}`, `ipfs://${CID}`, `ipfs::/${CID}`, `ipfs:/${CID}`, `ipfs/${CID}`, `/${CID}`, CID])(
    "reduces %s to the bare cid",
    (uri) => {
      expect(gatewayUrl(GATEWAY, uri)).toBe(`${GATEWAY}/${CID}`);
    },
  );

  it("keeps a path inside the cid, which addresses a file rather than the directory", () => {
    expect(gatewayUrl(GATEWAY, `ipfs://${CID}/hero.jpg`)).toBe(`${GATEWAY}/${CID}/hero.jpg`);
  });

  it("ignores surrounding whitespace, which survives a copy and paste", () => {
    expect(gatewayUrl(GATEWAY, `  ipfs://${CID}  `)).toBe(`${GATEWAY}/${CID}`);
  });

  it("tolerates a trailing slash on the gateway, since these come from the environment", () => {
    expect(gatewayUrl(`${GATEWAY}/`, `/ipfs/${CID}`)).toBe(`${GATEWAY}/${CID}`);
  });

  it("passes through something carrying no prefix at all", () => {
    expect(gatewayUrl(GATEWAY, "not-a-cid")).toBe(`${GATEWAY}/not-a-cid`);
  });

  it("accepts a name that merely starts with dots", () => {
    expect(gatewayUrl(GATEWAY, "..hidden")).toBe(`${GATEWAY}/..hidden`);
  });
});

describe("gatewayUrl, refusing", () => {
  it.each(["ipfs://../../etc/passwd", `${CID}/../../etc/passwd`])(
    "refuses %s, which would resolve outside the gateway root",
    (uri) => {
      expect(() => gatewayUrl(GATEWAY, uri)).toThrow(/escapes the gateway root/);
    },
  );

  it.each(["https://evil.test/x", "data:text/html,<script>", "javascript:alert(1)", "file:///etc/passwd"])(
    "refuses %s, which was never an IPFS address",
    (uri) => {
      expect(() => gatewayUrl(GATEWAY, uri)).toThrow(/uri of its own/);
    },
  );

  it.each(["", "   ", "ipfs://", "/ipfs/", "/"])("refuses %o rather than fetching the gateway root", (uri) => {
    expect(() => gatewayUrl(GATEWAY, uri)).toThrow(/no CID in it/);
  });
});

describe("tryGatewayUrl", () => {
  it("answers what gatewayUrl answers for a uri it accepts", () => {
    expect(tryGatewayUrl(GATEWAY, `ipfs://${CID}`)).toBe(gatewayUrl(GATEWAY, `ipfs://${CID}`));
  });

  it.each(["https://evil.test/x", `${CID}/../../etc/passwd`, "", "/ipfs/"])(
    "answers null for %o, which gatewayUrl refuses",
    (uri) => {
      expect(tryGatewayUrl(GATEWAY, uri)).toBeNull();
    },
  );
});
