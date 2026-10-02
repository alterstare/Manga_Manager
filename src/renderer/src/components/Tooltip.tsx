import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'

// Global themed tooltip. Replaces the browser's white native tooltip: on hover of
// any element with a `title`, we stash+strip the attribute (so the native bubble
// never shows) and render our own styled box, restoring `title` on leave.
export default function Tooltip(): JSX.Element | null {
  // x = anchor center, y = below the anchor, top = the anchor's top (for flipping up).
  const [tip, setTip] = useState<{ x: number; y: number; top: number; text: string } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Place the box after it renders at its natural size: centered under the
  // anchor, but shifted to stay inside the window (near an edge it used to be
  // squeezed into a narrow column — "설/명"), and flipped above the anchor when
  // there's no room below.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!tip || !el) return setPos(null)
    const M = 8
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(M, Math.min(tip.x - w / 2, window.innerWidth - w - M))
    const below = tip.y + h + M <= window.innerHeight
    setPos({ left, top: below ? tip.y : Math.max(M, tip.top - 6 - h) })
  }, [tip])

  useEffect(() => {
    let timer: number | undefined
    let cur: HTMLElement | null = null

    const restore = (): void => {
      if (cur && cur.dataset.tip != null) {
        cur.setAttribute('title', cur.dataset.tip)
        delete cur.dataset.tip
      }
      cur = null
    }

    const over = (e: MouseEvent): void => {
      const el = (e.target as HTMLElement)?.closest?.('[title]') as HTMLElement | null
      if (!el || el === cur) return
      const text = el.getAttribute('title')
      if (!text) return
      restore()
      cur = el
      el.dataset.tip = text
      el.removeAttribute('title')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        setTip({ x: r.left + r.width / 2, y: r.bottom + 6, top: r.top, text })
      }, 350)
    }

    const out = (e: MouseEvent): void => {
      // Ignore moves that stay inside the current element.
      if (cur && e.relatedTarget instanceof Node && cur.contains(e.relatedTarget)) return
      window.clearTimeout(timer)
      restore()
      setTip(null)
    }

    // React re-adds `title` (with a new value) to the element we stripped when its
    // state changes under the cursor (e.g. a sort-dir toggle). Catch that: re-strip
    // and refresh the shown text so the native bubble never reappears and ours
    // isn't stale.
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.target !== cur) continue
        const t = (cur as HTMLElement).getAttribute('title')
        if (t == null) continue
        cur!.dataset.tip = t
        cur!.removeAttribute('title')
        setTip((prev) => (prev ? { ...prev, text: t } : prev))
      }
    })
    obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['title'] })

    document.addEventListener('mouseover', over, true)
    document.addEventListener('mouseout', out, true)
    return () => {
      document.removeEventListener('mouseover', over, true)
      document.removeEventListener('mouseout', out, true)
      obs.disconnect()
      window.clearTimeout(timer)
      restore()
    }
  }, [])

  if (!tip) return null
  return createPortal(
    <div
      ref={boxRef}
      className="tooltip"
      // Measured off-screen first (hidden), then placed by the layout effect.
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {tip.text}
    </div>,
    document.body
  )
}
