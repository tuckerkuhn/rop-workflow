export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-forest" />
      <path
        d="M6 22c6-4 14-4 20 0M6 17.5c6-4 14-4 20 0M8 13c5-3.2 11-3.2 16 0"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="stroke-forest-ink"
      />
      <circle cx="22.5" cy="8.5" r="2.4" className="fill-ochre" />
    </svg>
  );
}
