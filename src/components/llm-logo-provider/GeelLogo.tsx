type GeelLogoProps = { className?: string };

// Minimal "Geel" glyph — orange organic ring + dot. Distinct from Claude/Cursor/Codex/Gemini.
export default function GeelLogo({ className = 'w-5 h-5' }: GeelLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Geel"
      role="img"
    >
      <defs>
        <linearGradient id="geel-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f97316" />
          <stop offset="1" stopColor="#ea580c" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="9" fill="none" stroke="url(#geel-grad)" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill="url(#geel-grad)" />
    </svg>
  );
}
