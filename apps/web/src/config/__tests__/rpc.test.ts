import { afterEach, beforeEach, describe, it, vi } from "vitest";

// config/env parses at module load and throws on missing variables, so the
// import happens dynamically after these are stubbed.
const REQUIRED_ENV = {
  NEXT_PUBLIC_REOWN_PROJECT_ID: "test-project",
  NEXT_PUBLIC_ATLAS_URI: "http://localhost:4747",
  NEXT_PUBLIC_IPFS_GATEWAY: "http://localhost:4747/ipfs",
  NEXT_PUBLIC_SUBGRAPH_URL: "http://localhost:8080/v1/graphql",
};

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries(REQUIRED_ENV)) {
    vi.stubEnv(name, value);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gnosisRpcUrls", () => {
  it("uses only the env RPC when one is set, so a fork never leaks reads to real gnosis", async (t) => {
    const { gnosisRpcUrls } = await import("../rpc");
    t.expect(gnosisRpcUrls("http://127.0.0.1:8545")).toEqual(["http://127.0.0.1:8545"]);
  });

  it("falls back to the public RPCs only when no env RPC is set", async (t) => {
    const { gnosisRpcUrls } = await import("../rpc");
    t.expect(gnosisRpcUrls(undefined)).toEqual(["https://rpc.gnosischain.com", "https://rpc.gnosis.gateway.fm"]);
  });
});

describe("rpcTimeoutMs", () => {
  it("waits longer on a local node, whose forked state can take its time to fetch", async (t) => {
    const { rpcTimeoutMs } = await import("../rpc");
    for (const url of ["http://127.0.0.1:8545", "http://localhost:8545"]) t.expect(rpcTimeoutMs(url)).toBe(120_000);
  });

  it("keeps the client's own timeout on a public endpoint, so a fallback is reached quickly", async (t) => {
    const { rpcTimeoutMs } = await import("../rpc");
    t.expect(rpcTimeoutMs("https://rpc.gnosischain.com")).toBeUndefined();
  });
});
