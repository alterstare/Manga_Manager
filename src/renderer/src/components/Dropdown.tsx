import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import Caret from './Caret'

// Custom select styled like the home category chips: a button showing the
// current label + a ▾ triangle that flips to ▴ while open. Used where a native
// <select> arrow looks out of place.
export default function Dropdown<T extends string>({
  value,
  options,
  onChange,
  className = '',
  chip = false
}: {
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (v: T) => void
  className?: string
  // Render the button as a toolbar chip (like 작품 분류 ▾) instead of a field.
  chip?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const label = options.find(([v]) => v === value)?.[1] ?? value

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className={`dropdown ${className}`} ref={ref}>
      {chip ? (
        <button type="button" className="chip" onClick={() => setOpen((o) => !o)}>
          {label} <span className={`dt ${open ? 'up' : ''}`} />
        </button>
      ) : (
        <button type="button" className="dropdown-btn" onClick={() => setOpen((o) => !o)}>
          <span className="dropdown-label">{label}</span>
          <span className="dropdown-arrow">
            <Caret up={open} />
          </span>
        </button>
      )}
      {open && (
        <div className="dropdown-panel">
          {options.map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={`dropdown-opt ${v === value ? 'sel' : ''}`}
              onClick={() => {
                onChange(v)
                setOpen(false)
              }}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
