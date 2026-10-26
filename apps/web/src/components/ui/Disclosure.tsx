"use client";

import { useId, useState, type ReactNode } from "react";

import { cn } from "@/utils/cn";
import { INERT } from "@/utils/inert";

import { ChevronIcon } from "./ChevronIcon";

interface DisclosureProps {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
  bodyClassName?: string;
  /** A plus that turns to a minus, or a chevron that turns over. */
  glyph?: "plus" | "chevron";
}

/** A collapsible section whose collapsed body stays mounted but inert, so nothing in it can take focus. */
export function Disclosure({
  title,
  children,
  className,
  buttonClassName,
  bodyClassName,
  glyph = "plus",
}: DisclosureProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "bg-klerosUIComponentsWhiteBackground border-klerosUIComponentsStroke border",
          "hover:bg-fs-surface-tint hover-short-transition cursor-pointer rounded-[3px]",
          "flex w-full items-center justify-between gap-4 px-4 py-[11.5px] md:px-8",
          buttonClassName,
        )}
      >
        {title}
        {glyph === "chevron" ? (
          <ChevronIcon className={cn("fs-chevron text-fs-text-secondary size-4 shrink-0", open && "rotate-180")} />
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden className="fill-klerosUIComponentsPrimaryText size-4 shrink-0">
            {open ? <path d="M0 7.2h16v1.6H0z" /> : <path d="M7.2 0h1.6v7.2H16v1.6H8.8V16H7.2V8.8H0V7.2h7.2z" />}
          </svg>
        )}
      </button>
      <div id={bodyId} data-open={open || undefined} className="fs-disclosure">
        <div className="min-h-0 overflow-hidden">
          <div
            aria-hidden={open ? undefined : true}
            {...(open ? {} : INERT)}
            className={cn("p-4 md:p-8", bodyClassName)}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
