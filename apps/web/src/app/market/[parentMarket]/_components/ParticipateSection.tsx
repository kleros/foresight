import { Button } from "@kleros/ui-components-library";

import { SectionCard } from "./SectionCard";

export function ParticipateSection({ itemNamePlural }: { itemNamePlural: string | null }) {
  const noun = (itemNamePlural || "branches").toLowerCase();

  return (
    <section className="flex w-full flex-col gap-4">
      <h2 className="text-fs-text-primary text-2xl font-semibold">Participate</h2>

      <SectionCard className="px-4 py-6 md:px-8">
        <div className="flex flex-col gap-2">
          <h3 className="text-fs-text-primary text-base font-semibold">Trade wallet</h3>
          <p className="text-fs-text-secondary text-sm">
            Holds the money behind your predictions and places them all in one transaction. Yours appears here once you
            make your first prediction.
          </p>
        </div>
      </SectionCard>

      <SectionCard className="px-4 py-6 md:px-8">
        <p className="text-fs-text-secondary text-sm">
          <strong className="text-fs-text-primary text-base">Set estimates for the {noun} below.</strong> <br />
          You can choose how many {noun} you want to predict. <br />
          Note that the same capital can be used to predict on all {noun} at once.
        </p>
      </SectionCard>

      <div className="flex w-full justify-end">
        <Button text="Upload CSV Predictions" variant="secondary" isDisabled />
      </div>
    </section>
  );
}
