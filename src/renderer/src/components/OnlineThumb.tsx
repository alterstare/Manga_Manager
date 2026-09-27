import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { useStore } from '../store'
import { PreviewPortal } from './Thumb'

// Online-card thumbnail with the same hover-to-peek preview as local Thumb. The
// image list is supplied by `getImgs` (hitomi = direct; toki = series→first
// chapter), fetched lazily on hover. Wheel pages through it. `children` (e.g. the
// download progress bar) render over the thumbnail.
export default function OnlineThumb({
  getImgs,
  thumbUrl,
  children,
  className = 'gcard-thumb'
}: {
  getImgs: () => Promise<string[]>
  thumbUrl: string | null
  children?: ReactNode
  className?: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const previewOn = useStore((s) => s.settings.thumbHoverPreview !== false)
  const enterTimer = useRef<number | undefined>(undefined)
  const [preview, setPreview] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [imgs, setImgs] = useState<string[] | null>(null)
  const [idx, setIdx] = useState(0)

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

  // Clean up the pending timer on unmount.
  useEffect(() => () => window.clearTimeout(enterTimer.current), [])

  const onEnter = (): void => {
    if (!previewOn) return
    const el = ref.current
    if (!el) return
    window.clearTimeout(enterTimer.current)
    enterTimer.current = window.setTimeout(() => {
      setRect(el.getBoundingClientRect())
      setIdx(0)
      setPreview(true)
      // Online fetch can be slow (network); getImgs caches where possible.
      getImgs()
        .then((a) => setImgs(a))
        .catch(() => setImgs([]))
    }, 750)
  }
  const onLeave = (): void => {
    window.clearTimeout(enterTimer.current)
    setPreview(false)
  }

  return (
    <div className={className} ref={ref} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {thumbUrl ? <img src={thumbUrl} loading="lazy" alt="" /> : <div className="thumb-ph" />}
      {children}
      {preview && rect && imgs && imgs.length > 0 && (
        <PreviewPortal rect={rect} src={imgs[idx]} page={idx + 1} total={imgs.length} />
      )}
    </div>
  )
}
