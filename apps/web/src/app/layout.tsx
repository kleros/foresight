import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";

import clsx from "clsx";

import { AppProviders } from "@/components/providers/AppProviders";

import { env } from "@/config/env";
import { siteConfig } from "@/config/site";

import "@/styles/global.css";

export const metadata: Metadata = {
  title: siteConfig.name,
  description: siteConfig.description,
  metadataBase: env.SITE_URL ? new URL(env.SITE_URL) : null,
};

const openSans = Open_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-title" content="Foresight | Kleros" />
      </head>
      <body
        className={clsx(
          `${openSans.variable} bg-klerosUIComponentsLightBackground antialiased`,
          "flex min-h-screen flex-col",
        )}
      >
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
