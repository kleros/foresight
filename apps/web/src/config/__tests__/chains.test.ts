import { afterEach, beforeEach, describe, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isDevWalletEnabled", () => {
  it("stays on for the local chain, and for gnosis served by a local node (the fork)", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_LOCAL_CHAIN", "false");
    vi.stubEnv("NEXT_PUBLIC_GNOSIS_RPC", "http://127.0.0.1:8545");
    t.expect((await import("../chains")).isDevWalletEnabled).toBe(true);
  });

  it("stays off when gnosis reads from a remote RPC", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_LOCAL_CHAIN", "false");
    vi.stubEnv("NEXT_PUBLIC_GNOSIS_RPC", "https://rpc.gnosischain.com");
    t.expect((await import("../chains")).isDevWalletEnabled).toBe(false);
  });
});

describe("rpcTimeoutMs", () => {
  it("waits longer on a local node, whose forked state can take its time to fetch", async (t) => {
    const { rpcTimeoutMs } = await import("../chains");
    for (const url of ["http://127.0.0.1:8545", "http://localhost:8545"]) t.expect(rpcTimeoutMs(url)).toBe(120_000);
  });

  it("keeps the client's own timeout on a public endpoint, so a fallback is reached quickly", async (t) => {
    const { rpcTimeoutMs } = await import("../chains");
    t.expect(rpcTimeoutMs("https://rpc.gnosischain.com")).toBeUndefined();
  });
});
