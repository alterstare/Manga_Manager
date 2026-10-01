import { useEffect, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { loadThumb, peekThumb, syncThumbNonce, onThumb } from '../thumbs'
import { getImages } from '../images'
import { useStore } from '../store'

// Hover-to-peek for a thumbnail: after hovering 750ms a large preview pops up
// beside it (PreviewPortal) and the wheel pages through the work (down = next).
// `getImgs` is fetched lazily on the first peek. Spread `handlers` onto the
// thumb element (attached to `ref`) and render `portal` inside it.
export function useHoverPreview(
  ref: RefObject<HTMLDivElement | null>,
  getImgs: () => Promise<string[]>
): { handlers: { onMouseEnter: () => void; onMouseLeave: () => void }; portal: JSX.Element | null } {
  const previewOn = useStore((s) => s.settings.thumbHoverPreview !== false)
  const enterTimer = useRef<number | undefined>(undefined)
  const [preview, setPreview] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [imgs, setImgs] = useState<string[] | null>(null)
  const [idx, setIdx] = useState(0)

  // While previewing, capture the wheel on the thumb (non-passive so the list
  // doesn't scroll) and step through pages.
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
  }, [preview, imgs, ref])

  // A pending timer must not fire after the card unmounted.
  useEffect(() => () => window.clearTimeout(enterTimer.current), [])

  const onMouseEnter = (): void => {
    if (!previewOn) return
    const el = ref.current
    if (!el) return
    window.clearTimeout(enterTimer.current)
    enterTimer.current = window.setTimeout(() => {
      setRect(el.getBoundingClientRect())
      setIdx(0)
      setPreview(true)
      getImgs()
        .then((a) => setImgs(a))
        .catch(() => setImgs([]))
    }, 750)
  }
  const onMouseLeave = (): void => {
    window.clearTimeout(enterTimer.current)
    setPreview(false)
  }

  const portal =
    preview && rect && imgs && imgs.length > 0 ? (
      <PreviewPortal rect={rect} src={imgs[idx]} page={idx + 1} total={imgs.length} onClose={onMouseLeave} />
    ) : null
  return { handlers: { onMouseEnter, onMouseLeave }, portal }
}

// Thumbnail url of a local work: the cached ≤480px webp (generated once, then
// reused). Starts with the in-memory value when already known; otherwise waits
// until `enabled` and loads it, and picks up a later (re)generation. A thumb
// regen elsewhere (thumbNonce bump) refetches from disk.
export function useWorkThumb(workId: string | undefined, enabled = true): string | null {
  const [src, setSrc] = useState<string | null>(() => (workId ? peekThumb(workId) ?? null : null))
  const nonce = useStore((s) => s.thumbNonce)
  useEffect(() => {
    if (!workId) return setSrc(null)
    if (!enabled) return
    let alive = true
    syncThumbNonce(nonce)
    loadThumb(workId).then((c) => alive && setSrc(c))
    const off = onThumb(workId, (c) => alive && setSrc(c))
    return () => {
      alive = false
      off()
    }
  }, [workId, enabled, nonce])
  return src
}

// Local work thumbnail. Loading is deferred until the card is near the
// viewport (unless the thumb is already in memory); hover shows the preview.
export default function Thumb({ workId }: { workId: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => peekThumb(workId) !== undefined)
  const src = useWorkThumb(workId, visible)
  const { handlers, portal } = useHoverPreview(ref, () => getImages(workId))

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="thumb" ref={ref} {...handlers}>
      {src ? <img src={src} loading="lazy" alt="" /> : <div className="thumb-ph" />}
      {portal}
    </div>
  )
}

// Floating large preview, positioned beside the thumb and clamped to the viewport.
// pointer-events: none so it never eats the hover (the wheel is handled on the thumb).
export function PreviewPortal({
  rect,
  src,
  page,
  total,
  onClose
}: {
  rect: DOMRect
  src: string
  page: number
  total: number
  onClose?: () => void
}): JSX.Element {
  // Safety net: dismiss the floating preview on any click / key / scroll / focus
  // loss. Without this, clicking a card to open it (which switches the view so the
  // thumb's mouseleave never fires) would strand the portal over the new screen
  // with no way to close it.
  useEffect(() => {
    if (!onClose) return
    const close = (): void => onClose()
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', close, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', close, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

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
