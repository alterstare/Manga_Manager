import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent } from 'react'

interface Props {
  tags: string[]
  favoriteTags?: string[]
  manualTags?: string[]
  onTagClick?: (t: string) => void
  onTagContext?: (t: string, e: MouseEvent) => void
  onRemove?: (t: string) => void
  onAddClick?: () => void
  max?: number
  // Single-line (list cards): fit whole tags on one line, rest behind +N.
  // Off (grid cards): show up to `max`, wrapping to multiple rows (original behavior).
  singleLine?: boolean
}

export default function TagList({
  tags,
  favoriteTags = [],
  manualTags = [],
  onTagClick,
  onTagContext,
  onRemove,
  onAddClick,
  max = 8,
  singleLine = true
}: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [visible, setVisible] = useState(tags.length)
  const [width, setWidth] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const btnsRef = useRef<HTMLSpanElement>(null)

  const norm = (s: string): string =>
    s.toLowerCase().replace(/^[^:]+:/, '').replace(/_/g, ' ').trim()
  const favSet = new Set(favoriteTags.map(norm))
  const isFav = (t: string): boolean => favSet.has(norm(t))
  // Favorite tags float to the front (stable within each group).
  const ordered = [...tags].sort((a, b) => Number(isFav(b)) - Number(isFav(a)))

  useEffect(() => {
    if (!singleLine) return
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [singleLine])

  useLayoutEffect(() => {
    if (!singleLine || expanded) return
    const el = ref.current
    if (!el) {
      return
    }
    el.classList.add('measuring')
    const cw = el.clientWidth
    const gap = 6
    const tagEls = Array.from(el.querySelectorAll<HTMLElement>('.mtag'))
    const btnsW = btnsRef.current?.offsetWidth ?? 0
    let used = 0
    let count = 0
    for (let i = 0; i < tagEls.length; i++) {
      const tw = tagEls[i].offsetWidth
      const add = tw + (count > 0 ? gap : 0)
      if (used + add + gap + btnsW > cw) break
      used += add
      count++
    }
    el.classList.remove('measuring')
    setVisible(count)
  }, [tags, expanded, width, singleLine])

  const tagSpan = (t: string, i: number, clip: boolean): JSX.Element => (
    <span
      key={t}
      className={`tag mtag ${isFav(t) ? 'fav-tag' : ''} ${
        manualTags.includes(t) ? 'manual' : ''
      } ${clip ? 'clipped' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onTagClick?.(t)
      }}
      onContextMenu={
        onTagContext
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              onTagContext(t, e)
            }
          : undefined
      }
    >
      {t}
      {onRemove && manualTags.includes(t) && (
        <span
          className="tag-x"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(t)
          }}
        >
          ×
        </span>
      )}
    </span>
  )

  // Grid cards: original multi-row behavior (up to `max`, +N to reveal the rest).
  if (!singleLine) {
    const shown = expanded ? ordered : ordered.slice(0, max)
    const hidden = ordered.length - shown.length
    return (
      <>
        {shown.map((t, i) => tagSpan(t, i, false))}
        {!expanded && hidden > 0 && (
          <span className="tag add-tag" onClick={(e) => { e.stopPropagation(); setExpanded(true) }}>
            +{hidden}
          </span>
        )}
        {expanded && ordered.length > max && (
          <span className="tag add-tag" onClick={(e) => { e.stopPropagation(); setExpanded(false) }}>
            접기
          </span>
        )}
        {onAddClick && (
          <span className="tag add-tag" onClick={(e) => { e.stopPropagation(); onAddClick() }}>
            + 태그
          </span>
        )}
      </>
    )
  }

  // List cards: one line, whole tags only, buttons pinned on the line.
  const hidden = ordered.length - visible
  return (
    <div ref={ref} className={`taglist-line ${expanded ? 'expanded' : ''}`}>
      {ordered.map((t, i) => tagSpan(t, i, !expanded && i >= visible))}
      <span ref={btnsRef} className="taglist-btns">
        {!expanded && hidden > 0 && (
          <span className="tag add-tag" onClick={(e) => { e.stopPropagation(); setExpanded(true) }}>
            +{hidden}
          </span>
        )}
        <span className="tag add-tag more-measure" aria-hidden="true">
          +00
        </span>
        {expanded && (
          <span className="tag add-tag" onClick={(e) => { e.stopPropagation(); setExpanded(false) }}>
            접기
          </span>
        )}
        {onAddClick && (
          <span className="tag add-tag" onClick={(e) => { e.stopPropagation(); onAddClick() }}>
            + 태그
          </span>
        )}
      </span>
    </div>
  )
}
