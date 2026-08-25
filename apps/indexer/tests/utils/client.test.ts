import { afterEach, describe, it, vi } from "vitest";

import { rpcUrls } from "../../src/utils/client";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rpcUrls", () => {
  it("uses only the env urls for gnosis when any are set, so a fork never leaks reads to real gnosis", (t) => {
    vi.stubEnv("ENVIO_GNOSIS_RPC_URL", "http://localhost:8545");
    vi.stubEnv("ENVIO_GNOSIS_FALLBACK_RPC_URL", "");
    t.expect(rpcUrls(100)).toEqual(["http://localhost:8545"]);

    vi.stubEnv("ENVIO_GNOSIS_FALLBACK_RPC_URL", "http://localhost:8546");
    t.expect(rpcUrls(100)).toEqual(["http://localhost:8545", "http://localhost:8546"]);
  });

  it("falls back to the public gnosis RPCs only when no env url is set", (t) => {
    vi.stubEnv("ENVIO_GNOSIS_RPC_URL", "");
    vi.stubEnv("ENVIO_GNOSIS_FALLBACK_RPC_URL", "");
    t.expect(rpcUrls(100)).toEqual(["https://rpc.gnosischain.com", "https://rpc.gnosis.gateway.fm"]);
  });

  it("throws for a chain with no configured RPC", (t) => {
    t.expect(() => rpcUrls(1)).toThrow("No RPC configured for chain 1");
  });
});
