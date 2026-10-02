import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { WorkGroup } from '../../../shared/types'
import GroupName from './GroupName'

// Compact 그룹 분류 for the reader's left list: a small "그룹 ▾" button whose
// panel toggles each group (+ 그룹 없음) with 전체 선택 / 해제. Shares the home
// screen's group filter (store.groupFilter / showUngrouped), so both agree.
export default function GroupFilterMenu({ groups }: { groups: WorkGroup[] }): JSX.Element {
  const groupFilter = useStore((s) => s.groupFilter)
  const showUngrouped = useStore((s) => s.showUngrouped)
  const setGroupFilter = useStore((s) => s.setGroupFilter)
  const setShowUngrouped = useStore((s) => s.setShowUngrouped)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const all = groups.every((g) => groupFilter[g.id] !== false) && showUngrouped

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const setAll = (on: boolean): void => {
    groups.forEach((g) => setGroupFilter(g.id, on))
    setShowUngrouped(on)
  }

  return (
    <div className="cat-wrap grp-filter" ref={ref}>
      <button className={`mini ${!all ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} title="그룹 분류">
        그룹 <span className={`dt ${open ? 'up' : ''}`} />
      </button>
      {open && (
        <div className="cat-panel grp-panel">
          <div className="cat-panel-actions">
            <button className="mini" onClick={() => setAll(true)}>
              전체 선택
            </button>
            <button className="mini" onClick={() => setAll(false)}>
              전체 선택 해제
            </button>
          </div>
          {groups.map((g) => (
            <label key={g.id} className="grp-row">
              <input
                type="checkbox"
                checked={groupFilter[g.id] !== false}
                onChange={(e) => setGroupFilter(g.id, e.target.checked)}
              />
              <GroupName id={g.id} name={g.name} />
            </label>
          ))}
          <label>
            <input type="checkbox" checked={showUngrouped} onChange={(e) => setShowUngrouped(e.target.checked)} />
            그룹 없음
          </label>
        </div>
      )}
    </div>
  )
}
