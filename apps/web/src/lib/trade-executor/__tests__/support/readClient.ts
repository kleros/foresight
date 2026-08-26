import { createPublicClient, type Address, type Hex } from "viem";
import { custom } from "viem";

type EthCall = { to: Address; data: Hex };

/**
 * A real viem client over a transport that answers `eth_call` (and optionally
 * `eth_getBalance`) from the test, so the module under test runs viem's own
 * ABI encoding against responses the test spells out.
 */
export function readClient(handlers: { call: (call: EthCall) => Hex; balance?: (address: Address) => bigint }) {
  return createPublicClient({
    transport: custom(
      {
        request: async ({ method, params }: { method: string; params: unknown[] }) => {
          if (method === "eth_call") {
            const [call] = params as [EthCall];
            return handlers.call(call);
          }
          if (method === "eth_getBalance" && handlers.balance) {
            const [address] = params as [Address];
            return `0x${handlers.balance(address).toString(16)}`;
          }
          throw new Error(`unstubbed RPC call: ${method}`);
        },
      },
      { retryCount: 0 },
    ),
  });
}
