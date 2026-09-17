import { EstimateCsvDialog } from "@/features/predict/components/EstimateCsvDialog";
import type { SessionDetail } from "@/features/sessions/types";
import { optionNoun } from "@/features/sessions/utils/optionNoun";
import { TradeWallet } from "@/features/trade-executor/components/TradeWallet/TradeWallet";

import { SectionCard } from "@/components/ui/SectionCard";

import { toWalletMarket } from "./toWalletMarket";

interface ParticipateSectionProps {
  session: SessionDetail;
  marketEstimates: Record<string, number | undefined>;
  canEstimate: boolean;
}

export function ParticipateSection({ session, marketEstimates, canEstimate }: ParticipateSectionProps) {
  const noun = optionNoun(session.itemNamePlural);
  const market = toWalletMarket(session);

  return (
    <section className="flex w-full flex-col gap-4">
      <h2 className="text-fs-text-primary text-2xl font-semibold">Participate</h2>

      {market ? <TradeWallet market={market} noun={noun} /> : null}

      <SectionCard className="px-4 py-6 md:px-8">
        <p className="text-fs-text-secondary text-sm">
          <strong className="text-fs-text-primary text-base">Set estimates for the {noun} below.</strong> <br />
          You can choose how many {noun} you want to predict. <br />
          Note that the same capital can be used to predict on all {noun} at once.
        </p>
      </SectionCard>

      <div className="flex w-full justify-end">
        <EstimateCsvDialog
          parentMarket={session.parentMarket}
          scales={session.options}
          marketEstimates={marketEstimates}
          noun={noun}
          isDisabled={!canEstimate}
        />
      </div>
    </section>
  );
}
