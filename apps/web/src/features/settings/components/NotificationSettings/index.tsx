"use client";

import React from "react";

import EnsureAuth from "@/components/auth/EnsureAuth";
import EnsureChain from "@/components/wallet/EnsureChain";

import ContactDetailsForm from "./ContactDetailsForm";

const NotificationSettings: React.FC = () => (
  <div className="flex flex-col items-center gap-3 pt-8">
    <EnsureChain>
      <EnsureAuth>
        <div className="flex w-full flex-col items-center">
          <h2 className="text-klerosUIComponentsPrimaryText mt-4 mb-3 text-base font-semibold">Contact Details</h2>
          <ContactDetailsForm />
        </div>
      </EnsureAuth>
    </EnsureChain>
  </div>
);

export default NotificationSettings;
