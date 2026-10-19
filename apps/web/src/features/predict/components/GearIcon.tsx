export function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path
        d="M8.3 2.5h3.4l.5 2.1 1.5.9 2.1-.6 1.7 2.9-1.6 1.5v1.4l1.6 1.5-1.7 2.9-2.1-.6-1.5.9-.5 2.1H8.3l-.5-2.1-1.5-.9-2.1.6-1.7-2.9 1.6-1.5V9.3L2.5 7.8l1.7-2.9 2.1.6 1.5-.9.5-2.1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
