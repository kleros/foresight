import { createTestIndexer } from "envio";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { decodeFunctionData, encodeFunctionResult, type Address, type Hex } from "viem";
import { afterAll, beforeAll, describe, it } from "vitest";

import { abi as seerMarketAbi } from "../../abis/SeerMarket";
import { FIRST_CHILD, METADATA_CID, METADATA_URI, SECOND_CHILD, SESSION_METADATA } from "../fixtures/sessionMetadata";

const MARKET_NAME = "Which director for Dune: Part Three?";
const OUTCOMES = ["Villeneuve", "Gerwig"];
const CHILD_MARKET_NAME = "Opening weekend [USD millions]";
const LOWER_BOUND = 10_000_000n;
const UPPER_BOUND = 500_000_000n;

const PARENT_MARKET = "0x0000000000000000000000000000000000000a11" as const;
const CHILD_MARKET_0 = "0x0000000000000000000000000000000000000c00" as const;
const CHILD_MARKET_1 = "0x0000000000000000000000000000000000000c01" as const;
const DEPLOYER = "0x0000000000000000000000000000000000000de9" as const;

/**
 * Blocks sit far above any local deploy. config.yaml's `start_block` is generated from
 * whichever block the hardhat deploy landed on, and an event below it is filtered out
 * before any handler runs - the test indexer also refuses a `startBlock` under the
 * config's, so headroom is the way to stay independent of it.
 */
const BLOCK = 1_000;

const ESCAPING_METADATA_URI = "ipfs://../../admin/purge";

const marketReads: Record<string, Record<string, unknown>> = {
  [PARENT_MARKET]: { marketName: MARKET_NAME, outcomes: OUTCOMES },
  [CHILD_MARKET_0]: { marketName: CHILD_MARKET_NAME, lowerBound: LOWER_BOUND, upperBound: UPPER_BOUND },
  [CHILD_MARKET_1]: { marketName: CHILD_MARKET_NAME, lowerBound: LOWER_BOUND, upperBound: UPPER_BOUND },
};

const ethCall = (params: [{ to: string; data: Hex }]) => {
  const { to, data } = params[0];
  const { functionName, args } = decodeFunctionData({ abi: seerMarketAbi, data });
  const reads = marketReads[to.toLowerCase()] ?? {};

  const result =
    functionName === "outcomes" ? (reads.outcomes as string[] | undefined)?.[Number(args?.[0])] : reads[functionName];

  // an address we know nothing about behaves like a market that is not there
  if (result === undefined) throw new Error(`no value for ${functionName} on ${to}`);

  return encodeFunctionResult({ abi: seerMarketAbi, functionName, result } as never);
};

type RpcCall = { id: number; method: string; params: never };

const answer = (call: RpcCall) => {
  try {
    return { jsonrpc: "2.0", id: call.id, result: call.method === "eth_call" ? ethCall(call.params) : "0x7a69" };
  } catch (error) {
    return { jsonrpc: "2.0", id: call.id, error: { code: 3, message: "execution reverted", data: String(error) } };
  }
};

let server: Server;

// creates a server to mock the ENVIO RPC URL AND IPFS GATEWAY
beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.method === "GET") {
      const cid = request.url?.replace("/ipfs/", "");
      if (cid !== METADATA_CID) {
        response.writeHead(404).end();

        return;
      }

      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(SESSION_METADATA));

      return;
    }

    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      // the client batches, so a body is either one call or an array of them - and a
      // batched request must come back as an array or viem cannot match up the ids
      const payload = JSON.parse(body) as RpcCall | RpcCall[];
      const calls = Array.isArray(payload) ? payload : [payload];
      const answers = calls.map(answer);

      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(Array.isArray(payload) ? answers : answers[0]));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as AddressInfo;
  process.env.ENVIO_RPC_URL = `http://127.0.0.1:${port}`;
  // tried first, so every document these tests use resolves here and the public
  // fallbacks are never reached
  process.env.ENVIO_IPFS_GATEWAY = `http://127.0.0.1:${port}/ipfs`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const parentDeployed = (block: number, metadataUri = METADATA_URI, sessionId = 0n) => ({
  contract: "SessionFactory" as const,
  event: "ParentMarketDeployed" as const,
  block: { number: block, timestamp: block },
  params: {
    sessionId,
    deployer: DEPLOYER,
    parentMarket: PARENT_MARKET,
    outcomeCount: BigInt(OUTCOMES.length),
    metadataUri,
  },
});

const childDeployed = (block: number, outcomeIndex: number, childMarket: Address, sessionId = 0n) => ({
  contract: "SessionFactory" as const,
  event: "ChildMarketDeployed" as const,
  block: { number: block, timestamp: block },
  params: {
    sessionId,
    parentOutcomeIndex: BigInt(outcomeIndex),
    childMarket,
    parentMarket: PARENT_MARKET,
  },
});

type Simulated = ReturnType<typeof parentDeployed> | ReturnType<typeof childDeployed>;

const indexEvents = (indexer: ReturnType<typeof createTestIndexer>, simulate: Simulated[]) =>
  indexer.process({ chains: { 31337: { simulate } } });

describe("SessionFactory indexing", () => {
  it("indexes an atomic deploy as a completed session, joined to its document", async (t) => {
    const indexer = createTestIndexer();

    await indexEvents(indexer, [
      parentDeployed(BLOCK),
      childDeployed(BLOCK, 0, CHILD_MARKET_0),
      childDeployed(BLOCK, 1, CHILD_MARKET_1),
    ]);

    const session = await indexer.Session.getOrThrow("0");
    t.expect(session.sessionId).toBe(0n);
    t.expect(session.deployer).toBe(DEPLOYER);
    t.expect(session.parentMarket).toBe(PARENT_MARKET);
    t.expect(session.outcomeCount).toBe(2n);
    t.expect(session.deployedChildCount).toBe(2n);
    t.expect(session.completedAt).toBe(BigInt(BLOCK));
    t.expect(session.marketName).toBe(MARKET_NAME);
    t.expect(session.outcomes).toEqual(OUTCOMES);
    t.expect(session.metadataUri).toBe(METADATA_URI);
    t.expect(session.metadataResolved).toBe(true);
    t.expect(session.title).toBe(SESSION_METADATA.session.title);
    t.expect(session.itemNamePlural).toBe(SESSION_METADATA.session.itemNamePlural);
    t.expect(session.blocks).toEqual(SESSION_METADATA.session.blocks);
    // keyword is matched with `_ilike`, so what has to hold is that every term someone
    // might search for is findable in it - not the order they were concatenated in
    for (const term of [
      MARKET_NAME,
      ...OUTCOMES,
      SESSION_METADATA.session.title,
      SESSION_METADATA.session.description,
      FIRST_CHILD.displayName,
      SECOND_CHILD.displayName,
    ]) {
      t.expect(session.keyword, `searching "${term}"`).toContain(term);
    }
    // and that they stay separated: run two together and a search for one branch starts
    // matching the pair
    t.expect(session.keyword).not.toContain(`${FIRST_CHILD.displayName}${SECOND_CHILD.displayName}`);

    const child = await indexer.ChildMarket.getOrThrow(CHILD_MARKET_0);
    t.expect(child.session_id).toBe("0");
    t.expect(child.parentOutcomeIndex).toBe(0n);
    t.expect(child.parentOutcome).toBe("Villeneuve");
    t.expect(child.marketName).toBe(CHILD_MARKET_NAME);
    t.expect(child.lowerBound).toBe(LOWER_BOUND);
    t.expect(child.upperBound).toBe(UPPER_BOUND);
    t.expect(child.displayName).toBe(FIRST_CHILD.displayName);
    t.expect(child.color).toBe(FIRST_CHILD.color);
    t.expect(child.blocks).toEqual(FIRST_CHILD.blocks);

    // the join is by outcomeIndex, so the second branch must get the second entry
    const second = await indexer.ChildMarket.getOrThrow(CHILD_MARKET_1);
    t.expect(second.parentOutcomeIndex).toBe(1n);
    t.expect(second.parentOutcome).toBe("Gerwig");
    t.expect(second.displayName).toBe(SECOND_CHILD.displayName);
  });

  it("counts children as a phased deploy progresses, completing on the last", async (t) => {
    const indexer = createTestIndexer();

    await indexEvents(indexer, [parentDeployed(BLOCK), childDeployed(BLOCK + 1, 0, CHILD_MARKET_0)]);

    let session = await indexer.Session.getOrThrow("0");
    t.expect(session.deployedChildCount).toBe(1n);
    t.expect(session.completedAt).toBe(0n);

    await indexEvents(indexer, [childDeployed(BLOCK + 2, 1, CHILD_MARKET_1)]);

    session = await indexer.Session.getOrThrow("0");
    t.expect(session.deployedChildCount).toBe(2n);
    t.expect(session.completedAt).toBe(BigInt(BLOCK + 2));
  });

  it("still indexes a session whose uri we refuse to request", async (t) => {
    const indexer = createTestIndexer();

    await indexEvents(indexer, [parentDeployed(BLOCK, ESCAPING_METADATA_URI)]);

    const session = await indexer.Session.getOrThrow("0");
    t.expect(session.metadataResolved).toBe(false);
    t.expect(session.title).toBeUndefined();
    t.expect(session.marketName).toBe(MARKET_NAME);

    // the document contributed nothing, and the fields it would have filled must collapse
    // rather than leave gaps a search would have to match through
    t.expect(session.keyword).toBe(session.keyword.trim());
    t.expect(session.keyword).not.toMatch(/\s{2}/);
  });

  it("skips a child whose session was never opened, since the contract cannot emit one", async (t) => {
    const indexer = createTestIndexer();

    await indexEvents(indexer, [
      parentDeployed(BLOCK),
      childDeployed(BLOCK, 0, CHILD_MARKET_0),
      // same batch, naming a session no ParentMarketDeployed ever opened
      childDeployed(BLOCK, 1, CHILD_MARKET_1, 7n),
    ]);

    await indexer.ChildMarket.getOrThrow(CHILD_MARKET_0);
    t.expect(await indexer.ChildMarket.get(CHILD_MARKET_1)).toBeUndefined();
    t.expect((await indexer.Session.getOrThrow("0")).deployedChildCount).toBe(1n);
  });

  it("indexes a market that cannot be read, rather than dropping the session", async (t) => {
    const indexer = createTestIndexer();
    const unknownMarket = "0x00000000000000000000000000000000000dead0" as const;

    await indexEvents(indexer, [parentDeployed(BLOCK), childDeployed(BLOCK, 0, unknownMarket)]);

    const child = await indexer.ChildMarket.getOrThrow(unknownMarket);
    t.expect(child.marketName).toBe("");
    t.expect(child.lowerBound).toBe(0n);
    t.expect(child.upperBound).toBe(0n);
    // still counted, because the chain says the branch exists
    t.expect((await indexer.Session.getOrThrow("0")).deployedChildCount).toBe(1n);
  });
});
