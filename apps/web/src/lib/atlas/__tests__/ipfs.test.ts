import { IpfsProduct, Roles, uploadToIpfs } from "@kleros/kleros-app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_CID } from "@/testing/fixtures";

import { createMetadataUploader, isRateLimited, UPLOAD_ATTEMPTS } from "../ipfs";
import { createUploadMemory, type UploadMemory } from "../uploadMemory";

/**
 * The CID this produces goes on chain permanently, so the two ways it can go
 * quietly wrong are covered: an upload that was never authorized, and a
 * document that cannot be read back from the gateway readers will use.
 */

const CID = VALID_CID;

/** What Atlas answers an upload with, and so what a read is later given. */
const UPLOADED_URI = `/ipfs/${CID}`;

const GATEWAY = "http://atlas.test/ipfs";

/** Served by the fake gateway, so a read that works produces exactly this. */
const DOCUMENT = { hello: "world" };

/**
 * What kleros-app throws for the bodyless 429 the rate limiter answers with,
 * proven against the real library at the bottom of this file.
 */
const limiterRefusal = () => new Error("Error uploading to IPFS");

/**
 * The limiter unblocks after about five minutes of silence, measured against
 * staging. Retries that give up sooner all land inside the block.
 */
const MIN_LIMITER_WINDOW_MS = 300_000;

/**
 * Stands in for kleros-app's upload and for the gateway, recording what each
 * was given. `answer: null` is what kleros-app returns when nobody is signed in.
 */
function atlas(
  opts: {
    answer?: string | null;
    /** Thrown on every attempt. */
    refuse?: Error;
    /** Thrown in order until spent, after which attempts succeed. */
    refuseFirst?: Error[];
    serve?: () => Response;
    memory?: UploadMemory;
  } = {},
) {
  const { answer = UPLOADED_URI, refuse, serve = () => new Response(JSON.stringify(DOCUMENT), { status: 200 }) } = opts;
  const refusals = [...(opts.refuseFirst ?? [])];
  const attemptsSeen: File[] = [];
  const urlsFetched: string[] = [];
  const waits: number[] = [];

  // Both roles share one recorder: which role a file went under is the caller's concern,
  // and every assertion here is about what reached Atlas at all.
  const record = async (file: File) => {
    attemptsSeen.push(file);
    const scripted = refusals.shift();
    if (scripted) throw scripted;
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
    sleep: async (ms) => void waits.push(ms),
    memory: opts.memory ?? createUploadMemory({ storage: null }),
  });

  /** The single file this upload was given, failing the test if there was none. */
  const onlyUpload = () => {
    const [file] = attemptsSeen;
    if (!file) throw new Error("Nothing was uploaded.");
    return file;
  };

  return { client, urlsFetched, attemptsSeen, waits, onlyUpload };
}

function fakeStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
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

describe("riding out the rate limiter", () => {
  it("asks again after a limited attempt, and hands back what finally landed", async () => {
    const a = atlas({ refuseFirst: [limiterRefusal()] });

    await expect(a.client.uploadFile(new File(["x"], "x.png"))).resolves.toBe(UPLOADED_URI);

    expect(a.attemptsSeen).toHaveLength(2);
    expect(a.waits).toHaveLength(1);
  });

  it("doubles each wait between limited attempts", async () => {
    const a = atlas({ refuse: limiterRefusal() });

    await expect(a.client.uploadFile(new File(["x"], "x.png"))).rejects.toThrow();

    expect(a.waits).toHaveLength(UPLOAD_ATTEMPTS - 1);
    a.waits.forEach((ms, i) => i > 0 && expect(ms).toBe((a.waits[i - 1] ?? 0) * 2));
  });

  it("waits at least the window the limiter needs to forget us", async () => {
    const a = atlas({ refuse: limiterRefusal() });

    await expect(a.client.uploadFile(new File(["x"], "x.png"))).rejects.toThrow();

    expect(a.waits.reduce((total, ms) => total + ms, 0)).toBeGreaterThanOrEqual(MIN_LIMITER_WINDOW_MS);
  });

  it("gives up once the agreed attempts are spent, saying to wait rather than mash retry", async () => {
    const a = atlas({ refuse: limiterRefusal() });

    const failed = a.client.uploadFile(new File(["x"], "hero.png"));

    await expect(failed).rejects.toThrow(/wait a minute/i);
    await expect(failed).rejects.not.toThrow(/IPFS/);
    expect(a.attemptsSeen).toHaveLength(UPLOAD_ATTEMPTS);
  });

  it("does not ask again for a refusal that is not the limiter", async () => {
    const a = atlas({ refuse: new Error("File too big. Max allowed size : 4.00 mb.") });

    await expect(a.client.uploadFile(new File(["x"], "hero.png"))).rejects.toThrow();

    expect(a.attemptsSeen).toHaveLength(1);
    expect(a.waits).toHaveLength(0);
  });

  it("uploads a file once however many times a publish hands it over", async () => {
    const a = atlas();
    const file = new File(["x"], "hero.png");

    await a.client.uploadFile(file);
    await expect(a.client.uploadFile(file)).resolves.toBe(UPLOADED_URI);

    expect(a.attemptsSeen).toHaveLength(1);
  });

  it("skips a file that landed on a previous visit, given the same bytes", async () => {
    const storage = fakeStorage();
    const before = atlas({ memory: createUploadMemory({ storage }) });
    await before.client.uploadFile(new File(["same-bytes"], "hero.png"));

    const afterReload = atlas({ memory: createUploadMemory({ storage }) });

    await expect(afterReload.client.uploadFile(new File(["same-bytes"], "hero.png"))).resolves.toBe(UPLOADED_URI);
    expect(afterReload.attemptsSeen).toEqual([]);
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

/**
 * The limiter sits in front of Atlas and answers 429 with an empty body, so
 * the only trace kleros-app leaves is its own fallback message. These pin that
 * coupling to the real library, where `limiterRefusal` above merely retypes it.
 */
describe("the limiter's refusal, against the real kleros-app", () => {
  afterEach(() => vi.unstubAllGlobals());

  const upload = () =>
    uploadToIpfs(
      { baseUrl: "http://atlas.test", authToken: "token" },
      { file: new File(["x"], "x.png"), name: "x.png", product: IpfsProduct.Curate, role: Roles.CurateItemImage },
    ).then(
      () => null,
      (error: unknown) => error,
    );

  it("recognizes what uploadToIpfs throws for a bodyless 429", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 429 }));

    const thrown = await upload();

    expect(isRateLimited(thrown)).toBe(true);
    expect(isRateLimited(limiterRefusal())).toBe(true);
    expect((thrown as Error).message).toBe(limiterRefusal().message);
  });

  it("does not mistake a refusal that carries the service's own words", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ message: "File too big" }), { status: 400 }));

    expect(isRateLimited(await upload())).toBe(false);
  });
});
