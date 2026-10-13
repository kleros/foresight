"use client";

import { useAtlasProvider } from "@kleros/kleros-app";
import { Button, Modal, TextField } from "@kleros/ui-components-library";
import clsx from "clsx";

import ContactDetailsForm from "@/features/settings/components/NotificationSettings/ContactDetailsForm";

import EnsureAuth from "@/components/auth/EnsureAuth";
import InfoCard from "@/components/ui/InfoCard";

import CheckIcon from "@/assets/svg/check-circle.svg";

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
    <Modal
      isOpen={isOpen}
      isDismissable
      onOpenChange={(open) => (open ? undefined : onClose())}
      className={clsx(
        "h-fit max-h-[calc(100vh-32px)] w-full max-w-[calc(100vw-32px)] overflow-y-auto sm:w-160",
        "flex flex-col items-center gap-8 p-8",
        "rounded-fs border-fs-border bg-fs-surface border",
      )}
    >
      <h1 className="text-fs-text-primary text-center text-2xl font-semibold">Prediction placed</h1>
      <CheckIcon className="size-32" />
      {leftOut.length > 0 ? (
        <p className="text-fs-text-secondary text-center text-sm">
          These estimates could not be traded right now and were left out: {leftOut.join(", ")}.
        </p>
      ) : null}

      <hr className="border-fs-border w-full" />
      {userExists ? (
        <div className="flex w-full flex-col items-center gap-8">
          <p className="text-fs-text-secondary w-full text-center text-sm">
            You will receive a notification on the following email once the market resolves.
          </p>
          <div className="space-y-2">
            {user?.email ? (
              <TextField
                isDisabled
                value={user.email}
                className="w-full [&_input]:text-sm [&>label]:hidden"
                label="Email"
              />
            ) : null}
            <InfoCard
              className="w-fit text-sm wrap-break-word"
              msg="You can update your subscription preference at any time on Settings. Please make sure that you have confirmed your email."
            />
          </div>
          <Button small text="Close" onPress={onClose} />
        </div>
      ) : (
        <div className="flex w-full flex-col items-center gap-8">
          <div>
            <h2 className="text-fs-text-primary w-full text-center text-base font-semibold">
              Subscribe for Email Notifications
            </h2>
            <p className="text-fs-text-secondary w-full text-center text-sm">
              We advise you to subscribe to receive notifications about the progress of your predictions.
            </p>
          </div>
          <EnsureAuth text="Sign in to subscribe">
            <ContactDetailsForm />
          </EnsureAuth>
          <Button small variant="secondary" text="Close" onPress={onClose} />
        </div>
      )}
    </Modal>
  );
}
