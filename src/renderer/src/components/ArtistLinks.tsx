import type { JSX, MouseEvent } from 'react'
import { splitArtists } from '../util'

// One clickable link per artist, so "A, B" searches A or B — not the whole string.
export function ArtistLinks({
  artist,
  onPick,
  onMenu
}: {
  artist: string
  onPick: (a: string) => void
  onMenu: (a: string, e: MouseEvent) => void
}): JSX.Element {
  const list = splitArtists(artist)
  return (
    <>
      {list.map((a, i) => (
        <span key={a + i}>
          {i > 0 && ', '}
          <span
            className="artist-link"
            onClick={(e) => {
              e.stopPropagation()
              onPick(a)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onMenu(a, e)
            }}
          >
            {a}
          </span>
        </span>
      ))}
    </>
  )
}
