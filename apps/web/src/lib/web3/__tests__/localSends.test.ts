// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { mock, type CreateConnectorFn } from "@wagmi/core";
import { createEmitter } from "@wagmi/core/internal";
import { createWalletClient, custom, defineChain, type EIP1193RequestFn } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// config/env parses at module load and throws on missing variables, so the
// import happens dynamically after these are stubbed.
const REQUIRED_ENV = {
  NEXT_PUBLIC_REOWN_PROJECT_ID: "test-project",
  NEXT_PUBLIC_ATLAS_URI: "http://localhost:4747",
  NEXT_PUBLIC_IPFS_GATEWAY: "http://localhost:4747/ipfs",
  NEXT_PUBLIC_SUBGRAPH_URL: "http://localhost:8080/v1/graphql",
};

const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const HASH = `0x${"ab".repeat(32)}`;
/** Past viem's default 10 s request timeout, which the mock connector's own send keeps. */
const SEND_ANSWERS_AFTER_MS = 10_500;

let server: Server;
let url: string;
const methods: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const { id, method } = JSON.parse(body) as { id: number; method: string };
      methods.push(method);
      const answer = () => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ jsonrpc: "2.0", id, result: method === "eth_sendTransaction" ? HASH : "0x64" }));
      };
      if (method === "eth_sendTransaction") setTimeout(answer, SEND_ANSWERS_AFTER_MS);
      else answer();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries(REQUIRED_ENV)) vi.stubEnv(name, value);
  methods.length = 0;
});

const chainAt = (rpc: string) =>
  defineChain({
    id: 100,
    name: "Gnosis",
    nativeCurrency: { name: "xDAI", symbol: "xDAI", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });

const configAt = (rpc: string): Parameters<CreateConnectorFn>[0] => ({
  chains: [chainAt(rpc)],
  emitter: createEmitter("mock"),
  providers: [],
  storage: null,
  transports: {},
});

async function devWalletOn(rpc: string) {
  const { withLocalSendTimeout } = await import("../localSends");
  const connector = withLocalSendTimeout(mock({ accounts: [ACCOUNT] }))(configAt(rpc));
  return connector.getProvider({ chainId: 100 }) as Promise<{ request: EIP1193RequestFn }>;
}

describe("the dev wallet's send on a local node", () => {
  it(
    "waits past viem's default timeout for a node that takes its time to answer a send",
    async () => {
      const provider = await devWalletOn(url);

      // as wagmi's sendTransaction does: a wallet client over the connector's provider
      const wallet = createWalletClient({ account: ACCOUNT, transport: custom(provider) });

      await expect(wallet.sendTransaction({ to: ACCOUNT, chain: null })).resolves.toBe(HASH);
      expect(methods).toEqual(["eth_sendTransaction"]);
    },
    SEND_ANSWERS_AFTER_MS + 5_000,
  );

  it("leaves every other request to the mock connector", async () => {
    const provider = await devWalletOn(url);

    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual([ACCOUNT]);
    await expect(provider.request({ method: "eth_blockNumber" })).resolves.toBe("0x64");
    expect(methods).toEqual(["eth_blockNumber"]);
  });
});

describe("the dev wallet's send on a remote node", () => {
  it("is the connector's own provider, untouched", async () => {
    const { withLocalSendTimeout } = await import("../localSends");
    const own = { request: vi.fn() };
    const inner = ((config) => ({
      ...mock({ accounts: [ACCOUNT] })(config),
      getProvider: () => Promise.resolve(own),
    })) as CreateConnectorFn;

    const connector = withLocalSendTimeout(inner)(configAt("https://rpc.gnosischain.com"));
    await expect(connector.getProvider({ chainId: 100 })).resolves.toBe(own);
  });
});
