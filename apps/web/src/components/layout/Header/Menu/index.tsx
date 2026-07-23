"use client";

import dynamic from "next/dynamic";
import React from "react";

import clsx from "clsx";
import { useToggle } from "react-use";

import ThemeToggle from "@/components/ThemeToggle";
import LightButton from "@/components/ui/LightButton";

import HelpIcon from "@/assets/menu-icons/help.svg";

const Help = dynamic(() => import("./Help"), { ssr: false });

const Menu: React.FC<{ walletSlot?: React.ReactNode }> = ({ walletSlot }) => {
  const [isHelpOpen, toggleIsHelpOpen] = useToggle(false);

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center md:gap-1">
        <div
          className={clsx(
            "flex min-h-8 items-center",
            "[&_.button-text]:block md:[&_.button-text]:hidden",
            "not-dark:not-md:[&_.button-svg]:fill-black/75 not-dark:not-md:hover:[&_.button-svg]:fill-black",
          )}
        >
          <LightButton
            className="[&>p]:text-klerosUIComponentsPrimaryText [&>p]:ml-2 [&>p]:font-normal"
            text="Help"
            icon={<HelpIcon className="size-4" />}
            onPress={toggleIsHelpOpen}
          />
        </div>

        <ThemeToggle
          withText
          className={clsx(
            "[&_.button-text]:block md:[&_.button-text]:hidden",
            "not-dark:not-md:[&_.button-svg]:fill-black/75 not-dark:not-md:hover:[&_.button-svg]:fill-black",
          )}
        />

        {walletSlot ? <div className="mt-4 md:mt-0 md:ml-2">{walletSlot}</div> : null}
      </div>

      {isHelpOpen ? <Help isOpen toggleIsHelpOpen={toggleIsHelpOpen} /> : null}
    </>
  );
};

export default Menu;
