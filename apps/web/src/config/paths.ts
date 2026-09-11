/** Tabs on the settings page, addressable via `?tab=`. */
export const SETTINGS_TABS = ["general", "notifications"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const parseSettingsTab = (value?: string): SettingsTab =>
  SETTINGS_TABS.find((tab) => tab === value) ?? "general";

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
  /** A session is read through its decision market, which is what addresses it. */
  market: {
    getHref: (parentMarket: string) => `/market/${parentMarket}`,
  },
  settings: {
    getHref: (tab?: SettingsTab) => (tab ? `/settings?tab=${tab}` : "/settings"),
    /** Landing pages for the links Atlas puts in its emails. */
    emailConfirmation: {
      getHref: () => "/settings/email-confirmation",
    },
    unsubscribe: {
      getHref: () => "/settings/unsubscribe",
    },
  },
} as const;
