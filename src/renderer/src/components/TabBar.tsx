import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore, useSeriesRoots } from '../store'
import type { Tab, TabGroup } from '../store'
import ContextMenu from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import { groupSeries, analyzeSeries } from '../util'
import { HomeIcon, LanguageIcon, MenuIcon, DownloadIcon, SettingsIcon, CloseIcon, CompareArrowsIcon } from './icons'

export default function TabBar(): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const tabGroups = useStore((s) => s.tabGroups)
  const works = useStore((s) => s.works)
  const chapterScheme = useStore((s) => s.settings.normalChapterScheme)
  const activeTabId = useStore((s) => s.activeTabId)
  const view = useStore((s) => s.view)
  const libraryMode = useStore((s) => s.libraryMode)
  const goHome = useStore((s) => s.goHome)
  const activateTab = useStore((s) => s.activateTab)
  const moveTab = useStore((s) => s.moveTab)
  const refreshTab = useStore((s) => s.refreshTab)
  const openSplitFromTab = useStore((s) => s.openSplitFromTab)
  const closeSplitSide = useStore((s) => s.closeSplitSide)
  const splitDetach = useStore((s) => s.splitDetach)
  const swapSplitSides = useStore((s) => s.swapSplitSides)
  const swapTabIntoSplit = useStore((s) => s.swapTabIntoSplit)
  const createTabGroup = useStore((s) => s.createTabGroup)
  const setTabGroup = useStore((s) => s.setTabGroup)
  const renameTabGroup = useStore((s) => s.renameTabGroup)
  const deleteTabGroup = useStore((s) => s.deleteTabGroup)

  // Groups are collapsed by default (show only the name); ids here are expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Close animation lives in the store so Ctrl+W (App) triggers the same collapse.
  const closingTabs = useStore((s) => s.closingTabs)
  const startClose = useStore((s) => s.requestCloseTab)
  // Newly-added tabs animate in (width 0 → full). Track ids seen last render.
  const seenIds = useRef<Set<string>>(new Set())
  const mounted = useRef(false)
  const [entering, setEntering] = useState<Set<string>>(new Set())
  // Layout effect (before paint) so the entering class is on the very first frame —
  // otherwise the tab flashes at full width for one frame before the animation.
  useLayoutEffect(() => {
    const cur = new Set(tabs.map((t) => t.id))
    if (mounted.current) {
      const added = [...cur].filter((id) => !seenIds.current.has(id))
      if (added.length) {
        setEntering((s) => {
          const n = new Set(s)
          added.forEach((id) => n.add(id))
          return n
        })
        setTimeout(() => {
          setEntering((s) => {
            const n = new Set(s)
            added.forEach((id) => n.delete(id))
            return n
          })
        }, 220)
      }
    } else {
      mounted.current = true
    }
    seenIds.current = cur
  }, [tabs])
  const [menu, setMenu] = useState<{ x: number; y: number; tab: Tab } | null>(null)
  const [grpMenu, setGrpMenu] = useState<{ x: number; y: number; group: TabGroup } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  // Snapshot of the layout taken at drag start. We never reorder the store
  // mid-drag (that re-renders → jump/flicker); instead we move tabs purely with
  // CSS transforms and commit the new order once, on release.
  const drag = useRef<{
    id: string
    startX: number
    els: HTMLElement[]
    centers: number[]
    idx: number
    slot: number
    center: number
    minTx: number // clamp so the dragged tab can't leave the strip on either side
    maxTx: number
  } | null>(null)
  // True once a drag actually moved — used to swallow the click that follows a
  // drag so releasing a tab doesn't also activate it.
  const dragMoved = useRef(false)

  const startDrag = (id: string, e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const strip = stripRef.current
    if (!strip) return
    const els = [...strip.querySelectorAll<HTMLElement>('[data-tab-id]')]
    const rects = els.map((el) => el.getBoundingClientRect())
    const idx = els.findIndex((el) => el.dataset.tabId === id)
    if (idx < 0) return
    const centers = rects.map((r) => r.left + r.width / 2)
    const gap = rects[idx + 1] ? rects[idx + 1].left - rects[idx].right : 3
    // Keep the dragged tab inside the strip's visible box — no spilling over the
    // nav buttons on either side.
    const strect = strip.getBoundingClientRect()
    const minTx = strect.left - rects[idx].left
    const maxTx = strect.right - rects[idx].right
    drag.current = {
      id,
      startX: e.clientX,
      els,
      centers,
      idx,
      slot: rects[idx].width + gap,
      center: centers[idx],
      minTx,
      maxTx
    }
    dragMoved.current = false
    setDragId(id)
  }

  useEffect(() => {
    if (!dragId) return
    const onMove = (e: MouseEvent): void => {
      const d = drag.current
      if (!d) return
      const tx = Math.max(d.minTx, Math.min(d.maxTx, e.clientX - d.startX))
      if (Math.abs(tx) > 4) dragMoved.current = true
      d.center = d.centers[d.idx] + tx
      d.els[d.idx].style.transform = `translateX(${tx}px)`
      // A tab flips once the dragged tab covers HALF of it (its center passes the
      // neighbor's near edge = center ∓ half a slot), not the whole neighbor.
      const half = d.slot / 2
      for (let j = 0; j < d.els.length; j++) {
        if (j === d.idx) continue
        let shift = 0
        if (d.idx < j && d.center > d.centers[j] - half) shift = -d.slot
        else if (d.idx > j && d.center < d.centers[j] + half) shift = d.slot
        d.els[j].style.transform = shift ? `translateX(${shift}px)` : ''
      }
    }
    const onUp = (): void => {
      const d = drag.current
      if (d) {
        // Same half-overlap threshold as onMove so the drop lands where it looks.
        const thr = d.center > d.centers[d.idx] ? -d.slot / 2 : d.slot / 2
        let overId: string | null = null
        for (let j = 0; j < d.els.length; j++) {
          if (j === d.idx) continue
          if (d.centers[j] + thr > d.center) {
            overId = d.els[j].dataset.tabId ?? null
            break
          }
        }
        // How many slots the dragged tab crossed → its resting offset. Ease it into
        // that slot (others already eased via CSS), then commit the reorder.
        const half = d.slot / 2
        let passed = 0
        for (let j = 0; j < d.centers.length; j++) {
          if (j === d.idx) continue
          if (j > d.idx && d.center > d.centers[j] - half) passed++
          else if (j < d.idx && d.center < d.centers[j] + half) passed--
        }
        const targetTx = passed * d.slot
        const els = d.els
        const dragEl = els[d.idx]
        const id = d.id
        const ease = 'transform 0.16s cubic-bezier(0.4, 0, 0.2, 1)'
        dragEl.style.transition = ease
        dragEl.style.transform = `translateX(${targetTx}px)`
        setTimeout(() => {
          for (const el of els) {
            el.style.transition = 'none'
            el.style.transform = ''
          }
          moveTab(id, overId)
          requestAnimationFrame(() => els.forEach((el) => (el.style.transition = '')))
        }, 160)
      }
      drag.current = null
      setDragId(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragId, moveTab])

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const groupSubmenu = (t: Tab): MenuItem[] => {
    const items: MenuItem[] = tabGroups.map((g) => ({
      label: g.name,
      color: g.color,
      onClick: () => setTabGroup(t.id, g.id)
    }))
    items.push({
      label: '＋ 새 그룹',
      onClick: () => {
        const id = createTabGroup()
        setTabGroup(t.id, id)
      }
    })
    return items
  }

  const menuItems = (t: Tab): MenuItem[] => {
    const items: MenuItem[] = [{ label: '새로고침', onClick: () => refreshTab(t.id) }]
    if (t.split) {
      items.push({
        label: '분할 뷰 정렬',
        children: [
          { label: '뷰 분리', onClick: () => splitDetach(t.id) },
          { label: '왼쪽 뷰 닫기', onClick: () => closeSplitSide(t.id, 'left') },
          { label: '오른쪽 뷰 닫기', onClick: () => closeSplitSide(t.id, 'right') },
          { label: '뷰 반전', onClick: () => swapSplitSides(t.id) }
        ]
      })
    } else {
      items.push({ label: '그룹에 탭 추가', children: groupSubmenu(t) })
      if (t.groupId) items.push({ label: '그룹에서 제거', onClick: () => setTabGroup(t.id, null) })
      items.push({ label: '분할 뷰에서 열기', onClick: () => openSplitFromTab(t.id) })
      if (activeTab?.split && activeTab.id !== t.id) {
        items.push({
          label: '탭을 분할 보기로 이동',
          children: [
            { label: '왼쪽 뷰와 바꾸기', onClick: () => swapTabIntoSplit(t.id, 'left') },
            { label: '오른쪽 뷰와 바꾸기', onClick: () => swapTabIntoSplit(t.id, 'right') }
          ]
        })
      }
      if (!t.online) items.push({ label: '폴더 열기', onClick: () => window.api.openInExplorer(t.workId) })
    }
    items.push({ label: '닫기', danger: true, onClick: () => startClose(t.id) })
    return items
  }

  const workById = useMemo(() => new Map(works.map((w) => [w.id, w])), [works])
  // General-manga chapters have no series field: the series name lives on the
  // parent folder. Derive per-chapter "n화" + series title once, so a local
  // normal-library tab can read "n화 · 시리즈명" instead of just the folder name.
  const normalRoots = useSeriesRoots()
  const normalLabels = useMemo(() => {
    const map = new Map<string, { series: string; label: string }>()
    const normal = works.filter((w) => (w.library ?? 'hitomi') === 'normal')
    for (const g of groupSeries(normal, normalRoots)) {
      for (const ci of analyzeSeries(g.chapters, g.title, chapterScheme)) {
        map.set(ci.work.id, { series: g.title, label: ci.label })
      }
    }
    return map
  }, [works, normalRoots, chapterScheme])
  const localLabel = (workId: string): string => {
    const w = workById.get(workId)
    if (!w) return '(삭제됨)'
    const info = normalLabels.get(w.id)
    return info && info.series ? `${info.label} · ${info.series}` : w.title
  }
  // Manga-site chapter tabs read "n화 · 시리즈명"; doujin/others use the title as-is.
  const onlineLabel = (o: { title: string; chapterLabel?: string }): string =>
    o.chapterLabel && !o.title.includes(o.chapterLabel) ? `${o.chapterLabel} · ${o.title}` : o.title
  const titleOf = (t: Tab): string =>
    t.online ? onlineLabel(t.online) : localLabel(t.workId)
  const rightTitleOf = (t: Tab): string =>
    t.rightOnline ? onlineLabel(t.rightOnline) : t.rightWorkId ? localLabel(t.rightWorkId) : '비어 있음'

  const unify = useStore((s) => s.settings.unifyTabsAcrossModes)
  // Tabs belong to a mode; the bar shows only the current mode's tabs. Glance
  // (peek) tabs live in a floating overlay and never appear in the bar.
  const curTabs = useMemo(
    () => tabs.filter((t) => !t.glance && (t.mode ?? 'hitomi') === libraryMode),
    [tabs, libraryMode]
  )
  const otherTabs = useMemo(
    () => tabs.filter((t) => !t.glance && (t.mode ?? 'hitomi') !== libraryMode),
    [tabs, libraryMode]
  )

  // Cluster tabs into manual groups (emitted at the first member's position);
  // ungrouped tabs render on their own.
  const items = useMemo(() => {
    const out: ({ kind: 'tab'; tab: Tab } | { kind: 'group'; group: TabGroup; tabs: Tab[] })[] = []
    const emitted = new Set<string>()
    for (const t of curTabs) {
      const g = t.groupId ? tabGroups.find((x) => x.id === t.groupId) : null
      if (!g) {
        out.push({ kind: 'tab', tab: t })
        continue
      }
      if (emitted.has(g.id)) continue
      emitted.add(g.id)
      out.push({ kind: 'group', group: g, tabs: curTabs.filter((x) => x.groupId === g.id) })
    }
    return out
  }, [curTabs, tabGroups])

  const OTHER = '__othermode__'
  const otherLabel = libraryMode === 'hitomi' ? '일반 만화' : '동인지'

  const toggle = (id: string): void =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const tabEl = (t: Tab, color?: string): JSX.Element => (
    <div
      key={t.id}
      data-tab-id={t.id}
      className={`tab ${t.online ? 'online-tab' : ''} ${t.split ? 'split' : ''} ${
        view === 'reader' && activeTabId === t.id ? 'active' : ''
      } ${dragId === t.id ? 'dragging' : ''} ${closingTabs.includes(t.id) ? 'closing' : ''} ${
        entering.has(t.id) ? 'entering' : ''
      }`}
      style={color ? ({ ['--grp' as string]: color } as React.CSSProperties) : undefined}
      onClick={() => {
        if (dragMoved.current) {
          dragMoved.current = false
          return // this click ends a drag — don't switch tabs
        }
        activateTab(t.id)
      }}
      onAuxClick={(e) => {
        if (e.button === 1) startClose(t.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, tab: t })
      }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('.tab-close')) return
        startDrag(t.id, e)
      }}
      title={t.split ? `${titleOf(t)} | ${rightTitleOf(t)}` : titleOf(t)}
    >
      {t.split ? (
        <>
          <span className="split-badge">⊟</span>
          <span className="tab-title">{titleOf(t)}</span>
          <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeSplitSide(t.id, 'left') }}>
            <CloseIcon />
          </span>
          <span className="split-sep">│</span>
          <span className="tab-title">{rightTitleOf(t)}</span>
          <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeSplitSide(t.id, 'right') }}>
            <CloseIcon />
          </span>
        </>
      ) : (
        <>
          {t.online && <span className="tab-online-dot"><LanguageIcon /></span>}
          <span className="tab-title">{titleOf(t)}</span>
          <span className="tab-close" onClick={(e) => { e.stopPropagation(); startClose(t.id) }}>
            <CloseIcon />
          </span>
        </>
      )}
    </div>
  )

  return (
    <div className="tabbar">
      <button
        className="tab menu-btn"
        onClick={() => useStore.getState().toggleMenu()}
      >
        <MenuIcon />
      </button>
      {/* Library mode switch (동인지 ⇄ 일반 만화) — also in the menu and Ctrl+G;
          shown here so it's easy to find; the tooltip names the target mode. */}
      <button
        className="tab mode-tab"
        onClick={() => useStore.getState().setLibraryMode(libraryMode === 'normal' ? 'hitomi' : 'normal')}
        title={`${libraryMode === 'normal' ? '동인지' : '일반 만화'} 모드로 전환`}
      >
        <CompareArrowsIcon />
      </button>
      <button
        className={`tab home-tab ${view === 'home' ? 'active' : ''}`}
        onClick={() => (view === 'home' ? useStore.getState().scrollHomeTop() : goHome())}
        title="라이브러리"
      >
        <HomeIcon />
      </button>
      <button
        className={`tab icon-tab ${view === 'browse' ? 'active' : ''}`}
        onClick={() =>
          view === 'browse'
            ? useStore.getState().scrollBrowseTop()
            : useStore.getState().goBrowse()
        }
        title="온라인"
      >
        <LanguageIcon />
      </button>

      <div className={`tab-strip ${dragId ? 'dragging' : ''}`} ref={stripRef}>
        {items.map((it) => {
          if (it.kind === 'tab') return tabEl(it.tab)
          const g = it.group
          const isCollapsed = !expanded.has(g.id)
          // Collapsed: show only the active member (if any) beside the name;
          // hide the rest. Expanded: show all.
          const visible = isCollapsed ? it.tabs.filter((t) => t.id === activeTabId) : it.tabs
          return (
            <div
              key={g.id}
              className={`tab-group ${isCollapsed ? 'collapsed' : ''}`}
              // Collapsed groups size to their content (just the header + any
              // active tab) so they don't shove the other tabs aside. Expanded
              // groups share strip width proportionally to their tab count, but
              // capped so they can't eat all the leftover space.
              style={
                isCollapsed
                  ? { flex: '0 0 auto', minWidth: 0 }
                  : { flex: `${visible.length} 1 0`, minWidth: 0, maxWidth: `${visible.length * 240}px` }
              }
            >
              <div
                className="tab-group-head"
                style={{ ['--grp' as string]: g.color } as React.CSSProperties}
                onClick={() => toggle(g.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setGrpMenu({ x: e.clientX, y: e.clientY, group: g })
                }}
                title={`${g.name} (${it.tabs.length}) — 접기/펼치기, 우클릭 메뉴`}
              >
                <span>{isCollapsed ? '▸' : '▾'}</span>
                {renaming?.id === g.id ? (
                  <input
                    className="grp-rename"
                    autoFocus
                    value={renaming.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ id: g.id, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        renameTabGroup(g.id, renaming.value)
                        setRenaming(null)
                      } else if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={() => {
                      renameTabGroup(g.id, renaming.value)
                      setRenaming(null)
                    }}
                  />
                ) : (
                  <span className="tab-title">{g.name}</span>
                )}
                <span className="grp-count">{it.tabs.length}</span>
              </div>
              {visible.map((t) => tabEl(t, g.color))}
            </div>
          )
        })}

        {unify && otherTabs.length > 0 && (
          <div
            className={`tab-group othermode ${expanded.has(OTHER) ? '' : 'collapsed'}`}
            style={
              expanded.has(OTHER)
                ? { flex: `${otherTabs.length} 1 0`, minWidth: 0, maxWidth: `${otherTabs.length * 240}px` }
                : { flex: '0 0 auto', minWidth: 0 }
            }
          >
            <div
              className="tab-group-head"
              style={{ ['--grp' as string]: 'var(--text-dim)' } as React.CSSProperties}
              onClick={() => toggle(OTHER)}
              title={`${otherLabel} 탭 (${otherTabs.length}) — 클릭 시 펼치기`}
            >
              <span>{expanded.has(OTHER) ? '▾' : '▸'}</span>
              <span className="tab-title">{otherLabel}</span>
              <span className="grp-count">{otherTabs.length}</span>
            </div>
            {expanded.has(OTHER) && otherTabs.map((t) => tabEl(t))}
          </div>
        )}
      </div>

      <button
        className={`tab icon-tab ${view === 'download' ? 'active' : ''}`}
        onClick={() => useStore.getState().goDownload()}
        title="작업 목록"
      >
        <DownloadIcon />
      </button>
      <button className={`tab icon-tab ${view === 'settings' ? 'active' : ''}`} onClick={() => useStore.getState().goSettings()} title="설정">
        <SettingsIcon />
      </button>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.tab)} onClose={() => setMenu(null)} />}
      {grpMenu && (
        <ContextMenu
          x={grpMenu.x}
          y={grpMenu.y}
          items={[
            { label: '이름 변경', onClick: () => setRenaming({ id: grpMenu.group.id, value: grpMenu.group.name }) },
            { label: '그룹 해제', danger: true, onClick: () => deleteTabGroup(grpMenu.group.id) }
          ]}
          onClose={() => setGrpMenu(null)}
        />
      )}
    </div>
  )
}
