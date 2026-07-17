import Link from "next/link";
import React from "react";

import { Modal } from "@kleros/ui-components-library";
import clsx from "clsx";

import Guide from "@/assets/menu-icons/book.svg";
import Bug from "@/assets/menu-icons/bug.svg";
import ETH from "@/assets/menu-icons/eth.svg";
import Feedback from "@/assets/menu-icons/feedback.svg";
import Faq from "@/assets/menu-icons/help.svg";
import Telegram from "@/assets/social-media/telegram.svg";

import { siteConfig } from "@/config/site";

const ITEMS = [
  {
    text: "Get Help",
    Icon: Telegram,
    url: siteConfig.links.telegram,
  },
  {
    text: "Report a Bug",
    Icon: Bug,
    url: siteConfig.links.bugReport,
  },
  {
    text: "Give Feedback",
    Icon: Feedback,
    url: siteConfig.links.telegram,
  },
  {
    text: "App Guide",
    Icon: Guide,
    url: siteConfig.links.appGuide,
  },
  {
    text: "Crypto Beginner's Guide",
    Icon: ETH,
    url: siteConfig.links.ethereumWallets,
  },
  {
    text: "FAQ",
    Icon: Faq,
    url: siteConfig.links.faq,
  },
];

interface IHelp {
  isOpen?: boolean;
  toggleIsHelpOpen: () => void;
}

const Help: React.FC<IHelp> = ({ isOpen, toggleIsHelpOpen }) => {
  return (
    <Modal
      className={clsx(
        "mt-18 h-auto max-h-[80vh] w-65 max-w-111 overflow-y-auto p-3 pr-6",
        "absolute top-0 right-0 left-auto flex flex-col",
        "shadow-default rounded-base border-klerosUIComponentsStroke bg-klerosUIComponentsWhiteBackground border",
        "animate-slide-in-left",
      )}
      isOpen={isOpen}
      onOpenChange={toggleIsHelpOpen}
      isDismissable
    >
      <div className="size-full" role="menu"></div>
      {ITEMS.map(({ text, Icon, url }) => (
        <Link
          className={clsx(
            "flex cursor-pointer items-center gap-2 px-2 py-3",
            "transition-transform duration-200 hover:scale-102",
          )}
          href={url}
          key={text}
          target="_blank"
          rel="noopener noreferrer"
          role="menuitem"
          aria-label={`${text} - opens in new tab`}
        >
          <Icon className={clsx("[&_path]:fill-klerosUIComponentsSecondaryPurple", "inline-block size-4")} />
          <small
            className={clsx(
              "text-klerosUIComponentsSecondaryText hover:text-klerosUIComponentsSecondaryPurple text-base",
              "hover:text-klerosUIComponentsSecondaryPurple transition-colors duration-200",
            )}
          >
            {text}
          </small>
        </Link>
      ))}
    </Modal>
  );
};
export default Help;
