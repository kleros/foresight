import { StepsTimeline } from "@/components/ui/StepsTimeline";

import type { PredictSteps } from "../utils/predictSteps";

/** The predict popup's three steps; `predict-steps` lets the funds row's credits and deposit wrap. */
export function PredictStepsTimeline({ steps }: { steps: PredictSteps }) {
  return <StepsTimeline rows={steps.rows} stopped={steps.failure !== undefined} className="predict-steps" />;
}
