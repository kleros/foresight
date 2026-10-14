import type { SessionDetail } from "@/features/sessions/types";
import { optionNoun } from "@/features/sessions/utils/optionNoun";

/** The section's heading and the one sentence that says what to do in it. */
export function ParticipateSection({ session }: { session: SessionDetail }) {
  const noun = optionNoun(session.itemNamePlural);

  return (
    <header className="flex flex-col gap-1.5">
      <h2 className="type-h1 text-fs-text-primary">Participate</h2>
      <p className="type-label text-fs-text-secondary">
        Set an estimate for each of the {noun} you want to predict. The same funds back every estimate at once.
      </p>
    </header>
  );
}
