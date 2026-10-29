"use client";

import { useEffect } from "react";

import { PageMessage } from "@/components/layout/PageMessage";
import { Shell } from "@/components/layout/Shell";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Shell>
      <PageMessage
        title="Something went wrong"
        hint="This page could not be shown. Try again in a moment."
        action={
          <button type="button" onClick={reset} className="type-label text-fs-text-accent cursor-pointer">
            Try again
          </button>
        }
      />
    </Shell>
  );
}
