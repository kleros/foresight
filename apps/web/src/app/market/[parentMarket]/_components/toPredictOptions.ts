import type { PredictOption } from "@/features/predict/flow/types";
import type { SelectedEstimate } from "@/features/predict/types";
import type { SessionDetail } from "@/features/sessions/types";

import { estimateToPriceWad } from "@/utils/optionPrice";

/** The selected estimates as the options a run trades. Options missing any token are left out. */
export function toPredictOptions(session: SessionDetail, selected: SelectedEstimate[]): PredictOption[] {
  return selected.flatMap((estimate) => {
    const option = session.options.find((each) => each.market === estimate.scale.market);
    if (!option?.upToken || !option.downToken || !option.underlyingToken || !option.invalidToken) {
      return [];
    }
    return [
      {
        childMarket: option.market,
        underlying: option.underlyingToken,
        upToken: option.upToken,
        downToken: option.downToken,
        // each child wraps its own INVALID; the decision's would not burn here
        invalidToken: option.invalidToken,
        targetPriceWad: estimateToPriceWad(estimate.value, option),
      },
    ];
  });
}
