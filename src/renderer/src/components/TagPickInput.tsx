import { useRef, useState } from 'react'
import type { JSX } from 'react'

// Single-value text input with an app-styled tag autocomplete (like the search
// box, but picking replaces the whole value instead of the last word). Used for
// the genre-rule name field.
export default function TagPickInput({
  value,
  onChange,
  tokens,
  placeholder,
  className,
  onEnter
}: {
  value: string
  onChange: (v: string) => void
  tokens: string[]
  placeholder?: string
  className?: string
  // Fires when Enter is pressed WITHOUT an active autocomplete highlight — used by
  // list inputs (favorite/exclude tags) to commit the typed value.
  onEnter?: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = value.trim().toLowerCase()
  const matches = q
    ? tokens.filter((t) => t.toLowerCase().includes(q) && t.toLowerCase() !== q).slice(0, 12)
    : []
  const show = open && matches.length > 0

  const pick = (tok: string): void => {
    onChange(tok)
    setOpen(false)
    setHi(-1)
    inputRef.current?.focus()
  }

  return (
    <div className="search-ac">
      <input
        ref={inputRef}
        type="text"
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHi(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (show && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            setHi((h) => {
              const n = matches.length
              return e.key === 'ArrowDown' ? (h + 1) % n : (h - 1 + n) % n
            })
            return
          }
          if (e.key === 'Escape') {
            setOpen(false)
            setHi(-1)
            return
          }
          if (e.key === 'Enter') {
            if (show && hi >= 0) {
              e.preventDefault()
              pick(matches[hi])
            } else if (onEnter) {
              e.preventDefault()
              setOpen(false)
              onEnter()
            }
          }
        }}
      />
      {show && (
        <ul className="search-ac-list">
          {matches.map((t, i) => (
            <li
              key={t}
              className={i === hi ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(t)
              }}
              onMouseEnter={() => setHi(i)}
            >
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
