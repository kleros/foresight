import { describe, expect, it } from "vitest";

import { chain } from "./world";
import { owner } from "../../../flow/__tests__/support/session";

const tx = { to: owner, data: "0x", value: 0n } as const;
const at = (nonce: number) => ({ owner, nonce, fromBlock: 0n });

describe("the fake chain's nonce answers", () => {
  it("reads a broadcast, unmined send as pending at its nonce and for the account", async () => {
    const fake = chain();
    fake.broadcast(tx, owner, true);
    fake.broadcast(tx, owner, false);

    expect(await fake.reader.nextNonce(owner)).toBe(1);
    expect(await fake.reader.hasPending(owner)).toBe(true);
    expect((await fake.reader.sentWithNonce(at(1))).status).toBe("pending");
  });

  it("reads a send its node's mempool never had as nothing, at its nonce and for the account", async () => {
    const fake = chain();
    fake.broadcast(tx, owner, false);
    fake.state.mempool = false;

    expect(await fake.reader.hasPending(owner)).toBe(false);
    expect((await fake.reader.sentWithNonce(at(0))).status).toBe("none");
  });

  it("reads a mined send at its nonce from the block it mined in, and as taken before it", async () => {
    const fake = chain();
    const sent = fake.broadcast(tx, owner, true);

    expect(await fake.reader.sentWithNonce(at(0))).toMatchObject({ status: "mined", hash: sent.hash });
    expect((await fake.reader.sentWithNonce({ owner, nonce: 0, fromBlock: sent.minedIn! + 1n })).status).toBe("taken");
  });
});
