import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  color?: string // optional swatch shown before the label
  children?: MenuItem[] // submenu (flyout)
}

function Row({ item, onClose }: { item: MenuItem; onClose: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  if (item.children) {
    return (
      <div
        className="ctx-item has-sub"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <span className="ctx-label">{item.label}</span>
        <span className="ctx-arrow">›</span>
        {open && (
          <div className="ctx-submenu">
            {item.children.map((c, i) => (
              <Row key={i} item={c} onClose={onClose} />
            ))}
          </div>
        )}
      </div>
    )
  }
  return (
    <button
      className={`ctx-item ${item.danger ? 'danger' : ''}`}
      disabled={item.disabled}
      onClick={() => {
        onClose()
        item.onClick?.()
      }}
    >
      {item.color && <span className="ctx-swatch" style={{ background: item.color }} />}
      {item.label}
    </button>
  )
}

// A right-click menu rendered at the cursor, with optional one-or-more-level
// submenus. Closes on outside click, Esc, scroll, resize, or after a leaf click.
export default function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useEffect(() => {
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({
        x: Math.min(x, window.innerWidth - r.width - 8),
        y: Math.min(y, window.innerHeight - r.height - 8)
      })
    }
    const close = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [x, y, onClose])

  // Portal to <body> so a card's `content-visibility`/`contain` (which makes the
  // card a containing block for position:fixed) can't trap or clip the menu.
  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((it, i) => (
        <Row key={i} item={it} onClose={onClose} />
      ))}
    </div>,
    document.body
  )
}
