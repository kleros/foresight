import type { ReactNode } from "react";

import { isUserRejection } from "@foresight/tx-orchestrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { connect, createConfig, custom, disconnect, injected } from "@wagmi/core";
import { gnosis } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OWNER } from "@/features/resolution/redeem/__tests__/support/session";
import { createRedeemRun } from "@/features/resolution/redeem/run";

import { answeredWithoutPrompt, refusedAsBatch, walletConnectRejection } from "@/lib/web3/walletAnswers";

import { useWalletRedeemRun } from "../useWalletRedeem";

/** An EIP-1193 provider of one account on gnosis that answers wallet_getCapabilities as `answer` gives. */
const provider = vi.hoisted(() => {
  const answer = { capabilities: {} as unknown, accounts: [] as string[], sendCallsCode: 4200 };
  const request = vi.fn(async ({ method }: { method: string; params?: unknown }): Promise<unknown> => {
    switch (method) {
      case "eth_chainId":
        return "0x64";
      case "eth_accounts":
      case "eth_requestAccounts":
        return answer.accounts;
      case "wallet_requestPermissions":
        return [{ parentCapability: "eth_accounts" }];
      case "wallet_getCapabilities":
        return answer.capabilities;
      case "wallet_sendCalls":
        throw Object.assign(new Error("The wallet refused the request."), { code: answer.sendCallsCode });
      default:
        throw Object.assign(new Error(`Unexpected ${method}`), { code: 4200 });
    }
  });
  return { answer, request, on: vi.fn(), removeListener: vi.fn() };
});

const config = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@/lib/web3/wagmi", () => ({
  get wagmiConfig() {
    return config.current;
  },
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: OWNER, chainId: 100 }) }));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/features/resolution/redeem/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/redeem/run")>()),
  createRedeemRun: vi.fn(),
}));

const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as const, sessionId: 7n };

const IDLE = { stage: "idle" } as const;

let wagmi: ReturnType<typeof createConfig>;
let client: QueryClient;

beforeEach(async () => {
  provider.answer.accounts = [OWNER];
  provider.answer.sendCallsCode = 4200;
  wagmi = createConfig({
    chains: [gnosis],
    connectors: [injected({ target: () => ({ id: "test", name: "Test", provider: provider as never }) })],
    transports: { [gnosis.id]: custom({ request: async () => null }) },
  });
  config.current = wagmi;
  await connect(wagmi, { connector: wagmi.connectors[0]!, chainId: gnosis.id });
  provider.request.mockClear();
  vi.mocked(createRedeemRun).mockReset();
  vi.mocked(createRedeemRun).mockReturnValue({
    start: vi.fn(),
    recover: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    discard: vi.fn(async () => {}),
    dispose: vi.fn(),
    getProgress: () => IDLE,
    subscribe: () => () => {},
  });
  client = new QueryClient();
});

afterEach(async () => {
  await disconnect(wagmi);
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

describe("useWalletRedeemRun's wallet", () => {
  it("asks the connected wallet's own provider for its capabilities and returns its answer as given", async () => {
    const answer = { "0x64": { atomic: { status: "ready" } } };
    provider.answer.capabilities = answer;
    renderHook(() => useWalletRedeemRun(SESSION), { wrapper });
    await waitFor(() => expect(createRedeemRun).toHaveBeenCalled());
    const [args] = vi.mocked(createRedeemRun).mock.calls[0]!;

    const got = await args.wallet.request({ method: "wallet_getCapabilities", params: [OWNER, ["0x64"]] });

    expect(got).toEqual(answer);
    expect(provider.request.mock.calls.map(([asked]) => asked)).toContainEqual({
      method: "wallet_getCapabilities",
      params: [OWNER, ["0x64"]],
    });
  });

  it("passes on the wallet's own error, with its code", async () => {
    renderHook(() => useWalletRedeemRun(SESSION), { wrapper });
    await waitFor(() => expect(createRedeemRun).toHaveBeenCalled());
    const [args] = vi.mocked(createRedeemRun).mock.calls[0]!;

    const asked = args.wallet.request({ method: "wallet_sendCalls", params: [{}] });

    await expect(asked).rejects.toSatisfy(answeredWithoutPrompt);
  });

  it.each([5700, 5710, 5740, 5750, 5760])(
    "passes on a batch refused with %i as a refusal of the batch, not a decline",
    async (code) => {
      provider.answer.sendCallsCode = code;
      renderHook(() => useWalletRedeemRun(SESSION), { wrapper });
      await waitFor(() => expect(createRedeemRun).toHaveBeenCalled());
      const [args] = vi.mocked(createRedeemRun).mock.calls[0]!;

      const error = await args.wallet.request({ method: "wallet_sendCalls", params: [{}] }).catch((each) => each);

      expect(refusedAsBatch(error)).toBe(true);
      expect(answeredWithoutPrompt(error)).toBe(true);
      expect(isUserRejection(error)).toBe(false);
      expect(walletConnectRejection(error)).toBe(false);
    },
  );
});
