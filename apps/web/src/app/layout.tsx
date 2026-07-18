import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";

import clsx from "clsx";

import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { AppProviders } from "@/components/providers/AppProviders";

import { siteConfig } from "@/config/site";

import "@/styles/global.css";

export const metadata: Metadata = {
  title: siteConfig.name,
  description: siteConfig.description,
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
        <AppProviders>
          <Header />
          <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10">{children}</main>
          <Footer />
        </AppProviders>
      </body>
    </html>
  );
}
