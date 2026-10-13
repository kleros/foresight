"use client";

import { useId, useState, type ReactNode } from "react";

import { cn } from "@/utils/cn";

interface DisclosureProps {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
}

/** A collapsible section whose collapsed body is `hidden`, so nothing in it can take focus. */
export function Disclosure({ title, children, className, buttonClassName }: DisclosureProps) {
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
          "hover-medium-blue hover-short-transition cursor-pointer rounded-[3px]",
          "flex w-full items-center justify-between gap-4 px-4 py-[11.5px] md:px-8",
          buttonClassName,
        )}
      >
        {title}
        <svg viewBox="0 0 16 16" aria-hidden className="fill-klerosUIComponentsPrimaryText size-4 shrink-0">
          {open ? <path d="M0 7.2h16v1.6H0z" /> : <path d="M7.2 0h1.6v7.2H16v1.6H8.8V16H7.2V8.8H0V7.2h7.2z" />}
        </svg>
      </button>
      <div id={bodyId} hidden={!open} className="p-4 md:p-8">
        {children}
      </div>
    </div>
  );
}
