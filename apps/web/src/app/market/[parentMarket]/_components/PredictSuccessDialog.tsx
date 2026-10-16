"use client";

import { useAtlasProvider } from "@kleros/kleros-app";

import { PredictButton } from "@/features/predict/components/PredictButton";
import ContactDetailsForm from "@/features/settings/components/NotificationSettings/ContactDetailsForm";

import EnsureAuth from "@/components/auth/EnsureAuth";

import { PredictSuccessView } from "./PredictSuccessView";

/** Shown once a prediction lands, with the way to hear when the market resolves. */
export function PredictSuccessDialog({
  isOpen,
  leftOut,
  onClose,
}: {
  isOpen: boolean;
  /** Names of the options the run could not trade and left out. */
  leftOut: string[];
  onClose: () => void;
}) {
  const { user, userExists } = useAtlasProvider();

  return (
    <PredictSuccessView
      isOpen={isOpen}
      leftOut={leftOut}
      onClose={onClose}
      subscribed={Boolean(userExists)}
      email={user?.email}
      signUp={
        <EnsureAuth
          renderButton={({ onPress, isDisabled, isSigningIn }) => (
            <PredictButton
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
