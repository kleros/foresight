import type { MetadataRoute } from "next";

import { siteUrl } from "@/config/metadata";

/** Nothing is disallowed: a page that must stay out of results says `noindex`, which a disallow would hide from crawlers. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", siteUrl).href,
  };
}
