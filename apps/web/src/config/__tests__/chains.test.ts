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
