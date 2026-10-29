import type { Metadata } from "next";

import { pageMetadata } from "@/config/metadata";
import { paths } from "@/config/paths";

import { CreateSessionWizard } from "./_components/CreateSessionWizard";

export const metadata: Metadata = pageMetadata({
  title: "Create a session | Foresight",
  description: "Open a futarchy session.",
  path: paths.create.getHref(),
});

export default function CreatePage() {
  return <CreateSessionWizard />;
}
