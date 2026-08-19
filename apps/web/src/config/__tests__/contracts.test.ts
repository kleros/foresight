import { gnosis, hardhat } from "viem/chains";
import { describe, it } from "vitest";

import { sessionFactoryAddress } from "../contracts";

describe("sessionFactoryAddress", () => {
  it("resolves every deployed network", (t) => {
    t.expect(sessionFactoryAddress(gnosis.id)).not.toBeNull();
    t.expect(sessionFactoryAddress(hardhat.id)).not.toBeNull();
    t.expect(sessionFactoryAddress(1)).toBeNull();
  });
});
