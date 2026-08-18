import clsx from "clsx";

export function SectionHeader({
  step,
  kicker,
  title,
  lede,
  ok,
  active,
}: {
  step: number;
  kicker: string;
  title: string;
  lede?: string;
  ok: boolean;
  active: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "rounded-fs inline-flex h-6 w-6 flex-none items-center justify-center border text-[13px] font-semibold tabular-nums",
            active ? "bg-fs-surface-tint border-fs-border-accent" : "border-fs-border bg-transparent",
            ok || active ? "text-fs-text-primary" : "text-fs-text-secondary",
          )}
        >
          {step}
        </span>
        <span className="type-caption text-fs-text-secondary tracking-[0.04em] uppercase">{kicker}</span>
      </div>
      <h1 className={clsx("type-h1 text-fs-text-primary max-w-[24ch] pt-3 text-pretty", lede ? "pb-2" : "pb-6")}>
        {title}
      </h1>
      {lede ? <p className="type-body text-fs-text-secondary mb-6 max-w-[62ch] text-pretty">{lede}</p> : null}
    </>
  );
}
