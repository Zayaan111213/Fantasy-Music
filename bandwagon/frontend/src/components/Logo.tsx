// Brand logo: the gold bandwagon mark + the two-tone serif wordmark.
// Colors are fixed brand hexes from the vintage colorway spec, not theme
// classes, so the mark renders identically everywhere (app, modals, auth).
//
// This is the bare wagon glyph only, no background tile — that square badge
// treatment is reserved for the app icon (favicon.svg / manifest icons),
// which uses its own cream colorway. In-app the mark floats directly on the
// dark UI background.

export function WagonMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className} aria-hidden="true">
      <rect x="30" y="45" width="60" height="26" rx="7" fill="#E8B23A" />
      <rect x="30" y="45" width="60" height="7" rx="3.5" fill="#F0C766" />
      <line x1="30" y1="58" x2="16" y2="51" stroke="#E8B23A" strokeWidth="6" strokeLinecap="round" />
      <circle cx="42" cy="86" r="13" fill="#12100b" />
      <circle cx="42" cy="86" r="4.5" fill="#E07A3E" />
      <circle cx="82" cy="86" r="13" fill="#12100b" />
      <circle cx="82" cy="86" r="4.5" fill="#E07A3E" />
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-serif font-bold text-white ${className}`}>
      band<span className="text-amber-400">wagoner</span>
    </span>
  );
}
