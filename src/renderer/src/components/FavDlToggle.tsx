import type { JSX, ReactNode } from 'react'
import { useStore } from '../store'
import { DownloadIcon, LanguageIcon } from './icons'
import Dropdown from './Dropdown'

// Pill switch for the favorites views: ON = purple fill + a glyph, knob right;
// OFF = grey + "ALL", knob left. `icon`/`title` let each view label its ON state
// (local = 다운로드만, online = 온라인만).
export default function FavDlToggle({
  checked,
  onChange,
  icon,
  onTitle,
  offTitle,
  offLabel = 'ALL'
}: {
  checked: boolean
  onChange: (v: boolean) => void
  icon?: ReactNode
  onTitle?: string
  offTitle?: string
  offLabel?: string
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
      <span className="fav-dl-all">{offLabel}</span>
      <span className="toggle-knob" />
    </button>
  )
}

// Online favorites views (hitomi + general manga): "아직 안 받은 것만" switch —
// hides favorites already in the library (the counterpart of the library's
// "받은 것만"). Shared store flag, so both online views agree.
export function OnlineOnlyToggle(): JSX.Element {
  const on = useStore((s) => s.favOnlineOnly)
  const set = useStore((s) => s.setFavOnlineOnly)
  return (
    <FavDlToggle
      checked={on}
      onChange={set}
      icon={<LanguageIcon />}
      onTitle="아직 받지 않은 즐겨찾기만 보는 중"
      offTitle="모든 즐겨찾기 보는 중"
    />
  )
}

// Sort of every favorites view: 평점 높은순 / 최근 추가순 (by favorite time).
export function FavSortSelect({
  value,
  onChange
}: {
  value: 'rank' | 'recent'
  onChange: (v: 'rank' | 'recent') => void
}): JSX.Element {
  return (
    <Dropdown<'rank' | 'recent'>
      className="field sm"
      value={value}
      onChange={onChange}
      options={[
        ['rank', '평점 높은순'],
        ['recent', '최근 추가순']
      ]}
    />
  )
}

// General-manga online toolbar: 보안 DNS (DNS over HTTPS) on/off — same switch
// as settings › 네트워크; saving re-applies the host resolver in main.
export function SecureDnsToggle(): JSX.Element {
  const settings = useStore((s) => s.settings)
  return (
    <FavDlToggle
      checked={settings.secureDns === true}
      onChange={(v) => {
        const s = { ...settings, secureDns: v }
        useStore.setState({ settings: s })
        void window.api.saveSettings(s)
      }}
      icon={<span className="fav-dl-text">DNS</span>}
      offLabel="OFF"
      onTitle="보안 DNS (DNS over HTTPS) 켜짐"
      offTitle="보안 DNS 꺼짐 — 클릭해서 켜기"
    />
  )
}
