import { useState } from "react";

import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";
import { useAccount } from "wagmi";

import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import WithHelpTooltip from "@/components/ui/WithHelpTooltip";

import WalletIcon from "@/assets/svg/wallet.svg";

import { shortenAddress } from "@/utils/address";
import { formatAmount } from "@/utils/amount";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { gnosisRouterAddress, sDaiDepositRoute } from "@/config/contracts";
import { explorerAddressUrl } from "@/config/site";

import { AmountDialog } from "./AmountDialog";
import { OptionBalances } from "./OptionBalances";
import { TradeWalletSkeleton } from "./TradeWalletSkeleton";
import { TransferDialog } from "./TransferDialog";
import { useDepositToExecutor } from "../../api/depositToExecutor";
import { useExecutor } from "../../api/getExecutor";
import { useFunds } from "../../api/getFunds";
import { useTokenBalances } from "../../api/getTokenBalances";
import { useMergeFromExecutor } from "../../api/mergeFromExecutor";
import { useSplitFromExecutor } from "../../api/splitFromExecutor";
import { useWithdrawFromExecutor } from "../../api/withdrawFromExecutor";
import type { TradeWalletMarket } from "../../types";

type OpenDialog = "deposit" | "withdraw" | "mint" | "merge" | null;

const ADVANCED = [
  { id: "mint", text: "Mint" },
  { id: "merge", text: "Merge" },
];

/**
 * The connected account's executor, shown once it exists on chain: its collateral and outcome
 * balances for this parent market, and the actions that move value in, out, and between them.
 */
export function TradeWallet({ market, noun }: { market: TradeWalletMarket; noun: string }) {
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const close = () => setDialog(null);

  const { address: owner, chain, chainId } = useAccount();
  const executor = useExecutor();
  const deployed = executor.data?.deployed ?? null;

  const { collateral, options, parentMarket, invalidToken } = market;
  const funds = useFunds(deployed ?? undefined, collateral.address);
  // INVALID rides along because a merge burns it too, so it bounds the amount like the rest
  const outcomeTokens = [...options.map((option) => option.token), invalidToken];
  const balances = useTokenBalances(deployed ?? undefined, outcomeTokens);

  const deposit = useDepositToExecutor(close);
  const withdraw = useWithdrawFromExecutor(close);
  const mint = useSplitFromExecutor(close);
  const merge = useMergeFromExecutor(close);

  // reads all go to DEFAULT_CHAIN, so a wallet on another one would be shown someone else's balances
  if (!owner || chainId !== DEFAULT_CHAIN_ID) return null;
  if (executor.isPending) return <TradeWalletSkeleton />;
  // the predict flow is what creates it; until then there is nothing to show
  if (!deployed) return null;

  const explorer = chain && explorerAddressUrl(deployed, chain);
  const sDaiRoute = sDaiDepositRoute(collateral.address);
  const native =
    sDaiRoute && chain ? { symbol: chain.nativeCurrency.symbol, decimals: chain.nativeCurrency.decimals } : undefined;
  // a merge burns the whole set at once, so the smallest holding is the ceiling
  const mergeable = balances.data?.length
    ? balances.data.reduce((least, balance) => (balance < least ? balance : least))
    : undefined;
  const canConvert = gnosisRouterAddress() !== null;

  return (
    <>
      <SectionCard className="flex flex-col gap-4 px-4 py-6 md:px-8">
        <div className="flex flex-col max-md:gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-4">
            <div className="flex flex-col items-start gap-1.5">
              <div className="flex items-center gap-2">
                <WalletIcon className="text-fs-accent size-4" />
                <WithHelpTooltip tooltipMsg="Holds the money behind your predictions and places them all in one transaction.">
                  <h3 className="text-fs-text-primary text-base font-semibold">Trade wallet</h3>
                </WithHelpTooltip>
              </div>
              {explorer ? (
                <a
                  href={explorer}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fs-text-secondary hover:text-fs-accent text-sm break-all"
                >
                  {shortenAddress(deployed)}
                </a>
              ) : (
                <span className="text-fs-text-secondary text-sm break-all">{shortenAddress(deployed)}</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" small text="Deposit" onPress={() => setDialog("deposit")} />
              <Button variant="secondary" small text="Withdraw" onPress={() => setDialog("withdraw")} />
              {canConvert ? (
                <Select
                  label="Advanced options"
                  hideLabel
                  placeholder="Advanced options"
                  variant="menu"
                  options={ADVANCED}
                  value=""
                  onChange={(id) => setDialog(id as OpenDialog)}
                />
              ) : null}
            </div>
          </div>

          <div
            className={clsx(
              "flex h-full flex-col items-start p-6 max-md:pl-0",
              "border-fs-border border-t md:border-t-0 md:border-l",
            )}
          >
            <h4 className="text-fs-text-secondary text-sm">{collateral.symbol} balance</h4>
            <p className="text-fs-text-primary text-2xl font-semibold">
              {funds.isPending ? (
                <span className="fs-skeleton inline-block h-7 w-20 align-middle" />
              ) : funds.data ? (
                formatAmount(funds.data.token ?? 0n, collateral.decimals)
              ) : (
                // a balance we could not read must not read as an empty wallet
                <span className="text-fs-text-secondary text-base font-normal">Could not read</span>
              )}
            </p>
          </div>
        </div>

        <OptionBalances
          options={options}
          balances={balances.data?.slice(0, options.length)}
          noun={noun}
          decimals={collateral.decimals}
        />
      </SectionCard>

      {dialog === "deposit" ? (
        <TransferDialog
          isOpen
          onClose={close}
          title="Deposit"
          hint="Deposit from your account to trade wallet"
          actionText="Deposit"
          source={owner}
          collateral={collateral}
          native={native}
          onSubmit={(asset) => deposit.mutate({ executor: deployed, asset, sDaiAdapter: sDaiRoute?.sDaiAdapter })}
          isPending={deposit.isPending}
        />
      ) : null}

      {dialog === "withdraw" ? (
        <TransferDialog
          isOpen
          onClose={close}
          title="Withdraw"
          hint="Withdraw from trade wallet to your account"
          actionText="Withdraw"
          source={deployed}
          collateral={collateral}
          native={chain && { symbol: chain.nativeCurrency.symbol, decimals: chain.nativeCurrency.decimals }}
          onSubmit={(asset) => withdraw.mutate({ executor: deployed, recipient: owner, assets: [asset] })}
          isPending={withdraw.isPending}
        />
      ) : null}

      {dialog === "mint" ? (
        <AmountDialog
          isOpen
          onClose={close}
          title={`Mint ${noun} tokens`}
          hint={`Mint ${noun} tokens to your trade wallet`}
          actionText="Mint"
          available={funds.data?.token ?? undefined}
          isLoadingBalance={funds.isPending}
          decimals={collateral.decimals}
          symbol={collateral.symbol}
          onSubmit={(amount) =>
            mint.mutate({ executor: deployed, collateral: collateral.address, parentMarket, amount })
          }
          isPending={mint.isPending}
        />
      ) : null}

      {dialog === "merge" ? (
        <AmountDialog
          isOpen
          onClose={close}
          title={`Merge ${noun} tokens`}
          hint={`Merge ${noun} tokens to your account`}
          actionText="Merge"
          available={mergeable}
          isLoadingBalance={balances.isPending}
          decimals={collateral.decimals}
          symbol={collateral.symbol}
          onSubmit={(amount) =>
            merge.mutate({
              executor: deployed,
              collateral: collateral.address,
              parentMarket,
              outcomeTokens: options.map((option) => option.token),
              invalidToken,
              amount,
            })
          }
          isPending={merge.isPending}
        />
      ) : null}
    </>
  );
}
