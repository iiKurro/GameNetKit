/** The app's mark: a "G" ring (the target) crossed by a ping pulse. Same drawing as assets/logo.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="gnk-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#18222d" />
          <stop offset="1" stopColor="#0b0f14" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="248" height="248" rx="58" fill="url(#gnk-bg)" stroke="#2a3644" strokeWidth="3" />
      <path d="M 193.8 98.7 A 72 72 0 1 0 193.8 157.3" fill="none" stroke="#35d07f" strokeWidth="17" strokeLinecap="round" />
      <path d="M 82 134 L 104 134 L 120 86 L 142 180 L 158 134 L 214 134" fill="none" stroke="#e8edf3" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="214" cy="134" r="9" fill="#35d07f" />
    </svg>
  );
}
