import type { JSX } from 'react'

// Small, uniform-stroke line icons for card/list action buttons. They inherit
// `color` via `currentColor` and size to `1em`, so the surrounding span's font
// color/size drives them (see `.seg-ico` in styles.css).

interface IconProps {
  className?: string
}

// Clean, even-weight check — replaces the ✓ glyph on finished downloads.
export function CheckIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12.5l5.2 5.2L20 6.5" />
    </svg>
  )
}

// Pause — shown while a download is in flight (click to stop/pause it).
export function PauseIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" />
    </svg>
  )
}

// Play — shown on a paused download (click to resume from where it stopped).
export function PlayIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <path d="M7.5 5.6c0-.9 1-1.5 1.8-1L18 9.9c.8.5.8 1.7 0 2.2l-8.7 5.3c-.8.5-1.8-.1-1.8-1V5.6z" />
    </svg>
  )
}

// Two circular arrows — the "converting" (avif→webp) indicator.
export function ConvertIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11a8 8 0 0 0-14.9-3.5" />
      <path d="M4.5 4.5v3.5H8" />
      <path d="M4 13a8 8 0 0 0 14.9 3.5" />
      <path d="M19.5 19.5V16H16" />
    </svg>
  )
}

// A clean X for cancel/remove.
export function XIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
