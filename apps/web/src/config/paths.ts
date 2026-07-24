/**
 * Every route the app links to, in one place. Components call `getHref()`
 * instead of writing URL strings, so a moved route is a single edit here.
 */
export const paths = {
  home: {
    getHref: () => "/",
  },
  create: {
    getHref: () => "/create",
  },
  settings: {
    getHref: () => "/settings",
  },
} as const;
