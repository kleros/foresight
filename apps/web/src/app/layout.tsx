import type { Metadata } from "next";
import localFont from "next/font/local";

import { AppProviders } from "@/components/providers/AppProviders";

import { pageMetadata, siteDescription, siteTitle, siteUrl } from "@/config/metadata";

import "react-toastify/dist/ReactToastify.css";
import "@/styles/global.css";

// A canonical here would be inherited by every page that sets none, the 404 included.
const { alternates: _canonical, ...siteMetadata } = pageMetadata({
  title: siteTitle,
  description: siteDescription,
  path: "/",
});

export const metadata: Metadata = { ...siteMetadata, metadataBase: siteUrl };

// the same files the component harnesses load (e2e/harness/inter.css)
const inter = localFont({
  variable: "--font-inter",
  display: "swap",
  src: [
    { path: "../../../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2", weight: "400" },
    { path: "../../../../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2", weight: "500" },
    { path: "../../../../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2", weight: "600" },
    { path: "../../../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2", weight: "700" },
  ],
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-title" content="Foresight | Kleros" />
      </head>
      <body className="bg-klerosUIComponentsLightBackground flex min-h-screen flex-col antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
