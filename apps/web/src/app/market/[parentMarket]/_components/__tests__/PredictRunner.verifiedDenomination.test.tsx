import type { ReactNode } from "react";

import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { decodeFunctionData, erc20Abi, type Hash, type TransactionReceipt } from "viem";
import { afterEach, expect, it, vi } from "vitest";

import { PredictAmountSection } from "@/features/predict/components/PredictAmountSection";
import { addresses, ctx, fakeQuoter, fakeReader, snapshot, WAD } from "@/features/predict/flow/__tests__/support/fakes";
import { createPredictRun } from "@/features/predict/run/driver";
import type { PredictDriver } from "@/features/predict/run/types";
import { planFunding, fundingRequest } from "@/features/predict/utils/funding";
import { useSession } from "@/features/sessions/api/getSession";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { executorAddress } from "@/lib/trade-executor/executor";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/lib/web3/public-client", async () => ({
  publicClient: (await import("@/features/sessions/api/__tests__/support/verifiedSession")).verifiedClient,
}));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://example.test/ipfs" }));
vi.mock("@/config/chains", () => ({ DEFAULT_CHAIN_ID: 100 }));

const SDAI = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const OWNER = addresses.owner;
const EXECUTOR = executorAddress(addresses.factory, OWNER);
const drivers: PredictDriver[] = [];
afterEach(() => {
  drivers.splice(0).forEach((d) => d.dispose());
  vi.clearAllMocks();
});

function gateway() {
  const sends: FlowTx[] = [];
  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 1n, logs: [] }) as unknown as TransactionReceipt;
  const api: TxGateway = {
    sendTransaction: async (tx) => {
      sends.push(tx);
      return `0x${sends.length.toString(16).padStart(64, "0")}` as Hash;
    },
    waitForReceipt: async ({ hash }) => receipt(hash),
    getReceipt: async (hash) => receipt(hash),
    isKnown: async () => true,
  };
  return { sends, api };
}

it("uses the verified denomination when indexed decimals would multiply the signed deposit", async () => {
  vi.mocked(fetchGraphql).mockResolvedValue({
    Session: [
      {
        ...sessionDetailColumns,
        collateralToken: SDAI,
        collateralSymbol: "sDAI",
        collateralDecimals: 20,
        children: [sessionChildRow({ parentOutcomeIndex: "0" })],
      },
    ],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const session = renderHook(() => useSession(sessionDetailColumns.parentMarket), { wrapper });
  await waitFor(() => expect(session.result.current.isSuccess).toBe(true));
  const detail = session.result.current.data!;
  const token = { id: "collateral" as const, symbol: detail.collateralSymbol!, decimals: detail.collateralDecimals! };
  const onAmountChange = vi.fn();
  render(
    <PredictAmountSection
      amount={undefined}
      onAmountChange={onAmountChange}
      tokens={[token]}
      token={token}
      onTokenChange={vi.fn()}
      funding={planFunding({ amount: 0n, ownWallet: 100n * WAD, tradeWallet: 0n })}
      collateral={token}
      isFirstPrediction
      isReadOnly={false}
    />,
  );
  const input = screen.getByRole("spinbutton", { name: "Amount" });
  fireEvent.change(input, { target: { value: "1" } });
  fireEvent.blur(input);
  const amount = onAmountChange.mock.calls.at(-1)![0] as bigint;
  expect(amount).toBe(WAD);
  expect(input).toHaveValue("1");
  const funding = planFunding({ amount, ownWallet: 100n * WAD, tradeWallet: 0n });
  const { sends, api } = gateway();
  const driver = createPredictRun({
    gateway: api,
    reader: fakeReader({ deployed: true }),
    quoter: fakeQuoter(),
    flowId: "verified-decimals",
    store: createFlowRunStore({ storage: createMemoryStorage() }),
    ctx: () => ctx({ collateral: SDAI, executor: EXECUTOR }),
    snapshot: () => snapshot(fundingRequest(funding, false)),
  });
  drivers.push(driver);
  driver.start();
  await waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
  const deposit = sends.find((tx) => tx.to === SDAI)!;
  const decoded = decodeFunctionData({ abi: erc20Abi, data: deposit.data! });
  expect(decoded.functionName).toBe("transfer");
  expect(decoded.args).toEqual([EXECUTOR, WAD]);
});
