import { useId, useState } from "react";

import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";
import { useAccount } from "wagmi";

import WithHelpTooltip from "@/components/ui/WithHelpTooltip";

import { shortenAddress } from "@/utils/address";
import { ownedAmount } from "@/utils/amount";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { creditsContracts, creditsRoute, gnosisRouterAddress, sDaiDepositRoute } from "@/config/contracts";
import { explorerAddressUrl } from "@/config/site";

import { AmountDialog } from "./AmountDialog";
import { OptionBalances } from "./OptionBalances";
import { TRADE_WALLET_CARD } from "./tradeWalletCard";
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

/**
 * The connected account's executor, shown once it exists on chain, as one row: its collateral
 * balance, Deposit and Withdraw, and behind Balances its outcome balances with Mint and Merge.
 */
export function TradeWallet({
  market,
  noun,
}: {
  market: TradeWalletMarket;
  /** Singular, as in "movie tokens". */
  noun: string;
}) {
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [showBalances, setShowBalances] = useState(false);
  const balancesId = useId();
  const close = () => setDialog(null);

  const { address: owner, chain, chainId } = useAccount();
  const executor = useExecutor();
  const deployed = executor.data?.deployed ?? null;

  const { collateral, options, parentMarket, invalidToken } = market;
  const funds = useFunds(deployed ?? undefined, collateral.address);
  // INVALID rides along because a merge burns it too, so it bounds the amount like the rest
  const outcomeTokens = [...options.map((option) => option.token), invalidToken];
  const balances = useTokenBalances(deployed ?? undefined, outcomeTokens);
  const positionTokens = options.flatMap((option) => option.positions.map((position) => position.token));
  const positionBalances = useTokenBalances(deployed ?? undefined, positionTokens);
  const held = positionBalances.data;
  const heldByToken = held && new Map(positionTokens.map((token, index) => [token, held[index]]));

  const creditsToken = creditsContracts(DEFAULT_CHAIN_ID)?.credits;
  // the credits swap pays WXDAI and splits only its floor, so the rest waits here to be withdrawn
  const wxdai = creditsRoute(collateral.address, DEFAULT_CHAIN_ID)?.wxdai;
  const withdrawable = [
    ...(creditsToken ? [{ address: creditsToken, symbol: "credits" }] : []),
    ...(wxdai ? [{ address: wxdai, symbol: "WXDAI" }] : []),
  ];
  const withdrawableHeld = useTokenBalances(
    deployed ?? undefined,
    withdrawable.map((token) => token.address),
  ).data;

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
      <section aria-label="Trade wallet" className={clsx(TRADE_WALLET_CARD, "flex flex-col")}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 max-sm:w-full">
            <WithHelpTooltip
              label="About the trade wallet"
              tooltipMsg="Holds the money behind your predictions and places them all in one transaction."
            >
              <h3 className="text-fs-text-primary text-sm font-semibold">Trade wallet</h3>
            </WithHelpTooltip>
            {explorer ? (
              <a
                href={explorer}
                target="_blank"
                rel="noopener noreferrer"
                className="text-fs-text-secondary hover:text-fs-accent text-sm"
              >
                {shortenAddress(deployed)}
              </a>
            ) : (
              <span className="text-fs-text-secondary text-sm">{shortenAddress(deployed)}</span>
            )}
            <span className="text-fs-text-primary text-sm font-semibold tabular-nums">
              {funds.isPending ? (
                <span className="fs-skeleton inline-block h-5 w-16 align-middle" />
              ) : funds.data ? (
                `${ownedAmount(funds.data.token ?? 0n, collateral.decimals)} ${collateral.symbol}`
              ) : (
                // a balance we could not read must not read as an empty wallet
                <span className="text-fs-text-secondary font-normal">Could not read balance</span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            <Button variant="secondary" small text="Deposit" onPress={() => setDialog("deposit")} />
            <Button variant="secondary" small text="Withdraw" onPress={() => setDialog("withdraw")} />
            <button
              type="button"
              aria-expanded={showBalances}
              aria-controls={balancesId}
              onClick={() => setShowBalances((open) => !open)}
              className="text-fs-text-secondary hover:text-fs-text-primary fs-echo flex min-h-11 cursor-pointer items-center gap-1 px-2 text-sm"
            >
              Balances
              {/* Disclosure's plus and minus, so every collapsible on the page reads alike */}
              <svg viewBox="0 0 16 16" aria-hidden className="size-3 shrink-0 fill-current">
                {showBalances ? (
                  <path d="M0 7.2h16v1.6H0z" />
                ) : (
                  <path d="M7.2 0h1.6v7.2H16v1.6H8.8V16H7.2V8.8H0V7.2h7.2z" />
                )}
              </svg>
            </button>
          </div>
        </div>

        <div id={balancesId} hidden={!showBalances} className="flex flex-col gap-4 pt-4">
          <OptionBalances
            options={options}
            balances={balances.data?.slice(0, options.length)}
            positions={heldByToken}
            noun={noun}
            decimals={collateral.decimals}
          />
          {canConvert ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" small text="Mint" onPress={() => setDialog("mint")} />
              <Button variant="secondary" small text="Merge" onPress={() => setDialog("merge")} />
            </div>
          ) : null}
        </div>
      </section>

      {dialog === "deposit" ? (
        <TransferDialog
          isOpen
          onClose={close}
          title="Deposit"
          hint="From your wallet to your trade wallet"
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
          hint="From your trade wallet to your wallet"
          actionText="Withdraw"
          source={deployed}
          collateral={collateral}
          native={chain && { symbol: chain.nativeCurrency.symbol, decimals: chain.nativeCurrency.decimals }}
          held={withdrawable.map((token, index) => ({
            ...token,
            decimals: 18,
            balance: withdrawableHeld?.[index] ?? 0n,
          }))}
          onSubmit={(asset) => withdraw.mutate({ executor: deployed, recipient: owner, assets: [asset] })}
          isPending={withdraw.isPending}
          // what is shown is cut to four decimals, and a cut Max would leave dust behind
          maxIsExact
        />
      ) : null}

      {dialog === "mint" ? (
        <AmountDialog
          isOpen
          onClose={close}
          title={`Mint ${noun} tokens`}
          hint={`Turns ${collateral.symbol} in your trade wallet into ${noun} tokens.`}
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
          hint={`Turns a full set of ${noun} tokens back into ${collateral.symbol} in your trade wallet.`}
          actionText="Merge"
          available={mergeable}
          isLoadingBalance={balances.isPending}
          decimals={collateral.decimals}
          availableLabel="Full sets"
          overText="Not enough sets."
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
