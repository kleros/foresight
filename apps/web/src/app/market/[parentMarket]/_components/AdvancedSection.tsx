import clsx from "clsx";

import { ExternalLink } from "@/components/ui/ExternalLink";
import { SeerLogo } from "@/components/ui/SeerLogo";

import { DEFAULT_CHAIN } from "@/config/chains";
import { seerMarketUrl } from "@/config/site";

import { SectionCard } from "./SectionCard";

export function AdvancedSection({ parentMarket }: { parentMarket: string }) {
  const url = seerMarketUrl(parentMarket, DEFAULT_CHAIN.id);
  if (!url) return null;

  return (
    <SectionCard
      className={clsx(
        "mb-42 px-4 py-6 md:px-8",
        "flex flex-col-reverse items-start justify-center gap-x-8 gap-y-4",
        "md:flex-row md:items-center md:justify-between",
      )}
    >
      <div className="flex flex-col items-start gap-2">
        <h3 className="text-fs-text-primary text-base font-semibold">Advanced</h3>
        <p className="text-fs-text-secondary text-sm">
          Check the opportunities if you want to LP or Trade specific outcome tokens in Seer.&nbsp;
          <ExternalLink href={url}>Check it out</ExternalLink>
        </p>
      </div>
      <SeerLogo className="shrink-0" />
    </SectionCard>
  );
}
