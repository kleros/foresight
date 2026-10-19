"use client";

import React, { useCallback } from "react";

import { classifyTxError } from "@foresight/tx-orchestrator";
import { useAtlasProvider } from "@kleros/kleros-app";
import { Button } from "@kleros/ui-components-library";
import { useAccount } from "wagmi";

import { errorToast, infoToast, successToast } from "@/utils/toast";

/** What a caller's own sign-in button needs; `isSigningIn` while the wallet is asked to sign. */
interface SignInButtonProps {
  onPress: () => void;
  isDisabled: boolean;
  isSigningIn: boolean;
}

const EnsureAuth: React.FC<{
  children: React.ReactNode;
  text?: string;
  /** Draws the sign-in in place of the library's button. */
  renderButton?: (props: SignInButtonProps) => React.ReactNode;
}> = ({ children, text, renderButton }) => {
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

  if (isVerified) return children;
  const isDisabled = isSigningIn || !address;
  return renderButton ? (
    renderButton({ onPress: handleSignIn, isDisabled, isSigningIn })
  ) : (
    <Button text={text ?? "Sign In"} onPress={handleSignIn} isDisabled={isDisabled} isLoading={isSigningIn} />
  );
};

export default EnsureAuth;
