import type { Metadata } from "next";

import { EmailConfirmation } from "./_components/EmailConfirmation";

export const metadata: Metadata = {
  title: "Email Confirmation | Foresight",
};

export default function EmailConfirmationPage({
  searchParams,
}: {
  searchParams: { address?: string; token?: string };
}) {
  return <EmailConfirmation address={searchParams.address} token={searchParams.token} />;
}
