import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";

import { SectionCard } from "@/components/ui/SectionCard";

export function PredictCard() {
  return (
    <SectionCard
      className={clsx(
        "p-4 md:px-8",
        "flex flex-wrap items-start justify-center gap-x-8 gap-y-4",
        "md:flex-row md:items-center md:justify-between",
      )}
    >
      <h3 className="text-fs-text-primary text-base font-semibold">Predict all the estimates above</h3>
      <Button text="Predict selected" isDisabled />
    </SectionCard>
  );
}
