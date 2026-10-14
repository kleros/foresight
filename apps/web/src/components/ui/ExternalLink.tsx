import type { ReactNode } from "react";

import clsx from "clsx";

import ExternalArrow from "@/assets/svg/external-arrow.svg";

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx("text-fs-text-accent text-sm hover:underline", className)}
    >
      {children}
      {/* U+2060 keeps the arrow on the line of the last word when the text wraps */}
      <span className="whitespace-nowrap" aria-hidden>
        {"\u2060"}
        <ExternalArrow className="ml-1 inline size-4 shrink-0 align-text-bottom [&_path]:fill-current" />
      </span>
    </a>
  );
}
