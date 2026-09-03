import type { ReactNode } from "react";

import clsx from "clsx";

import ExternalArrow from "@/assets/svg/external-arrow.svg";

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx("text-fs-accent inline-flex items-center gap-1 text-sm", className)}
    >
      {children}
      <ExternalArrow className="size-4 shrink-0 [&_path]:fill-current" />
    </a>
  );
}
