import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { loadThumb, invalidateThumb } from '../thumbs'
import { getImages } from '../images'
import { useStore } from '../store'

// Loads the cached thumbnail (generated once, reused forever). Defers work until
// the card is near the viewport. Hovering pops a large preview that the wheel
// pages through (down = next page, up = previous).
export default function Thumb({ workId }: { workId: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  // Bumped after an online cover regen → drop the cached thumb and reload.
  const nonce = useStore((s) => s.thumbNonce)
  const previewOn = useStore((s) => s.settings.thumbHoverPreview !== false)

  // Hover preview state.
  const enterTimer = useRef<number | undefined>(undefined)
  const [preview, setPreview] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [imgs, setImgs] = useState<string[] | null>(null)
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '400px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let alive = true
    if (nonce > 0) invalidateThumb(workId) // regen happened → refetch from disk
    loadThumb(workId).then((c) => alive && setSrc(c))
    return () => {
      alive = false
    }
  }, [visible, workId, nonce])

  // While previewing, capture the wheel on the thumb (non-passive so we can stop
  // the list from scrolling) and step through pages.
  useEffect(() => {
    const el = ref.current
    if (!el || !preview) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      setIdx((i) => {
        const n = imgs?.length ?? 0
        if (n === 0) return i
        return Math.max(0, Math.min(n - 1, i + (e.deltaY > 0 ? 1 : -1)))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [preview, imgs])

  const onEnter = (): void => {
    if (!previewOn) return
    const el = ref.current
    if (!el) return
    window.clearTimeout(enterTimer.current)
    enterTimer.current = window.setTimeout(() => {
      setRect(el.getBoundingClientRect())
      setIdx(0)
      setPreview(true)
      getImages(workId).then((a) => setImgs(a))
    }, 750)
  }
  const onLeave = (): void => {
    window.clearTimeout(enterTimer.current)
    setPreview(false)
  }

  return (
    <div className="thumb" ref={ref} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {src ? <img src={src} loading="lazy" alt="" /> : <div className="thumb-ph" />}
      {preview && rect && imgs && imgs.length > 0 && (
        <PreviewPortal rect={rect} src={imgs[idx]} page={idx + 1} total={imgs.length} />
      )}
    </div>
  )
}

// Floating large preview, positioned beside the thumb and clamped to the viewport.
// pointer-events: none so it never eats the hover (the wheel is handled on the thumb).
export function PreviewPortal({
  rect,
  src,
  page,
  total
}: {
  rect: DOMRect
  src: string
  page: number
  total: number
}): JSX.Element {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(560, Math.round(vw * 0.5))
  const h = Math.round(vh * 0.86)
  let left = rect.right + 12
  if (left + w > vw - 8) left = rect.left - 12 - w
  if (left < 8) left = Math.max(8, Math.round((vw - w) / 2))
  let top = rect.top + rect.height / 2 - h / 2
  top = Math.max(8, Math.min(top, vh - h - 8))
  return createPortal(
    <div className="thumb-preview" style={{ left, top, width: w, height: h }}>
      <img src={src} alt="" />
      <div className="thumb-preview-page">
        {page} / {total}
      </div>
    </div>,
    document.body
  )
}
