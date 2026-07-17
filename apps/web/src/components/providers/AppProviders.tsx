"use client";

import type { ReactNode } from "react";

import { ThemeProvider } from "next-themes";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      themes={["light", "dark"]}
    >
      {children}
    </ThemeProvider>
  );
}
