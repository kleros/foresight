import { ForesightIcon, type ForesightIconName } from "@/components/ui/ForesightIcon";

const TONES = {
  done: { tone: "success", icon: "check" },
  attention: { tone: "info", icon: "alert" },
  none: { tone: "neutral", icon: "empty" },
} satisfies Record<string, { tone: string; icon: ForesightIconName }>;

export type StatusTone = keyof typeof TONES;

export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  const { tone: token, icon } = TONES[tone];
  return (
    <span
      className="fs-status"
      style={{
        color: `var(--fs-tone-${token})`,
        background: `var(--fs-tone-${token}-bg)`,
        borderColor: `var(--fs-tone-${token})`,
      }}
    >
      <ForesightIcon name={icon} size={12} />
      {label}
    </span>
  );
}
