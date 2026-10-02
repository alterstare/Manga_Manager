import { useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import { useStore } from '../store'
import { EditLineIcon } from './icons'

// A group's name inside a 그룹 분류 panel row, renamable in place: the edit icon (or a
// double-click on the name) turns it into an input — Enter saves, Esc / blur
// cancels. Saving renames the group folders on disk too (store.renameGroup).
export default function GroupName({ id, name }: { id: string; name: string }): JSX.Element {
  const renameGroup = useStore((s) => s.renameGroup)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [busy, setBusy] = useState(false)

  const start = (e: MouseEvent): void => {
    e.preventDefault() // don't toggle the row's checkbox
    e.stopPropagation()
    setDraft(name)
    setEditing(true)
  }
  const save = async (): Promise<void> => {
    const n = draft.trim()
    if (!n || n === name) return setEditing(false)
    setBusy(true)
    try {
      await renameGroup(id, n)
      setEditing(false)
    } catch (err) {
      alert(String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  if (editing)
    return (
      <input
        autoFocus
        className="grp-rename"
        value={draft}
        disabled={busy}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') void save()
          else if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={() => !busy && setEditing(false)}
      />
    )
  return (
    <>
      <span className="grp-row-name" onDoubleClick={start} title="더블클릭: 이름 변경">
        {name}
      </span>
      <span className="grp-row-edit" title="이름 변경" onClick={start}>
        <EditLineIcon />
      </span>
    </>
  )
}
