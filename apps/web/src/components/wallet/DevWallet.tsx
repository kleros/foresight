"use client";

import { useState } from "react";

import { useAccount, useDisconnect } from "wagmi";

import { isMockWalletEnabled, MOCK_ACCOUNTS, type MockAccountName } from "@/lib/web3/mock-account";
import { connectMockAccount } from "@/lib/web3/mock-wallet";

import { DEFAULT_CHAIN } from "@/config/chains";

/**
 * Connect as one of Hardhat's unlocked accounts, without a browser wallet.
 *
 * These accounts are unlocked on the node, so `eth_sendTransaction` and
 * `personal_sign` are answered by Hardhat itself.
 */
export function DevWallet() {
  const { address, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const [busy, setBusy] = useState<MockAccountName | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isMockWalletEnabled) return null;

  const connected = Object.entries(MOCK_ACCOUNTS).find(
    ([, candidate]) => candidate.toLowerCase() === address?.toLowerCase(),
  );

  const connect = async (name: MockAccountName) => {
    setBusy(name);
    setError(null);
    try {
      await connectMockAccount(name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside
      className="rounded-fs bg-fs-surface border-fs-border fixed bottom-4 left-4 z-50 flex flex-col gap-2 border px-3 py-2.5 shadow-lg"
      aria-label="Development wallet"
    >
      <div className="type-caption text-fs-text-secondary flex items-center gap-2">
        <span className="bg-fs-status-registered h-1.5 w-1.5 rounded-full" aria-hidden />
        dev wallet · {DEFAULT_CHAIN.name}
      </div>

      {address ? (
        <div className="flex items-center gap-3">
          <span className="type-label text-fs-text-primary font-mono">
            {connected?.[0] ?? `${address.slice(0, 6)}…${address.slice(-4)}`}
          </span>
          {chainId !== DEFAULT_CHAIN.id ? (
            <span className="type-caption text-fs-status-pending">on chain {chainId}</span>
          ) : null}
          <button type="button" onClick={() => disconnect()} className="type-label text-fs-accent cursor-pointer">
            disconnect
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {(Object.keys(MOCK_ACCOUNTS) as MockAccountName[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => void connect(name)}
              disabled={busy !== null}
              className="rounded-fs border-fs-border type-label text-fs-text-primary hover:bg-fs-surface-tint cursor-pointer border px-2.5 py-1"
            >
              {busy === name ? "connecting…" : name}
            </button>
          ))}
        </div>
      )}

      {error ? <div className="type-caption text-fs-status-disputed max-w-60">{error}</div> : null}
    </aside>
  );
}
