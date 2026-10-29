"use client";

import Link from "next/link";
import { useEffect } from "react";

import { paths } from "@/config/paths";

import "@/styles/global.css";

/** Replaces the root layout, so it renders its own document and no providers. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-klerosUIComponentsLightBackground flex min-h-screen flex-col antialiased">
        <main className="fs-page flex flex-1 items-center justify-center py-10">
          <div className="border-fs-border rounded-fs flex flex-col items-center gap-3 border p-13 text-center">
            <h1 className="text-fs-text-primary text-base font-semibold">Something went wrong</h1>
            <p className="text-fs-text-secondary text-sm">Foresight could not load. Try again in a moment.</p>
            <div className="flex items-center gap-6">
              <button type="button" onClick={reset} className="type-label text-fs-text-accent cursor-pointer">
                Try again
              </button>
              <Link href={paths.home.getHref()} className="type-label text-fs-text-accent">
                Browse sessions
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
