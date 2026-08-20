import { PER_PAGE } from "../utils/listing";

function SessionCardSkeleton() {
  return (
    <div className="fs-session-card fs-session-card--static">
      <div className="fs-session-card__inner border-gradient-purple-blue">
        <div className="fs-session-card__banner">
          <div className="fs-skeleton size-full" />
        </div>

        <div className="fs-session-card__body">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-4.5">
            <div className="border-b-klerosUIComponentsSecondaryBlue flex shrink-0 flex-col gap-2 border-b pb-4">
              <div className="flex min-h-lh items-center text-base">
                <div className="fs-skeleton h-4 w-3/5" />
              </div>
              <div className="flex min-h-[2lh] flex-col gap-1.5 text-sm leading-relaxed">
                <div className="fs-skeleton h-3 w-full" />
                <div className="fs-skeleton h-3 w-4/5" />
              </div>
            </div>

            <div className="mt-4 flex min-h-1lh shrink-0 items-center gap-2 text-sm">
              <div className="fs-skeleton size-4" />
              <div className="fs-skeleton h-3 w-24" />
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between p-6">
            <div className="fs-skeleton size-10" />
            <div className="fs-skeleton h-3 w-12" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SessionGridSkeleton() {
  return (
    <div className="fs-session-grid" aria-hidden>
      {Array.from({ length: PER_PAGE }, (_, index) => (
        <SessionCardSkeleton key={index} />
      ))}
    </div>
  );
}
