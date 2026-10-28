"use client";

import { useAtlasProvider } from "@kleros/kleros-app";

import ContactDetailsForm from "@/features/settings/components/NotificationSettings/ContactDetailsForm";

import EnsureAuth from "@/components/auth/EnsureAuth";
import { PopupButton } from "@/components/ui/PopupButton";

import { DEFAULT_CHAIN } from "@/config/chains";
import { explorerTxUrl } from "@/config/site";

import { type PlacedPrediction, PredictSuccessView } from "./PredictSuccessView";

const txUrl = (hash: string) => explorerTxUrl(hash, DEFAULT_CHAIN);

/** Shown once a prediction lands, with the way to hear when the market resolves. */
export function PredictSuccessDialog({
  isOpen,
  placed,
  leftOut,
  onClose,
  optionNoun,
}: {
  isOpen: boolean;
  placed?: PlacedPrediction;
  /** Names of the options the run could not trade and left out. */
  leftOut: string[];
  onClose: () => void;
  /** What the market calls one option. */
  optionNoun: string;
}) {
  const { user, userExists } = useAtlasProvider();

  return (
    <PredictSuccessView
      isOpen={isOpen}
      placed={placed}
      leftOut={leftOut}
      onClose={onClose}
      subscribed={Boolean(userExists)}
      email={user?.email}
      isEmailVerified={user?.isEmailVerified}
      optionNoun={optionNoun}
      txUrl={txUrl}
      signUp={
        <EnsureAuth
          renderButton={({ onPress, isDisabled, isSigningIn }) => (
            <PopupButton
              text="Sign in to subscribe"
              busyText={isSigningIn ? "Signing in…" : undefined}
              isDisabled={isDisabled}
              onPress={onPress}
            />
          )}
        >
          <ContactDetailsForm />
        </EnsureAuth>
      }
    />
  );
}
