"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import {
  createFlowRunStore,
  createMemoryStorage,
  createViemTxGateway,
  fromWebStorage,
  type FlowRunStore,
} from "@foresight/tx-orchestrator";
import { useAtlasProvider } from "@kleros/kleros-app";
import { sendTransaction } from "@wagmi/core";
import { useAccount } from "wagmi";

import { createMetadataUploader } from "@/lib/atlas/ipfs";
import { DOCUMENT_UPLOAD_ROLE, IMAGE_UPLOAD_ROLE } from "@/lib/atlas/uploads";
import { fetchGraphql } from "@/lib/graphql/batcher";
import { publicClient } from "@/lib/web3/public-client";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { sessionFactoryAddress } from "@/config/contracts";
import { IPFS_GATEWAY } from "@/config/ipfs";

import { createIndexedProbe } from "../deploy/indexedProbe";
import { createOrchestratedDeploy } from "../deploy/orchestratedDriver";
import { createIndexerSessionLookup } from "../deploy/sessionLookup";
import { toDeployInput, toMetadataInput } from "../deploy/toDeployInput";
import type { SessionDeployDriver, SessionDeployProgress } from "../deploy/types";
import { useDraftStore } from "../stores/draftStore";
import { getImageFile } from "../stores/imageStore";

function createRunStore(): FlowRunStore {
  const storage = typeof window === "undefined" ? createMemoryStorage() : fromWebStorage(window.localStorage);
  return createFlowRunStore({ storage });
}

export function useSessionDeploy(outcomeCount: number): {
  driver: SessionDeployDriver;
  progress: SessionDeployProgress;
} {
  const { address, chainId } = useAccount();
  const factory = sessionFactoryAddress(chainId ?? DEFAULT_CHAIN_ID);

  const draftStore = useDraftStore;

  const atlas = useAtlasProvider();
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;

  const storeRef = useRef<FlowRunStore | undefined>(undefined);
  storeRef.current ??= createRunStore();

  const driver = useMemo<SessionDeployDriver>(
    () =>
      createOrchestratedDeploy({
        gateway: createViemTxGateway({
          client: publicClient,
          sendTransaction: (tx) => sendTransaction(wagmiConfig, { to: tx.to, data: tx.data, value: tx.value }),
        }),
        uploader: createMetadataUploader({
          uploadImage: (file) => atlasRef.current.uploadFile(file, IMAGE_UPLOAD_ROLE),
          uploadDocument: (file) => atlasRef.current.uploadFile(file, DOCUMENT_UPLOAD_ROLE),
          gateway: IPFS_GATEWAY,
        }),
        outcomeCount,
        store: storeRef.current,
        // Uncached: viem holds a block number for `cacheTime`.
        findSession: createIndexerSessionLookup(fetchGraphql, () => publicClient.getBlockNumber({ cacheTime: 0 })),
        awaitIndexed: createIndexedProbe(fetchGraphql),
        chainTime: async () => Number((await publicClient.getBlock({ blockTag: "latest" })).timestamp),
        flowId: "session-create-draft",
        ctx: () => {
          if (!address) throw new Error("Connect the wallet you want to deploy from.");
          if (!factory) throw new Error("There is no session factory on this network.");
          return { chainId: chainId ?? DEFAULT_CHAIN_ID, factory, deployer: address };
        },
        sources: () => {
          const { draft } = draftStore.getState();
          const hero = getImageFile("hero");
          if (!hero) throw new Error("Pick a hero image before deploying.");
          return {
            deploy: toDeployInput(draft),
            metadata: toMetadataInput(draft),
            images: { hero, icon: getImageFile("icon") },
          };
        },
      }),
    [address, factory, chainId, outcomeCount, draftStore],
  );

  // A wallet or chain change builds a new driver. The old one is let go of
  // rather than left running: its run is in storage, and this one recovers it.
  useEffect(() => {
    driver.recover();
    return () => driver.dispose();
  }, [driver]);

  const progress = useSyncExternalStore(
    (cb) => driver.subscribe(cb),
    () => driver.getProgress(),
    () => driver.getProgress(),
  );

  return { driver, progress };
}
