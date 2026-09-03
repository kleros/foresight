import type { ComponentType, ReactNode, SVGProps } from "react";

export function SessionStat({
  Icon,
  label,
  pending,
  children,
}: {
  Icon: ComponentType<SVGProps<SVGElement>>;
  label: string;
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Icon className="text-fs-accent size-4 shrink-0 [&_path]:fill-current" />
      <span className="text-fs-text-secondary shrink-0 text-sm">{label}:</span>
      {pending ? (
        <span className="fs-skeleton inline-block h-4 w-12" />
      ) : (
        <span className="text-fs-text-primary text-sm font-semibold">{children}</span>
      )}
    </div>
  );
}
