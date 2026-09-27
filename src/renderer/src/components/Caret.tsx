import type { JSX } from 'react'

// Rotating chevron for drawer / sort-direction / dropdown indicators. Drawn as an
// SVG so the glyph is geometrically centered — rotating up/down pivots on center
// and never shifts sideways (a text ‹›› glyph is off-center and would drift).
export default function Caret({ up }: { up?: boolean }): JSX.Element {
  return (
    <svg
      className="caret"
      viewBox="0 0 24 24"
      style={{ transform: up ? 'rotate(-90deg)' : 'rotate(90deg)' }}
      aria-hidden
    >
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
