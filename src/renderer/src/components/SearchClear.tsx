import type { JSX } from 'react'
import { CloseIcon } from './icons'

// "X" at the right end of a search box (only while it has text): clears the
// query and keeps the cursor in the box. Place it right after the <input>,
// inside a positioned wrapper (.search-ac).
export default function SearchClear({ value, onClear }: { value: string; onClear: () => void }): JSX.Element | null {
  if (!value) return null
  return (
    <button
      type="button"
      className="search-clear"
      title="검색어 지우기"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()} // don't steal focus from the input
      onClick={(e) => {
        onClear()
        ;(e.currentTarget.previousElementSibling as HTMLInputElement | null)?.focus()
      }}
    >
      <CloseIcon />
    </button>
  )
}
