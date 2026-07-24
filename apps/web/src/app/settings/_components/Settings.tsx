"use client";

import React, { useState, type ReactNode } from "react";

import { Tabs } from "@kleros/ui-components-library";
import clsx from "clsx";

import GeneralSettings from "@/features/settings/components/GeneralSettings";
import NotificationSettings from "@/features/settings/components/NotificationSettings";

import { parseSettingsTab, type SettingsTab } from "@/config/paths";

/** Typed against `SettingsTab`, so a tab added here without a `?tab=` value fails to compile. */
const TABS: { id: SettingsTab; value: SettingsTab; text: string; content: ReactNode }[] = [
  { id: "general", value: "general", text: "General", content: <GeneralSettings /> },
  { id: "notifications", value: "notifications", text: "Notifications", content: <NotificationSettings /> },
];

export function Settings({ defaultTab }: { defaultTab?: string }) {
  const [selectedTab, setSelectedTab] = useState<SettingsTab>(parseSettingsTab(defaultTab));

  return (
    <section className="mx-auto flex w-full max-w-120 flex-col gap-6">
      <h1 className="text-klerosUIComponentsPrimaryText text-center text-2xl font-semibold">Settings</h1>
      <div
        className={clsx(
          "px-6 py-8 md:px-8",
          "border border-klerosUIComponentsStroke",
          "shadow-default rounded-base  bg-klerosUIComponentsWhiteBackground ",
        )}
      >
        <Tabs
          className="w-full"
          items={TABS}
          defaultSelectedKey={selectedTab}
          selectedKey={selectedTab}
          callback={(key) => setSelectedTab(parseSettingsTab(String(key)))}
        />
      </div>
    </section>
  );
}
