"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";

import { useAtlasProvider } from "@kleros/kleros-app";
import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";
import { isAddress } from "viem";

import Loader from "@/components/ui/Loader";

import CheckIcon from "@/assets/svg/check-circle.svg";
import InvalidIcon from "@/assets/svg/minus-outline.svg";
import WarningIcon from "@/assets/svg/warning-outline.svg";

import { cn } from "@/utils/cn";

import { paths } from "@/config/paths";
import { siteConfig } from "@/config/site";

const TEXT_STYLE = "text-center whitespace-pre-line lg:text-left";

const OUTCOMES = {
  invalid: {
    headerMsg: "Invalid Link!",
    subtitleMsg: "Oops, seems like you followed an invalid link.",
    buttonMsg: "Contact Support",
    buttonTo: siteConfig.links.telegram,
    Icon: InvalidIcon,
    textClassName: "text-klerosUIComponentsPrimaryText",
    iconClassName: "[&_path]:fill-klerosUIComponentsPrimaryText",
  },
  error: {
    headerMsg: "Something went wrong",
    subtitleMsg: "Oops, seems like something went wrong in our systems.",
    buttonMsg: "Contact Support",
    buttonTo: siteConfig.links.telegram,
    Icon: WarningIcon,
    textClassName: "text-klerosUIComponentsError",
    iconClassName: "[&_path]:fill-klerosUIComponentsError",
  },
  confirmed: {
    headerMsg: "Congratulations! \nYour email has been verified!",
    subtitleMsg: "We'll notify you about the sessions you follow on Foresight.",
    buttonMsg: "Let's start!",
    buttonTo: paths.home.getHref(),
    Icon: CheckIcon,
    textClassName: "text-klerosUIComponentsSuccess",
    iconClassName: "[&_path]:fill-klerosUIComponentsSuccess",
  },
  expired: {
    headerMsg: "Verification link expired...",
    subtitleMsg:
      'Oops, the email verification link has expired. No worries! Go to settings and click on "Resend it" to receive another verification email.',
    buttonMsg: "Open Settings",
    buttonTo: paths.settings.getHref("notifications"),
    Icon: WarningIcon,
    textClassName: "text-klerosUIComponentsWarning",
    iconClassName: "[&_path]:fill-klerosUIComponentsWarning",
  },
} as const;

type Outcome = keyof typeof OUTCOMES;

export function EmailConfirmation({ address, token }: { address?: string; token?: string }) {
  const { confirmEmail } = useAtlasProvider();

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const hasConfirmed = useRef(false);

  useEffect(() => {
    if (hasConfirmed.current) return;

    if (!address || !isAddress(address) || !token) {
      setOutcome("invalid");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    confirmEmail({ address, token })
      .then((res) => {
        if (res.isConfirmed) {
          setOutcome("confirmed");
          hasConfirmed.current = true;
        } else if (res.isTokenInvalid) {
          setOutcome("invalid");
        } else if (res.isError) {
          setOutcome("error");
        } else {
          setOutcome("expired");
        }
      })
      .catch(() => setOutcome("error"))
      .finally(() => setIsLoading(false));
  }, [address, token, confirmEmail]);

  if (isLoading)
    return (
      <div className="flex size-full items-center justify-center py-12">
        <Loader />
      </div>
    );

  const { headerMsg, subtitleMsg, buttonMsg, buttonTo, Icon, textClassName, iconClassName } =
    OUTCOMES[outcome ?? "error"];

  return (
    <div
      className={clsx(
        "flex flex-col gap-x-4 gap-y-12 px-4 py-12 md:px-8 lg:px-32",
        "size-full items-center justify-center",
        "lg:flex-row lg:justify-between",
      )}
    >
      <div className="flex grow flex-col items-center gap-8 lg:items-start">
        <Icon className={cn(iconClassName, "size-16")} />
        <h1 className={cn(TEXT_STYLE, "text-2xl font-semibold", textClassName)}>{headerMsg}</h1>
        <h3 className={cn("text-klerosUIComponentsPrimaryText max-w-183.75 text-base font-semibold", TEXT_STYLE)}>
          {subtitleMsg}
        </h3>
        <Link href={buttonTo}>
          <Button text={buttonMsg} />
        </Link>
      </div>
      <Icon width={250} height={250} className="[&_path]:fill-klerosUIComponentsWhiteBackground hidden lg:block" />
    </div>
  );
}
