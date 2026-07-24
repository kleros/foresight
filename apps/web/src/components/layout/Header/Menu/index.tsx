"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import React from "react";

import clsx from "clsx";
import { useToggle } from "react-use";

import ThemeToggle from "@/components/ThemeToggle";
import LightButton from "@/components/ui/LightButton";

import HelpIcon from "@/assets/menu-icons/help.svg";
import SettingsIcon from "@/assets/menu-icons/settings.svg";

const Help = dynamic(() => import("./Help"), { ssr: false });

interface IMenu {
  walletSlot?: React.ReactNode;
  /** Called after a menu entry navigates, so the mobile drawer can close itself. */
  onNavigate?: () => void;
}

const itemClassName = clsx(
  "flex min-h-8 items-center",
  "[&_.button-text]:block md:[&_.button-text]:hidden",
  "not-dark:not-md:[&_.button-svg]:fill-black/75 not-dark:not-md:hover:[&_.button-svg]:fill-black",
);

const buttonClassName = "[&>p]:text-klerosUIComponentsPrimaryText [&>p]:ml-2 [&>p]:font-normal";

const Menu: React.FC<IMenu> = ({ walletSlot, onNavigate }) => {
  const [isHelpOpen, toggleIsHelpOpen] = useToggle(false);
  const router = useRouter();

  const openSettings = () => {
    router.push("/settings");
    onNavigate?.();
  };

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center md:gap-1">
        <div className={itemClassName}>
          <LightButton
            className={buttonClassName}
            text="Settings"
            icon={<SettingsIcon className="size-4" />}
            onPress={openSettings}
          />
        </div>

        <div className={itemClassName}>
          <LightButton
            className={buttonClassName}
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
