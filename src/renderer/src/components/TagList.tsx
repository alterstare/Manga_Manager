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
  // Grid cards: fit whole tags into exactly this many rows (measured), keeping the
  // +N / + 태그 buttons inside the last row. Overrides `max`.
  lines?: number
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
  singleLine = true,
  lines
}: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [visible, setVisible] = useState(tags.length)
  const [width, setWidth] = useState(0)
  const [boxH, setBoxH] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const btnsRef = useRef<HTMLSpanElement>(null)

  const norm = (s: string): string =>
    s.toLowerCase().replace(/^[^:]+:/, '').replace(/_/g, ' ').trim()
  const favSet = new Set(favoriteTags.map(norm))
  const isFav = (t: string): boolean => favSet.has(norm(t))
  // Favorite tags float to the front (stable within each group).
  const ordered = [...tags].sort((a, b) => Number(isFav(b)) - Number(isFav(a)))

  const rowFit = !singleLine && !!lines
  const measured = singleLine || rowFit

  useEffect(() => {
    if (!measured) return
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    // Grid: the tag box can shrink (multi-line artist eats rows) — track its height.
    const box = rowFit ? el.parentElement : null
    const ro2 = new ResizeObserver(() => box && setBoxH(box.clientHeight))
    if (box) ro2.observe(box)
    return () => {
      ro.disconnect()
      ro2.disconnect()
    }
  }, [measured])

  // Grid row-fit: simulate the wrap of tags (+ buttons) at the measured widths and
  // keep the largest prefix that fits in `lines` rows.
  useLayoutEffect(() => {
    if (!rowFit || expanded) return
    const el = ref.current
    if (!el) return
    el.classList.add('measuring')
    const cw = el.clientWidth
    const gap = 4
    const tagW = Array.from(el.querySelectorAll<HTMLElement>('.mtag')).map((x) => Math.min(x.offsetWidth, cw))
    const moreW = el.querySelector<HTMLElement>('.more-measure')?.offsetWidth ?? 0
    const addW = el.querySelector<HTMLElement>('.add-btn')?.offsetWidth ?? 0
    el.classList.remove('measuring')
    // Rows that actually fit the (possibly shrunk) tag box, capped at `lines`.
    let maxRows = lines ?? 1
    const box = el.parentElement
    if (box) {
      const cs = getComputedStyle(box)
      const inner = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      maxRows = Math.max(0, Math.min(maxRows, Math.floor((inner + gap) / (24 + gap))))
    }
    if (maxRows === 0) {
      setVisible(0)
      return
    }
    const fits = (n: number): boolean => {
      const items = tagW.slice(0, n)
      if (n < tagW.length) items.push(moreW)
      if (addW) items.push(addW)
      let rows = 1
      let x = 0
      for (const w of items) {
        const nx = x === 0 ? w : x + gap + w
        if (nx <= cw) x = nx
        else {
          rows++
          x = w
          if (rows > maxRows) return false
        }
      }
      return true
    }
    let n = tagW.length
    while (n > 0 && !fits(n)) n--
    setVisible(n)
  }, [tags, expanded, width, boxH, rowFit, lines, onAddClick])

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

  // Grid cards, row-fit: whole tags in `lines` rows; buttons always on the last row.
  if (rowFit) {
    const hidden = ordered.length - visible
    return (
      <div ref={ref} className={`taglist-grid ${expanded ? 'expanded' : ''}`}>
        {ordered.map((t, i) => tagSpan(t, i, !expanded && i >= visible))}
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
          <span className="tag add-tag add-btn" onClick={(e) => { e.stopPropagation(); onAddClick() }}>
            + 태그
          </span>
        )}
      </div>
    )
  }

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
