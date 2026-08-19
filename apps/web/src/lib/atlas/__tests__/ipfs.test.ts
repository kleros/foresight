import { describe, expect, it } from "vitest";

import { createMetadataUploader } from "../ipfs";

/**
 * The CID this produces goes on chain permanently, so the two ways it can go
 * quietly wrong are covered: an upload that was never authorized, and a
 * document that cannot be read back from the gateway readers will use.
 */

const CID = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR";

/** What Atlas answers an upload with, and so what a read is later given. */
const UPLOADED_URI = `/ipfs/${CID}`;

const GATEWAY = "http://atlas.test/ipfs";

/** Served by the fake gateway, so a read that works produces exactly this. */
const DOCUMENT = { hello: "world" };

/**
 * Stands in for kleros-app's upload and for the gateway, recording what each
 * was given. `answer: null` is what kleros-app returns when nobody is signed in.
 */
function atlas(opts: { answer?: string | null; refuse?: Error; serve?: () => Response } = {}) {
  const { answer = UPLOADED_URI, refuse, serve = () => new Response(JSON.stringify(DOCUMENT), { status: 200 }) } = opts;
  const filesUploaded: File[] = [];
  const urlsFetched: string[] = [];

  // Both roles share one recorder: which role a file went under is the caller's concern,
  // and every assertion here is about what reached Atlas at all.
  const record = async (file: File) => {
    filesUploaded.push(file);
    if (refuse) throw refuse;
    return answer;
  };

  const client = createMetadataUploader({
    uploadImage: record,
    uploadDocument: record,
    gateway: GATEWAY,
    fetchImpl: async (input) => {
      urlsFetched.push(String(input));
      return serve();
    },
  });

  /** The single file this upload was given, failing the test if there was none. */
  const onlyUpload = () => {
    const [file] = filesUploaded;
    if (!file) throw new Error("Nothing was uploaded.");
    return file;
  };

  return { client, urlsFetched, onlyUpload };
}

describe("uploading", () => {
  it("hands back exactly what Atlas answered, because the uri goes on chain unrewritten", async () => {
    const a = atlas();

    await expect(a.client.uploadFile(new File(["x"], "x.png"))).resolves.toBe(UPLOADED_URI);
  });

  it("uploads a document as JSON without the caller building a File", async () => {
    const a = atlas();

    await a.client.uploadJson("session.json", DOCUMENT);

    const file = a.onlyUpload();
    expect(file.name).toBe("session.json");
    await expect(file.text()).resolves.toBe(JSON.stringify(DOCUMENT));
  });

  it("throws on the null Atlas returns for a missing session, rather than passing it on", async () => {
    const a = atlas({ answer: null });

    await expect(a.client.uploadFile(new File(["x"], "hero.png"))).rejects.toThrow(/hero\.png/);
  });

  /**
   * kleros-app rethrows the upload service's own `message` field verbatim, and
   * this message reaches the deploy screen. What that service calls itself is
   * not something a creator should be shown.
   */
  it("says the upload failed in its own words, not the service's", async () => {
    const a = atlas({ refuse: new Error("Atlas is out.") });

    const failed = a.client.uploadFile(new File(["x"], "hero.png"));

    await expect(failed).rejects.toThrow(/hero\.png could not be uploaded/);
    await expect(failed).rejects.not.toThrow(/Atlas/);
  });

  it("tells a refused upload apart from one nobody was signed in for", async () => {
    const refused = atlas({ refuse: new Error("Service Unavailable") });
    const signedOut = atlas({ answer: null });

    await expect(refused.client.uploadFile(new File(["x"], "hero.png"))).rejects.toThrow(/Try again in a moment/);
    await expect(signedOut.client.uploadFile(new File(["x"], "hero.png"))).rejects.toThrow(/Sign in again/);
  });
});

describe("reading back", () => {
  // Which prefix reduces to what is proven in `@/utils/ipfs`. What matters here
  // is that this client asks the gateway for the normalised path.
  it("asks the gateway for the normalised path, and returns what it served", async () => {
    const a = atlas();

    await expect(a.client.readJson(UPLOADED_URI)).resolves.toEqual(DOCUMENT);

    expect(a.urlsFetched).toEqual([`${GATEWAY}/${CID}`]);
  });

  it("fails loudly when the gateway cannot serve the document", async () => {
    const a = atlas({ serve: () => new Response("gone", { status: 404 }) });

    await expect(a.client.readJson(UPLOADED_URI)).rejects.toThrow(/404/);
  });
});
