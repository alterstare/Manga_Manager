import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'

// Global themed tooltip. Replaces the browser's white native tooltip: on hover of
// any element with a `title`, we stash+strip the attribute (so the native bubble
// never shows) and render our own styled box, restoring `title` on leave.
export default function Tooltip(): JSX.Element | null {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)

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
        setTip({ x: r.left + r.width / 2, y: r.bottom + 6, text })
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
    <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>,
    document.body
  )
}
