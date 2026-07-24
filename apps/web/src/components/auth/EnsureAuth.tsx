"use client";

import React, { useCallback } from "react";

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
      .catch((err: Error) => errorToast(`Sign-in failed: ${err?.message}`));
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
