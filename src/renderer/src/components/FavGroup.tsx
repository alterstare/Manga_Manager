import type { JSX, MouseEvent } from 'react'
import type { Work } from '../../../shared/types'
import GroupButton from './GroupButton'

// Segmented control that fuses the favorite (♥) and group (＋) buttons into one
// framed pill with a divider, each half acting as its own button. Keeps the two
// visually aligned (same frame) instead of two loose glyphs of differing bulk.
export default function FavGroup({
  favorite,
  onToggle,
  work,
  applyTo
}: {
  favorite: boolean
  onToggle: (e: MouseEvent) => void
  work: Work
  applyTo?: Work[]
}): JSX.Element {
  return (
    <span className="seg" onClick={(e) => e.stopPropagation()}>
      <span className={`seg-heart ${favorite ? 'on' : ''}`} title="즐겨찾기" onClick={onToggle}>
        ♥
      </span>
      <GroupButton work={work} applyTo={applyTo} />
    </span>
  )
}
