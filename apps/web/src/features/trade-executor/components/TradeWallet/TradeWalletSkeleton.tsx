import { SectionCard } from "@/components/ui/SectionCard";

export function TradeWalletSkeleton() {
  return (
    <SectionCard className="px-4 py-6 md:px-8">
      <div aria-busy>
        <div className="fs-skeleton mb-3 h-7 w-32" />
        <div className="fs-skeleton mb-6 h-5 w-52 md:w-96" />
        <div className="fs-skeleton h-11 w-32" />
      </div>
    </SectionCard>
  );
}
