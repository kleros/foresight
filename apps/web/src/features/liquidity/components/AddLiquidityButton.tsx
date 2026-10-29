import { useId } from "react";

import { Button } from "@kleros/ui-components-library";

/** "Add liquidity", disabled with its reason said beside it and as its description. */
export function AddLiquidityButton({
  reason,
  onPress,
  small = false,
}: {
  reason?: string;
  onPress: () => void;
  small?: boolean;
}) {
  const reasonId = useId();
  return (
    <span className="flex flex-wrap items-center gap-3">
      <Button
        text="Add liquidity"
        variant="secondary"
        small={small}
        isDisabled={reason !== undefined}
        aria-describedby={reason !== undefined ? reasonId : undefined}
        onPress={onPress}
      />
      {reason !== undefined ? (
        <span id={reasonId} className="type-caption text-fs-text-secondary">
          {reason}
        </span>
      ) : null}
    </span>
  );
}
