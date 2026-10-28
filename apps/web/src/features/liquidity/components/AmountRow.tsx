import { formatDisplayAmount } from "@/utils/amount";

import type { TokenAmount } from "../hooks/useSessionLiquidity";

/** A popup's figure row: what it is on the left, each amount on a line of its own on the right, a long name wrapping. */
export function AmountRow({ label, amounts }: { label: string; amounts: TokenAmount[] }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fs-popup-text-2 shrink-0">{label}</dt>
      <dd className="text-fs-popup-text min-w-0 text-right wrap-anywhere">
        {amounts.map(({ label: token, amount }) => (
          <span key={token} className="block">
            {formatDisplayAmount(amount, 18)} {token}
          </span>
        ))}
      </dd>
    </div>
  );
}
