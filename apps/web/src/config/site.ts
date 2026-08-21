import { gnosis } from "viem/chains";

export const siteConfig = {
  name: "Foresight",
  description: "Permissionless futarchy on Gnosis",
  links: {
    kleros: "https://kleros.io",
    github: "https://github.com/kleros/futarchy-ui",
    telegram: "https://t.me/+HrYn_tzqTGFlYTc0",
    x: "https://x.com/kleros_io",
    bugReport: "https://github.com/kleros/futarchy-ui/issues",
    ethereumWallets: "https://ethereum.org/en/wallets/",
    appGuide: "https://kleros.notion.site/Kleros-Foresight-Beginner-User-Guide-30d9a9db4f088064a588f7d5acc2751f",
    faq: "https://kleros.notion.site/Kleros-Foresight-Beginner-User-Guide-30d9a9db4f088064a588f7d5acc2751f#30d9a9db4f088138a266e870c56159e0",
  },
} as const;

export const seerMarketUrl = (parentMarket: string, chainId: number) =>
  chainId === gnosis.id ? `https://app.seer.pm/markets/${chainId}/${parentMarket}` : undefined;
