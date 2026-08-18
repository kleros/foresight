import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";

import { ForesightIcon } from "@/components/ui/ForesightIcon";

import { StatusChip } from "./StatusChip";
import { TxHashLink } from "./TxHashLink";
import type { SessionDeployProgress } from "../deploy/types";
import { useDraftStore } from "../stores/draftStore";
import { branchDisplayName, branchMarketName } from "../utils/branchFields";

type Row = { key: string; name: string; created: boolean; hash?: string };

function MarketList({ rows, created }: { rows: Row[]; created: boolean }) {
  return (
    <div className="bg-fs-surface-sunken border-fs-border rounded-fs border px-4 py-3.5">
      <div className="type-caption text-fs-text-secondary pb-2">{created ? "Already on-chain" : "Still missing"}</div>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row.key}
            className={clsx(
              "type-label flex items-center gap-2",
              created ? "text-fs-text-primary" : "text-fs-text-secondary",
            )}
          >
            <ForesightIcon
              name={created ? "outcome" : "unlisted"}
              size={14}
              className={created ? "text-fs-status-registered" : "text-fs-status-unlisted"}
            />
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            {created ? <TxHashLink hash={row.hash} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Coming back to a deploy that stopped, on chain or not. A half-deployed session
 * is unusable and only its deployer can finish it, so this is a first-class
 * arrival, not an error screen.
 */
export function ResumeBanner({ progress, onContinue }: { progress: SessionDeployProgress; onContinue: () => void }) {
  const { draft } = useDraftStore();

  const rows: Row[] = [
    {
      key: "parent",
      name: draft.name.trim() || "Decision market",
      created: progress.parent.state === "success",
      hash: progress.parent.hash,
    },
    ...progress.children.flatMap((child, index) => {
      const outcome = draft.outcomes[index];
      if (!outcome) return [];
      const name = branchDisplayName(outcome, index);
      return [
        {
          key: outcome.id,
          name: child.state === "success" ? name : `${name}: ${branchMarketName(draft, outcome)}`,
          created: child.state === "success",
          hash: child.hash,
        },
      ];
    }),
  ];

  const created = rows.filter((row) => row.created);
  const missing = rows.filter((row) => !row.created);

  const state =
    progress.parent.state !== "success"
      ? { headline: "has a deploy that stopped", chip: "Interrupted" }
      : missing.length > 0
        ? { headline: "is live, but unfinished", chip: "Incomplete" }
        : { headline: "is on chain, one step from done", chip: "Unconfirmed" };

  return (
    <section data-screen-label="Resume an incomplete session" className="pb-14">
      <div className="fs-grad-border bg-fs-surface flex flex-col gap-4.5 px-7 py-6">
        <div className="flex items-start gap-3.5">
          <ForesightIcon name="phased-deploy" size={24} className="text-fs-accent-protocol" />
          <div className="min-w-0 flex-1">
            <div className="type-caption text-fs-text-secondary">Picked up from your draft</div>
            <div className="text-fs-text-primary text-xl font-semibold text-pretty">
              {draft.title.trim() || "Untitled session"} {state.headline}
            </div>
          </div>
          <StatusChip tone="attention" label={state.chip} />
        </div>

        <div className={clsx("grid grid-cols-1 gap-4", created.length > 0 && missing.length > 0 && "md:grid-cols-2")}>
          {created.length > 0 ? <MarketList rows={created} created /> : null}
          {missing.length > 0 ? <MarketList rows={missing} created={false} /> : null}
        </div>

        {/* Wrapped so the button keeps its own width in a column that stretches. */}
        <div className="flex">
          <Button text="Continue where it stopped" onPress={onContinue} />
        </div>
      </div>
    </section>
  );
}
