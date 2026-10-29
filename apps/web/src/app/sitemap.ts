import type { MetadataRoute } from "next";

import { getSessionPaths } from "@/features/sessions/api/getSessionMetadata";

import { siteUrl } from "@/config/metadata";
import { paths } from "@/config/paths";

/** No `lastModified`: Google reads it only when it is accurate, and a session has no edit time to report. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const markets = await getSessionPaths();
  return [paths.home.getHref(), paths.create.getHref(), ...markets.map((market) => paths.market.getHref(market))].map(
    (path) => ({ url: new URL(path, siteUrl).href }),
  );
}
