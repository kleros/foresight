import { ExternalLink } from "@/components/ui/ExternalLink";

import { DEFAULT_CHAIN } from "@/config/chains";
import { seerMarketUrl } from "@/config/site";

export function AdvancedSection({ parentMarket }: { parentMarket: string }) {
  const url = seerMarketUrl(parentMarket, DEFAULT_CHAIN.id);
  if (!url) return null;

  return (
    <p className="type-label text-fs-text-secondary mt-2 mb-16">
      Advanced: <ExternalLink href={url}>Trade or provide liquidity for individual outcome tokens on Seer</ExternalLink>
    </p>
  );
}
