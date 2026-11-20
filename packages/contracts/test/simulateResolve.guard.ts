// Runs the simulate-resolve action against faked network configurations, all reporting chain 100.
// A loopback URL is backed by a local JSON-RPC stub that answers like the faked provider.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { HardhatEthersProvider } from "@nomicfoundation/hardhat-ethers/internal/hardhat-ethers-provider";
import { expect } from "chai";
import hre from "hardhat";
import type { EthereumProvider, HardhatRuntimeEnvironment, NetworkConfig, RequestArguments } from "hardhat/types";

const SIGNER_REACHED = "signer reached";
const GNOSIS = 100;

type Metadata = { forkedNetwork?: { chainId: number; forkBlockNumber: number; forkBlockHash: string } } | "unsupported";

interface Case {
  networkName: string;
  url?: string | "loopback";
  forking?: boolean;
  metadata: Metadata;
}

const metadataFor = (forkedChainId?: number): Metadata => ({
  ...(forkedChainId !== undefined && {
    forkedNetwork: { chainId: forkedChainId, forkBlockNumber: 40_000_000, forkBlockHash: `0x${"ab".repeat(32)}` },
  }),
});

function answer(metadata: Metadata, method: string): { result?: unknown; error?: { code: number; message: string } } {
  switch (method) {
    case "eth_chainId":
      return { result: `0x${GNOSIS.toString(16)}` };
    case "net_version":
      return { result: String(GNOSIS) };
    case "hardhat_metadata":
      if (metadata === "unsupported") return { error: { code: -32601, message: "Method not found" } };
      return {
        result: {
          clientVersion: "HardhatNetwork/2.22.19/@nomicfoundation/edr/0.0.0",
          chainId: GNOSIS,
          instanceId: `0x${"cd".repeat(32)}`,
          latestBlockNumber: 40_000_001,
          latestBlockHash: `0x${"ef".repeat(32)}`,
          ...metadata,
        },
      };
    default:
      return { error: { code: -32000, message: `unexpected ${method}` } };
  }
}

async function startStub(metadata: Metadata, calls: string[]): Promise<Server> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      const parsed = JSON.parse(body) as { id: number; method: string } | { id: number; method: string }[];
      const reply = (one: { id: number; method: string }) => {
        calls.push(one.method);
        return { jsonrpc: "2.0", id: one.id, ...answer(metadata, one.method) };
      };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(reply) : reply(parsed)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function fakeProvider(metadata: Metadata, calls: string[]): EthereumProvider {
  const request = ({ method }: RequestArguments): Promise<unknown> => {
    calls.push(method);
    const { result, error } = answer(metadata, method);
    if (error) return Promise.reject(Object.assign(new Error(error.message), { code: error.code }));
    return Promise.resolve(result);
  };
  const provider = Object.assign(Object.create(hre.network.provider) as EthereumProvider, {
    request,
    send: (method: string, params?: unknown[]) => request({ method, params }),
    sendAsync: () => {
      throw new Error("sendAsync is not supported by this fake");
    },
  });
  return provider;
}

interface Run {
  error: unknown;
  calls: string[];
  signerRequests: number;
}

async function runAction(testCase: Case): Promise<Run> {
  const calls: string[] = [];
  let signerRequests = 0;
  const server = testCase.url === "loopback" ? await startStub(testCase.metadata, calls) : undefined;
  try {
    const url = server ? `http://127.0.0.1:${(server.address() as AddressInfo).port}` : testCase.url;
    const base = hre.config.networks.hardhat;
    const networkConfig = (
      url === undefined
        ? {
            ...base,
            chainId: GNOSIS,
            ...(testCase.forking
              ? { forking: { enabled: true, url: "https://rpc.gnosischain.com", blockNumber: 40_000_000 } }
              : { forking: undefined }),
          }
        : {
            url,
            chainId: GNOSIS,
            accounts: "remote",
            gas: "auto",
            gasPrice: "auto",
            gasMultiplier: 1,
            httpHeaders: {},
            timeout: 20_000,
          }
    ) as NetworkConfig;
    const provider = fakeProvider(testCase.metadata, calls);

    const ethers = Object.assign(Object.create(hre.ethers) as typeof hre.ethers, {
      provider: new HardhatEthersProvider(provider, testCase.networkName),
      getSigners: () => {
        signerRequests++;
        return Promise.reject(new Error(SIGNER_REACHED));
      },
      getSigner: () => {
        signerRequests++;
        return Promise.reject(new Error(SIGNER_REACHED));
      },
    });
    const fake = Object.assign(Object.create(hre) as HardhatRuntimeEnvironment, {
      network: { ...hre.network, name: testCase.networkName, config: networkConfig, provider },
      config: { ...hre.config, networks: { ...hre.config.networks, [testCase.networkName]: networkConfig } },
      getChainId: () => Promise.resolve(String(GNOSIS)),
      ethers,
    });

    const task = hre.tasks["simulate-resolve"];
    if (!task) throw new Error("simulate-resolve is not registered");
    let error: unknown;
    try {
      const noSuper = Object.assign(() => Promise.resolve(), { isDefined: false });
      await task.action({ session: 0, winners: "0", children: "0=42" }, fake, noSuper);
    } catch (caught) {
      error = caught;
    }
    return { error, calls, signerRequests };
  } finally {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }
}

const SENDING = /^(eth_send|eth_sign|personal_sign|eth_accounts|eth_requestAccounts|evm_|hardhat_impersonate)/;

function expectRefusedBeforeSigner(run: Run) {
  expect(run.error, "the action must exit with an error").to.be.instanceOf(Error);
  expect((run.error as Error).message).to.not.include(SIGNER_REACHED);
  expect(run.signerRequests, "a signer was requested").to.equal(0);
  expect(
    run.calls.filter((method) => SENDING.test(method)),
    "transaction-path RPC calls",
  ).to.deep.equal([]);
}

describe("simulate-resolve refuses anything but a gnosis fork before it gets a signer", function () {
  this.timeout(60_000);

  describe("live configurations", function () {
    it("refuses the live gnosis network, whose node has no fork metadata", async function () {
      expectRefusedBeforeSigner(
        await runAction({ networkName: "gnosis", url: "https://rpc.gnosis.invalid", metadata: "unsupported" }),
      );
    });

    it("refuses a remote endpoint even when it reports gnosis fork metadata", async function () {
      expectRefusedBeforeSigner(
        await runAction({
          networkName: "gnosis-fork",
          url: "http://fork.gnosis.invalid:8545",
          metadata: metadataFor(GNOSIS),
        }),
      );
    });
  });

  describe("unknown configurations", function () {
    it("refuses a loopback endpoint that has no fork metadata method", async function () {
      expectRefusedBeforeSigner(
        await runAction({ networkName: "gnosis-fork", url: "loopback", metadata: "unsupported" }),
      );
    });

    it("refuses a loopback endpoint whose metadata names no forked network", async function () {
      expectRefusedBeforeSigner(
        await runAction({ networkName: "gnosis-fork", url: "loopback", metadata: metadataFor() }),
      );
    });

    it("refuses a loopback endpoint that forks a chain other than gnosis", async function () {
      expectRefusedBeforeSigner(
        await runAction({ networkName: "gnosis-fork", url: "loopback", metadata: metadataFor(1) }),
      );
    });

    it("refuses the in-process hardhat network without forking", async function () {
      expectRefusedBeforeSigner(await runAction({ networkName: "hardhat", forking: false, metadata: metadataFor() }));
    });
  });

  describe("gnosis forks (controls: the guard lets them through to the signer)", function () {
    it("passes a loopback endpoint that reports gnosis fork metadata", async function () {
      const run = await runAction({ networkName: "gnosis-fork", url: "loopback", metadata: metadataFor(GNOSIS) });
      expect((run.error as Error | undefined)?.message).to.include(SIGNER_REACHED);
      expect(run.calls.filter((method) => SENDING.test(method))).to.deep.equal([]);
    });

    it("passes the in-process hardhat network forking gnosis", async function () {
      const run = await runAction({ networkName: "hardhat", forking: true, metadata: metadataFor(GNOSIS) });
      expect((run.error as Error | undefined)?.message).to.include(SIGNER_REACHED);
      expect(run.calls.filter((method) => SENDING.test(method))).to.deep.equal([]);
    });
  });
});
