import type { Metadata } from "next";

import { CreateSessionWizard } from "./_components/CreateSessionWizard";

export const metadata: Metadata = {
  title: "Create a session | Foresight",
  description: "Open a futarchy session.",
};

export default function CreatePage() {
  return <CreateSessionWizard />;
}
