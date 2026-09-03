import type { CSSProperties } from "react";

/** A session's hero banner, or the gradient-axis stand-in when it has none. */
export function bannerStyle(heroUri: string | null): CSSProperties {
  return heroUri
    ? { backgroundImage: `url(${JSON.stringify(heroUri)})` }
    : {
        backgroundImage:
          "linear-gradient(135deg, color-mix(in oklch, var(--fs-grad-from) 82%, transparent) 0%," +
          " color-mix(in oklch, var(--fs-grad-to) 74%, transparent) 100%)",
      };
}
