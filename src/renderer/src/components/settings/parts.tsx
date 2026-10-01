// Small building blocks shared by the settings sections, so every box row looks
// and behaves the same.
import type { JSX, ReactNode } from 'react'
import SettingRow from '../SettingRow'
import { useSettings } from './context'

// Mutually-exclusive choice rendered as description cards: one card per option
// with a title, optional badge and a per-option description.
export function RadioCards<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (v: T) => void
  options: { val: T; label: string; desc?: string; badge?: string }[]
}): JSX.Element {
  return (
    <div className="rcards">
      {options.map((o) => (
        <button
          key={o.val}
          type="button"
          className={`rcard ${value === o.val ? 'on' : ''}`}
          onClick={() => onChange(o.val)}
        >
          <span className="rcard-dot" />
          <span className="rcard-body">
            <span className="rcard-title">
              {o.label}
              {o.badge && <span className="rcard-badge">{o.badge}</span>}
            </span>
            {o.desc && <span className="rcard-desc">{o.desc}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

// 열기 / 갱신 buttons for a registered folder (갱신 only when it belongs to a
// library mode, i.e. can be rescanned).
function FolderButtons({ path, mode }: { path: string; mode: 'hitomi' | 'normal' | null }): JSX.Element {
  const { rescanning, rescan } = useSettings()
  return (
    <>
      <button className="mini" onClick={() => window.api.openFolder(path)}>
        열기
      </button>
      {mode && (
        <button className="mini" disabled={rescanning === path} onClick={() => rescan(path, mode)}>
          {rescanning === path ? '갱신 중…' : '갱신'}
        </button>
      )}
    </>
  )
}

// A list of folders: an add row plus one path line per folder.
export function RootList({
  title,
  desc,
  roots,
  onAdd,
  onRemove,
  mode,
  addLabel = '+ 폴더 추가'
}: {
  title: string
  desc: string
  roots: string[]
  onAdd: () => void
  onRemove: (r: string) => void
  mode: 'hitomi' | 'normal'
  addLabel?: string
}): JSX.Element {
  return (
    <div className="set-block">
      <SettingRow title={title} desc={desc}>
        <button className="mini" onClick={onAdd}>
          {addLabel}
        </button>
      </SettingRow>
      {roots.map((r) => (
        <div className="path-item" key={r}>
          <code>{r}</code>
          <FolderButtons path={r} mode={mode} />
          <button className="mini danger" onClick={() => onRemove(r)}>
            제거
          </button>
        </div>
      ))}
      {roots.length === 0 && <div className="path-item empty">등록된 폴더 없음</div>}
    </div>
  )
}

// A single optional folder: title/desc row with a 선택 button, then the path
// (with 해제 when `onClear` is given).
export function FolderRow({
  title,
  desc,
  path,
  onPick,
  onClear,
  mode
}: {
  title: string
  desc: string
  path: string | null | undefined
  onPick: () => void
  onClear?: () => void
  mode: 'hitomi' | 'normal' | null
}): JSX.Element {
  return (
    <div className="set-block">
      <SettingRow title={title} desc={desc}>
        <button className="mini" onClick={onPick}>
          선택
        </button>
      </SettingRow>
      {path ? (
        <div className="path-item">
          <code>{path}</code>
          <FolderButtons path={path} mode={mode} />
          {onClear && (
            <button className="mini danger" onClick={onClear}>
              해제
            </button>
          )}
        </div>
      ) : (
        <div className="path-item empty">(미지정)</div>
      )}
    </div>
  )
}

// Removable chips for a string list setting (favorite tags, exclude tags…).
export function ChipList({
  items,
  onRemove,
  label = (s) => s,
  chipClass = 'tag'
}: {
  items: string[]
  onRemove: (s: string) => void
  label?: (s: string) => ReactNode
  chipClass?: string
}): JSX.Element | null {
  if (!items.length) return null
  return (
    <div className="taglist">
      {items.map((s) => (
        <span key={s} className={chipClass}>
          {label(s)}
          <span className="tag-x" onClick={() => onRemove(s)}>
            ×
          </span>
        </span>
      ))}
    </div>
  )
}
