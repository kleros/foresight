/** The range a branch market will be answered within, drawn lower to upper. */
export function ScalarRangeTrack({
  lowerBound = 0,
  upperBound = 100,
  unit = "",
  label,
  className,
}: {
  lowerBound?: number;
  upperBound?: number;
  unit?: string;
  label?: string;
  className?: string;
}) {
  const fmt = (n: number) => `${n.toLocaleString()}${unit ? ` ${unit}` : ""}`;
  return (
    <div className={className}>
      {label ? <div className="type-label text-fs-text-secondary mb-1.5">{label}</div> : null}
      <div className="fs-range">
        <div className="fs-range__track" />
        <div className="fs-range__bounds">
          <span>{fmt(lowerBound)}</span>
          <span>{fmt(upperBound)}</span>
        </div>
      </div>
    </div>
  );
}
