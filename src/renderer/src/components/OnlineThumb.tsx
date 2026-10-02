import { useRef } from 'react'
import type { JSX, ReactNode } from 'react'
import { useHoverPreview, useWorkThumb } from './Thumb'

// Online-card thumbnail with the same hover-to-peek preview as the local Thumb.
// The page list comes from `getImgs` (doujin = direct; manga-site = series → first
// chapter), fetched lazily on hover. `children` (e.g. the download progress
// bar) render over the thumbnail.
export default function OnlineThumb({
  getImgs,
  thumbUrl,
  children,
  className = 'gcard-thumb',
  localWorkId
}: {
  getImgs: () => Promise<string[]>
  thumbUrl: string | null
  children?: ReactNode
  className?: string
  // Already in the local library → show its local cover (instant, offline)
  // instead of the remote thumbUrl.
  localWorkId?: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const localSrc = useWorkThumb(localWorkId)
  const { handlers, portal } = useHoverPreview(ref, getImgs)
  const shown = localSrc ?? thumbUrl
  return (
    <div className={className} ref={ref} {...handlers}>
      {shown ? <img src={shown} loading="lazy" alt="" /> : <div className="thumb-ph" />}
      {children}
      {portal}
    </div>
  )
}
