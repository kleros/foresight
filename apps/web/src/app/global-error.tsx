"use client";

import Link from "next/link";
import { useEffect, type CSSProperties } from "react";

import { paths } from "@/config/paths";

// Inline: when the root layout fails on the server, Next 14 serves this page without its stylesheet.
// Values are the dark theme's resolved tokens.
const styles = {
  body: {
    margin: 0,
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 16px",
    background: "rgb(27, 0, 63)",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  box: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    padding: 52,
    border: "1px solid rgb(57, 44, 116)",
    borderRadius: 3,
    textAlign: "center",
  },
  title: { margin: 0, fontSize: 16, fontWeight: 600, color: "rgb(218, 240, 255)" },
  hint: { margin: 0, fontSize: 14, color: "rgb(190, 204, 229)" },
  actions: { display: "flex", alignItems: "center", gap: 24 },
  action: {
    padding: 0,
    border: 0,
    background: "none",
    cursor: "pointer",
    font: "inherit",
    fontSize: 14,
    color: "rgb(123, 150, 255)",
    textDecoration: "none",
  },
} satisfies Record<string, CSSProperties>;

/** Replaces the root layout, so it renders its own document and no providers. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={styles.body}>
        <main style={styles.box}>
          <h1 style={styles.title}>Something went wrong</h1>
          <p style={styles.hint}>Foresight could not load. Try again in a moment.</p>
          <div style={styles.actions}>
            <button type="button" onClick={reset} style={styles.action}>
              Try again
            </button>
            <Link href={paths.home.getHref()} style={styles.action}>
              Browse sessions
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
