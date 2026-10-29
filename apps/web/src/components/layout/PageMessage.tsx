import Link from "next/link";
import type { ReactNode } from "react";

import { paths } from "@/config/paths";

export function PageMessage({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="border-fs-border rounded-fs my-20 flex flex-col items-center gap-3 border p-13 text-center">
      <h1 className="text-fs-text-primary text-base font-semibold">{title}</h1>
      <p className="text-fs-text-secondary text-sm">{hint}</p>
      <div className="flex items-center gap-6">
        {action}
        <Link href={paths.home.getHref()} className="type-label text-fs-text-accent">
          Browse sessions
        </Link>
      </div>
    </div>
  );
}
