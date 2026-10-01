import type { JSX, ReactNode } from 'react'
import { DownloadIcon } from './icons'

// Pill switch for the favorites views: ON = purple fill + a glyph, knob right;
// OFF = grey + "ALL", knob left. `icon`/`title` let each view label its ON state
// (local = 다운로드만, online = 온라인만).
export default function FavDlToggle({
  checked,
  onChange,
  icon,
  onTitle,
  offTitle
}: {
  checked: boolean
  onChange: (v: boolean) => void
  icon?: ReactNode
  onTitle?: string
  offTitle?: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle fav-dl ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
      title={checked ? onTitle ?? '필터 켜짐' : offTitle ?? '전체 보는 중'}
    >
      <span className="fav-dl-icon">{icon ?? <DownloadIcon />}</span>
      <span className="fav-dl-all">ALL</span>
      <span className="toggle-knob" />
    </button>
  )
}
