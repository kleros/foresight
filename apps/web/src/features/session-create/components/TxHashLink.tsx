import { Copiable } from "@kleros/ui-components-library";
import type { Chain } from "viem";

import { shortHash } from "@/utils/hash";

import { DEFAULT_CHAIN } from "@/config/chains";

const CLASS = "text-fs-text-secondary font-mono text-[11px] whitespace-nowrap";

export function TxHashLink({
  hash,
  chain = DEFAULT_CHAIN,
  copiable = false,
}: {
  hash?: string;
  chain?: Chain;
  copiable?: boolean;
}) {
  if (!hash) return null;

  const explorer = chain.blockExplorers?.default.url;
  const text = shortHash(hash);
  const link =
    explorer === undefined ? (
      <span className={CLASS}>{text}</span>
    ) : (
      <a
        href={`${explorer.replace(/\/+$/, "")}/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        className={`${CLASS} hover:text-fs-accent underline underline-offset-2`}
        title={hash}
      >
        {text}
      </a>
    );

  if (!copiable) return link;

  return (
    <Copiable
      copiableContent={hash}
      info="Copy transaction hash"
      iconPlacement="right"
      className="[&_button]:size-3 [&_svg]:size-3"
      tooltipProps={{ small: true }}
    >
      {link}
    </Copiable>
  );
}
