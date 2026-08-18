import Link from "next/link";
import React from "react";

import clsx from "clsx";

import LightButton from "@/components/ui/LightButton";

import SecuredByKlerosLogo from "@/assets/logo/secured-by-kleros.svg";
import GithubLogo from "@/assets/social-media/github.svg";
import TelegramLogo from "@/assets/social-media/telegram.svg";
import XLogo from "@/assets/social-media/x.svg";

import { siteConfig } from "@/config/site";

const socialmedia = {
  telegram: {
    icon: TelegramLogo,
    url: siteConfig.links.telegram,
  },
  x: {
    icon: XLogo,
    url: siteConfig.links.x,
  },
  github: {
    icon: GithubLogo,
    url: siteConfig.links.github,
  },
};

const SecuredByKleros: React.FC = () => (
  <Link className="hover:underline" href={siteConfig.links.kleros} target="_blank" rel="noreferrer">
    <SecuredByKlerosLogo
      className={clsx("hover-short-transition min-h-6 md:ml-2", "[&_path]:fill-white/75 hover:[&_path]:fill-white")}
    />
  </Link>
);

const SocialMedia = () => (
  <div className="flex">
    {Object.values(socialmedia).map(({ url, icon: Icon }) => (
      <Link key={url} href={url} target="_blank" rel="noreferrer">
        <LightButton icon={<Icon className="[&_path]:fill-white!" />} text="" className="[&_svg]:mr-0" />
      </Link>
    ))}
  </div>
);

const Footer: React.FC = () => (
  <div className={clsx("bg-footer-background", "min-h-16 w-full shrink-0")}>
    <div
      className={clsx("fs-page", "flex min-h-16 flex-col items-center justify-between gap-4 py-5 md:flex-row md:py-0")}
    >
      <SecuredByKleros />
      <SocialMedia />
    </div>
  </div>
);

export default Footer;
