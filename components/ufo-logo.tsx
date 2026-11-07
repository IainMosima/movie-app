/**
 * Spaceflix mark: a saucer with a glass dome and a soft tractor beam.
 * Inherits size from className and colour from `currentColor`; the dome and
 * the lights take the accent so it reads on the purple tile and on black.
 */
export function UfoLogo({ className, accent = "#c4b5fd" }: { className?: string; accent?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Spaceflix" fill="none">
      {/* tractor beam */}
      <path d="M24 41 L17 58 H47 L40 41 Z" fill={accent} opacity="0.22" />
      {/* glass dome */}
      <path d="M21 30 C21 19 26.5 13 32 13 C37.5 13 43 19 43 30 Z" fill={accent} opacity="0.9" />
      <path d="M27 21 C28.5 18 30.5 16.6 32.5 16.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      {/* saucer body */}
      <ellipse cx="32" cy="33" rx="27" ry="8.5" fill="currentColor" />
      <ellipse cx="32" cy="31" rx="20" ry="4" fill={accent} opacity="0.35" />
      {/* rim lights */}
      <circle cx="16" cy="34.5" r="2" fill={accent} />
      <circle cx="32" cy="37" r="2" fill={accent} />
      <circle cx="48" cy="34.5" r="2" fill={accent} />
    </svg>
  );
}
