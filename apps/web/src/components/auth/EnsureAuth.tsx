"use client";

import React, { useCallback } from "react";

import { classifyTxError } from "@foresight/tx-orchestrator";
import { useAtlasProvider } from "@kleros/kleros-app";
import { Button } from "@kleros/ui-components-library";
import { useAccount } from "wagmi";

import { errorToast, infoToast, successToast } from "@/utils/toast";

const EnsureAuth: React.FC<{ children: React.ReactNode; text?: string; className?: string }> = ({
  children,
  text,
  className,
}) => {
  const { address } = useAccount();
  const { isVerified, isSigningIn, authoriseUser } = useAtlasProvider();

  const handleSignIn = useCallback(() => {
    infoToast("Signing in...");
    authoriseUser()
      .then(() => successToast("Signed in successfully!"))
      .catch((error: unknown) =>
        errorToast(
          classifyTxError(error) === "rejected" ? "You declined in your wallet." : "Sign-in failed. Try again.",
        ),
      );
  }, [authoriseUser]);

  return isVerified ? (
    children
  ) : (
    <Button
      text={text ?? "Sign In"}
      onPress={handleSignIn}
      isDisabled={isSigningIn || !address}
      isLoading={isSigningIn}
      {...{ className }}
    />
  );
};

export default EnsureAuth;
