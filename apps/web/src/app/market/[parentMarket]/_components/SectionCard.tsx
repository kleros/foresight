import type { ReactNode } from "react";

import { Card } from "@kleros/ui-components-library";
import clsx from "clsx";

export function SectionCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Card round className={clsx("border-gradient-purple-blue h-auto w-full border-none", className)}>
      {children}
    </Card>
  );
}
