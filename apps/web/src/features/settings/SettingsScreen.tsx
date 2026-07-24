"use client";

import React from "react";

import { Tabs } from "@kleros/ui-components-library";
import clsx from "clsx";

import GeneralSettings from "./components/GeneralSettings";
import NotificationSettings from "./components/NotificationSettings";

const TABS = [
  { id: "general", value: "general", text: "General", content: <GeneralSettings /> },
  { id: "notifications", value: "notifications", text: "Notifications", content: <NotificationSettings /> },
];

export function SettingsScreen() {
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
        <Tabs className="w-full" items={TABS} defaultSelectedKey="general" />
      </div>
    </section>
  );
}
