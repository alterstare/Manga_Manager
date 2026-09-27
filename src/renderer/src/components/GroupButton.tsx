import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import type { Work } from '../../../shared/types'
import { useStore } from '../store'
import ConfirmModal from './ConfirmModal'

// "+" button next to the favorite heart: assign the work to a single group, or
// create a new one. A work belongs to at most one group; switching groups asks
// for confirmation (유지 / 옮김) because it physically moves the work folder.
export default function GroupButton({ work, applyTo }: { work: Work; applyTo?: Work[] }): JSX.Element {
  const allGroups = useStore((s) => s.settings.groups)
  const libraryMode = useStore((s) => s.libraryMode)
  const groups = allGroups.filter((g) => (g.mode ?? 'hitomi') === libraryMode)
  const createGroup = useStore((s) => s.createGroup)
  const upsertWork = useStore((s) => s.upsertWork)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [moveTo, setMoveTo] = useState<{ id: string; name: string } | null>(null)
  const current = (work.groups ?? [])[0] ?? null
  const wrapRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLSpanElement>(null)
  // Popover is portaled to <body> (so it isn't clipped by a card's overflow);
  // position it under the button, clamped to the viewport.
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const openPop = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const W = 210
      // Open rightward from the button's left edge; if the right side lacks room
      // (and the left has more), anchor the panel's right edge to the button.
      const spaceRight = window.innerWidth - r.left
      let left = spaceRight >= W + 8 || r.left < spaceRight ? r.left : r.right - W
      left = Math.max(8, Math.min(left, window.innerWidth - W - 8))
      setPos({ top: r.bottom + 4, left })
    }
    setOpen(true)
  }

  // Close the popover when clicking outside it or when the page scrolls.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onScroll = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown, true)
    // capture=true so it fires for any scrolling ancestor, not just window.
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  // Apply to a set of works when given (series-level), else just this work.
  const apply = async (ids: string[]): Promise<void> => {
    try {
      for (const t of applyTo ?? [work]) upsertWork(await window.api.setWorkGroups(t.id, ids))
    } catch (e: any) {
      alert(String(e?.message ?? e))
    }
  }

  // Clicking a group: leave it if current, join if none, else confirm the move.
  const pick = (g: { id: string; name: string }): void => {
    if (g.id === current) {
      apply([]) // toggle off → leave group
    } else if (!current) {
      apply([g.id])
    } else {
      setMoveTo(g) // already in another group → ask first
    }
  }

  const create = async (): Promise<void> => {
    const id = await createGroup(name)
    if (!id) return
    setName('')
    apply([id]) // creating + assigning is explicit; move straight away
  }

  return (
    <span className="grp-btn-wrap" ref={wrapRef} onClick={(e) => e.stopPropagation()}>
      <span ref={btnRef} className={`grp-btn ${open ? 'on' : ''}`} title="그룹에 추가" onClick={openPop}>
        ＋
      </span>
      {open &&
        createPortal(
          <div
            className="grp-pop grp-pop-portal"
            ref={panelRef}
            style={{ top: pos.top, left: pos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {groups.length === 0 && <div className="hint">그룹이 없습니다. 아래에서 만드세요.</div>}
            {groups.map((g) => (
              <label key={g.id}>
                <input type="checkbox" checked={current === g.id} onChange={() => pick(g)} />
                {g.name}
              </label>
            ))}
            <div className="grp-create">
              <input
                value={name}
                placeholder="새 그룹 이름"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
              />
              <button className="mini" onClick={create}>
                + 생성
              </button>
            </div>
          </div>,
          document.body
        )}
      {moveTo && (
        <ConfirmModal
          icon="⇄"
          title="그룹을 옮기시겠습니까?"
          desc={
            <>
              이 작품을 <b>{moveTo.name}</b> 그룹으로 옮깁니다. 폴더도 함께 이동합니다.
            </>
          }
          confirmLabel="옮김"
          cancelLabel="유지"
          onConfirm={() => {
            const g = moveTo
            setMoveTo(null)
            apply([g.id])
          }}
          onCancel={() => setMoveTo(null)}
        />
      )}
    </span>
  )
}
