import { ForesightIcon, type ForesightIconName } from "@/components/ui/ForesightIcon";

/**
 * Tones are named for what the reader is being told, not for a registry state.
 */
const TONES = {
  done: { token: "registered", icon: "registered" },
  attention: { token: "challenged", icon: "challenged" },
  none: { token: "absent", icon: "unlisted" },
} satisfies Record<string, { token: string; icon: ForesightIconName }>;

type StatusTone = keyof typeof TONES;

export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  const { token, icon } = TONES[tone];
  return (
    <span
      className="fs-status"
      style={{
        color: `var(--fs-status-${token})`,
        background: `var(--fs-status-${token}-bg)`,
        borderColor: `var(--fs-status-${token})`,
      }}
    >
      <ForesightIcon name={icon} size={12} />
      {label}
    </span>
  );
}
