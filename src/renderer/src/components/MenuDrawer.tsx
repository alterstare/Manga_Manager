import type { JSX } from 'react'
import { useStore } from '../store'

// Left slide-in navigation drawer (☰). Surfaces every screen plus the
// hitomi ⇄ general-manga mode toggle. Existing tab-bar buttons still work; this
// is an additional, consolidated entry point. Width is narrow and the rest of
// the window stays visible behind a transparent click-catcher that closes it.
function Item({
  icon,
  label,
  active,
  onClick
}: {
  icon: string
  label: string
  active?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button className={`menu-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="menu-item-ico">{icon}</span>
      <span className="menu-item-label">{label}</span>
    </button>
  )
}

export default function MenuDrawer(): JSX.Element {
  const open = useStore((s) => s.menuOpen)
  const setMenuOpen = useStore((s) => s.setMenuOpen)
  const view = useStore((s) => s.view)
  const libraryMode = useStore((s) => s.libraryMode)
  const setLibraryMode = useStore((s) => s.setLibraryMode)
  const goHome = useStore((s) => s.goHome)
  const goBrowse = useStore((s) => s.goBrowse)
  const goDownload = useStore((s) => s.goDownload)
  const goManage = useStore((s) => s.goManage)
  const goSettings = useStore((s) => s.goSettings)
  const setFilter = useStore((s) => s.setFilter)
  const setSort = useStore((s) => s.setSort)
  const setSearch = useStore((s) => s.setSearch)
  const defaultSort = useStore((s) => s.settings.defaultSort)

  const close = (): void => setMenuOpen(false)
  const go = (fn: () => void): void => {
    fn()
    close()
  }
  // "라이브러리" must always land on the default home — reset any active filter /
  // search / sort left over from 즐겨찾기 or 최근 본.
  const libraryClick = (): void =>
    go(() => {
      setSearch('')
      setSort(defaultSort)
      setFilter({ kind: 'all' })
      goHome()
    })

  const normal = libraryMode === 'normal'
  // Both modes route to the browse view; App renders TokiBrowse in normal mode,
  // hitomi Browse otherwise.
  const onlineClick = (): void => go(goBrowse)

  return (
    <div className={`menu-root ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="menu-overlay" onClick={close} />
      <nav className="menu-drawer">
        <div className="menu-head">
          <button className="menu-close" onClick={close}>
            ☰
          </button>
          <span className="menu-brand">메뉴</span>
        </div>

        <button
          className="menu-mode"
          onClick={() => go(() => setLibraryMode(normal ? 'hitomi' : 'normal'))}
        >
          <span className="menu-item-ico">⇄</span>
          {normal ? '히토미 뷰어로 전환' : '일반 만화 뷰어로 전환'}
        </button>
        <div className="menu-mode-cur">현재: {normal ? '일반 만화' : '히토미'}</div>

        <div className="menu-sep" />
        <Item icon="▤" label="라이브러리" active={view === 'home'} onClick={libraryClick} />
        <Item icon="◍" label="온라인" active={view === 'browse'} onClick={onlineClick} />
        <Item icon="♡" label="즐겨찾기" onClick={() => go(() => setFilter({ kind: 'favorites' }))} />
        <Item
          icon="↺"
          label="최근 본"
          onClick={() =>
            go(() => {
              setSort('viewed')
              setFilter({ kind: 'all' })
            })
          }
        />

        <div className="menu-sep" />
        <Item icon="☰" label="작업 목록" active={view === 'download'} onClick={() => go(goDownload)} />
        <Item icon="▥" label="관리" active={view === 'manage'} onClick={() => go(() => goManage('duplicates'))} />
        <Item icon="⚙" label="설정" active={view === 'settings'} onClick={() => go(goSettings)} />
      </nav>
    </div>
  )
}
