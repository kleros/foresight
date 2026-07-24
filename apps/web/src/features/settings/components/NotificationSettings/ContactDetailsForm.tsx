"use client";

import React, { useCallback, useEffect, useState } from "react";

import { useAtlasProvider } from "@kleros/kleros-app";
import { AlertMessage, Button, Form, TextField } from "@kleros/ui-components-library";
import clsx from "clsx";
import { useAccount } from "wagmi";

import InfoCard from "@/components/ui/InfoCard";

import { timeLeftUntil } from "@/utils/date";
import { errorToast, infoToast, successToast } from "@/utils/toast";

import EmailVerificationInfo from "./EmailVerificationInfo";

// https://www.w3.org/TR/2012/WD-html-markup-20120329/input.email.html#input.email.attrs.value.single
const EMAIL_REGEX =
  /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

const unsubscribeButtonClassName = clsx(
  "bg-klerosUIComponentsError! hover:bg-klerosUIComponentsError! hover:opacity-75",
  "border-klerosUIComponentsError! [&_.button-text]:text-wrap! [&_.button-text]:text-white!",
);

const ContactDetailsForm: React.FC = () => {
  const [emailInput, setEmailInput] = useState("");
  const [isConfirmingUnsubscribe, setIsConfirmingUnsubscribe] = useState(false);
  const { address } = useAccount();
  const {
    user,
    userExists,
    addUser,
    updateEmail,
    deleteUser,
    isAddingUser,
    isFetchingUser,
    isUpdatingUser,
    isDeletingUser,
  } = useAtlasProvider();

  const isEditingEmail = user?.email !== emailInput;
  const emailIsValid = EMAIL_REGEX.test(emailInput);

  const isEmailUpdateable = user?.email
    ? !!user.emailUpdateableAt && new Date(user.emailUpdateableAt).getTime() < Date.now()
    : true;

  useEffect(() => {
    if (!user || !userExists) return;

    setEmailInput(user.email);
  }, [user, userExists]);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!address || isFetchingUser) return;

      const onError = (action: string, err: Error) =>
        errorToast(`${action} failed: ${err?.message ?? "Unknown error"}`);

      if (userExists) {
        if (!isEmailUpdateable) return;

        infoToast("Updating email...");
        updateEmail({ newEmail: emailInput })
          .then((res) => res && successToast("Email update successful!"))
          .catch((err: Error) => onError("Email update", err));
      } else {
        infoToast("Subscribing...");
        addUser({ email: emailInput })
          .then((res) => res && successToast("You are subscribed to notifications!"))
          .catch((err: Error) => onError("Subscription", err));
      }
    },
    [address, addUser, emailInput, isEmailUpdateable, isFetchingUser, updateEmail, userExists],
  );

  const handleConfirmUnsubscribe = useCallback(() => {
    if (!address) return;

    infoToast("Unsubscribing...");
    deleteUser()
      .then((res) => {
        if (!res) {
          errorToast("Unsubscribe failed: Unknown error");
          return;
        }
        setEmailInput("");
        setIsConfirmingUnsubscribe(false);
        successToast("You have been unsubscribed from notifications.");
      })
      .catch((err: Error) => errorToast(`Unsubscribe failed: ${err?.message ?? "Unknown error"}`));
  }, [address, deleteUser]);

  return (
    <Form className="relative flex w-full flex-col gap-4" onSubmit={handleSubmit}>
      <TextField
        className="w-full [&_input]:text-sm"
        label="Email"
        placeholder="your.email@email.com"
        value={emailInput}
        onChange={setEmailInput}
        isDisabled={!isEmailUpdateable}
        validate={(val) => (val.trim() === "" || EMAIL_REGEX.test(val) ? undefined : "Invalid email")}
        fieldErrorProps={{
          children: ({ validationErrors }) => (
            <ul className="w-full">
              {validationErrors.map((error) => (
                <li key={error} className="text-klerosUIComponentsError text-sm">
                  {error}
                </li>
              ))}
            </ul>
          ),
        }}
        showFieldError
      />

      {!isEmailUpdateable ? (
        <InfoCard
          className="w-fit text-sm wrap-break-word"
          msg={`You can update email again ${timeLeftUntil(user?.emailUpdateableAt ?? "")}`}
        />
      ) : null}

      {isConfirmingUnsubscribe ? (
        <AlertMessage title="Warning" variant="warning" msg="This will unsubscribe you from all Kleros products" />
      ) : null}

      <div className="flex flex-row-reverse justify-between gap-2">
        {isConfirmingUnsubscribe ? (
          <>
            <Button
              text="Confirm Unsubscribe"
              onPress={handleConfirmUnsubscribe}
              isDisabled={isFetchingUser || isDeletingUser}
              isLoading={isDeletingUser}
              className={unsubscribeButtonClassName}
            />
            <Button
              variant="secondary"
              text="Cancel"
              onPress={() => setIsConfirmingUnsubscribe(false)}
              isDisabled={isDeletingUser}
            />
          </>
        ) : (
          <>
            <Button
              type="submit"
              text="Save"
              isDisabled={
                !isEditingEmail ||
                !emailIsValid ||
                !isEmailUpdateable ||
                isAddingUser ||
                isFetchingUser ||
                isUpdatingUser ||
                isDeletingUser
              }
              isLoading={isAddingUser || isUpdatingUser}
            />
            {userExists ? (
              <Button
                variant="secondary"
                text="Unsubscribe"
                onPress={() => setIsConfirmingUnsubscribe(true)}
                isDisabled={isFetchingUser || isDeletingUser}
                className={unsubscribeButtonClassName}
              />
            ) : null}
          </>
        )}
      </div>

      <EmailVerificationInfo />
    </Form>
  );
};

export default ContactDetailsForm;
