"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";

import { useAtlasProvider } from "@kleros/kleros-app";
import { AlertMessage, Button } from "@kleros/ui-components-library";
import clsx from "clsx";
import { usePrevious } from "react-use";
import { useAccount } from "wagmi";

import Loader from "@/components/ui/Loader";
import EnsureChain from "@/components/wallet/EnsureChain";

import CheckIcon from "@/assets/svg/check-circle.svg";

import { errorToast, infoToast, successToast } from "@/utils/toast";

import { paths } from "@/config/paths";

const pageLayoutClassName = clsx(
  "flex flex-col gap-x-4 gap-y-12 px-4 py-12 md:px-8 lg:px-32",
  "size-full items-center justify-center",
  "md:justify-between lg:flex-row",
);

/** How long to wait for a completed sign-in to verify before treating it as failed. */
const SIGN_IN_SETTLE_TIMEOUT_MS = 30_000;

const unsubscribeButtonClassName = clsx(
  "bg-klerosUIComponentsError! hover:bg-klerosUIComponentsError! hover:opacity-75",
  "border-klerosUIComponentsError! [&_.button-text]:text-wrap! [&_.button-text]:text-white!",
);

export function Unsubscribe() {
  const { address } = useAccount();
  const [isUnsubscribed, setIsUnsubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { isFetchingUser, isVerified, isSigningIn, isDeletingUser, authoriseUser, deleteUser, userExists } =
    useAtlasProvider();

  const [isPendingSignIn, setIsPendingSignIn] = useState(false);
  const prevIsFetchingUser = usePrevious(isFetchingUser);

  useEffect(() => {
    if (!address || !isVerified) {
      setIsLoading(false);
      return;
    }

    if (isFetchingUser) {
      setIsLoading(true);
      return;
    }

    if (prevIsFetchingUser) {
      setIsLoading(false);
      return;
    }

    const timeoutId = window.setTimeout(() => setIsLoading(false), 50);
    return () => window.clearTimeout(timeoutId);
  }, [address, isVerified, isFetchingUser, prevIsFetchingUser]);

  const isAlreadyUnsubscribed = !isLoading && Boolean(address) && isVerified && !userExists;
  const showSuccess = isUnsubscribed || isAlreadyUnsubscribed;

  const unsubscribe = useCallback(async () => {
    infoToast("Unsubscribing...");
    try {
      const res = await deleteUser();
      if (!res) {
        errorToast("Unsubscribe failed: Unknown error");
        return;
      }
      setIsUnsubscribed(true);
      successToast("You have been unsubscribed from notifications.");
    } catch (error) {
      if (error instanceof Error) errorToast(`Unsubscribe failed: ${error.message}`);
    }
  }, [deleteUser]);

  useEffect(() => {
    if (!isPendingSignIn) return;

    if (isVerified) {
      setIsPendingSignIn(false);
      void unsubscribe();
      return;
    }

    // Sign-in resolved but the token never verified - a token minted for another address, a clock skewed past its
    // expiry, a storage write that didn't stick. Fail loudly instead of spinning forever.
    const timeoutId = window.setTimeout(() => {
      setIsPendingSignIn(false);
      errorToast("Sign-in did not complete. Please try again.");
    }, SIGN_IN_SETTLE_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isPendingSignIn, isVerified, unsubscribe]);

  // A wallet switch mid-sign-in leaves the flag armed for a session that will never verify.
  useEffect(() => setIsPendingSignIn(false), [address]);

  const handleUnsubscribe = useCallback(async () => {
    if (!address) return;

    if (!isVerified) {
      infoToast("Signing in...");
      try {
        await authoriseUser();
        successToast("Signed in successfully!");
        setIsPendingSignIn(true);
      } catch (error) {
        if (error instanceof Error) errorToast(`Sign-in failed: ${error.message}`);
      }
      return;
    }

    await unsubscribe();
  }, [address, isVerified, authoriseUser, unsubscribe]);

  if (isLoading)
    return (
      <div className={pageLayoutClassName}>
        <Loader />
      </div>
    );

  if (showSuccess)
    return (
      <div className={pageLayoutClassName}>
        <div className="flex grow flex-col items-center gap-8 lg:items-start">
          <CheckIcon className="[&_path]:fill-klerosUIComponentsSuccess size-16" />
          <h1 className="text-klerosUIComponentsSuccess text-center text-2xl font-semibold lg:text-left">
            You have been unsubscribed
          </h1>
          <h3
            className={clsx(
              "max-w-183.75",
              "text-klerosUIComponentsPrimaryText text-center text-base font-semibold lg:text-left",
            )}
          >
            You will no longer receive notification emails from Kleros products.
          </h3>
          <Link href={paths.home.getHref()}>
            <Button text="Back to Home" />
          </Link>
        </div>
        <CheckIcon
          width={250}
          height={250}
          className="[&_path]:fill-klerosUIComponentsWhiteBackground hidden lg:block"
        />
      </div>
    );

  return (
    <div className={pageLayoutClassName}>
      <div className="flex w-full max-w-183.75 grow flex-col items-center gap-8 lg:items-start">
        <h1 className="text-klerosUIComponentsPrimaryText text-center text-2xl font-semibold lg:text-left">
          Unsubscribe from Notifications
        </h1>
        <EnsureChain>
          <div className="flex w-full flex-col items-center gap-6 lg:items-start">
            <Button
              text="Unsubscribe"
              onPress={handleUnsubscribe}
              isDisabled={isSigningIn || isPendingSignIn || isDeletingUser}
              isLoading={isSigningIn || isPendingSignIn || isDeletingUser}
              className={unsubscribeButtonClassName}
            />
            <AlertMessage variant="warning" title="Warning" msg="This will unsubscribe you from all Kleros products" />
          </div>
        </EnsureChain>
      </div>
    </div>
  );
}
