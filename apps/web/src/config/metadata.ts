import type { Metadata } from "next";

import { env } from "./env";
import { siteConfig } from "./site";

export const siteUrl = new URL(env.SITE_URL ?? "https://foresight.kleros.io");

export const siteTitle = "Foresight | Kleros";
export const siteDescription = "Prediction markets for distilled human judgement";

/** Lives in `public/`; 3836x1902. */
export const defaultOgImage = "/futarchy_kleros.png";

const twitterCreator = { creator: "@kleros_io", creatorId: "1467726470533754880" } as const;

interface PageMetadata {
  title: string;
  description: string;
  /** Site-relative, resolved against `metadataBase`. */
  path: string;
  image?: string;
}

/**
 * Next merges `openGraph` and `twitter` shallowly, so a page that sets either
 * replaces the root's object whole: every page builds both from here.
 */
export function pageMetadata({ title, description, path, image = defaultOgImage }: PageMetadata): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: siteConfig.name,
      images: [image],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      site: twitterCreator.creator,
      ...twitterCreator,
      images: [image],
    },
  };
}
