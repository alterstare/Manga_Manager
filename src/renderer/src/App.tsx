import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from './store'
import ExitModal from './components/ExitModal'
import TabBar from './components/TabBar'
import Home from './components/Home'
import Reader from './components/Reader'
import SplitReader from './components/SplitReader'
import Settings from './components/Settings'
import Download from './components/Download'
import Browse from './components/Browse'
import TokiBrowse from './components/TokiBrowse'
import Manage from './components/Manage'
import LibraryList from './components/LibraryList'
import OnlineList from './components/OnlineList'
import TokiChapterList from './components/TokiChapterList'
import MenuDrawer from './components/MenuDrawer'
import ActivityBar from './components/ActivityBar'
import GlanceOverlay from './components/GlanceOverlay'
import ConfirmModal from './components/ConfirmModal'
import Tooltip from './components/Tooltip'
import EditContextMenu from './components/EditContextMenu'
import { startExitAnimations } from './exitAnimations'
import { comboFromEvent, shortcutCombos, type ShortcutId } from '../../shared/shortcuts'
import { setExcluded } from './exclude'

export default function App(): JSX.Element {
  const view = useStore((s) => s.view)
  const libraryMode = useStore((s) => s.libraryMode)
  const needDownloadDir = useStore((s) => s.needDownloadDir)
  const setNeedDownloadDir = useStore((s) => s.setNeedDownloadDir)
  const activeTabId = useStore((s) => s.activeTabId)
  const manageMode = useStore((s) => s.manageMode)
  // Online browse position — recorded into nav history so back steps through
  // previous online pages/searches before leaving the online view.
  const browseSource = useStore((s) => s.browseSource)
  const browsePage = useStore((s) => s.browsePage)
  const setWorks = useStore((s) => s.setWorks)
  const setSettings = useStore((s) => s.setSettings)
  const restoreSession = useStore((s) => s.restoreSession)
  const theme = useStore((s) => s.settings.theme)
  const [showExit, setShowExit] = useState(false)
  // First-run: prompt to enter the doujin online address (online access is gated
  // on it). Shown once per session when the address hasn't been configured.
  const [askAddr, setAskAddr] = useState(false)

  // Apply the color theme to <html> so the CSS variable overrides take effect.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme ?? 'light')
  }, [theme])
  // Once the online browse view has been opened, keep it mounted (hidden) so
  // returning to it is instant and preserves its list/scroll — only an explicit
  // page change or reset refetches. Not mounted until first opened (avoids a
  // network hit on boot).
  const [browseSeen, setBrowseSeen] = useState(false)
  useEffect(() => {
    if (view === 'browse') setBrowseSeen(true)
    // Entering online without a site address set (per mode) → prompt to enter it.
    if (view === 'browse') {
      const st = useStore.getState()
      const missing =
        st.libraryMode === 'normal' ? !st.settings.tokiBaseUrl : !st.settings.hitomiBaseUrl
      if (missing) setAskAddr(true)
    }
  }, [view])

  // Mode switch (동인지 ⇄ 일반 만화): replay a brief focus-out/in on the content.
  // Re-adding the class (with a forced reflow) restarts the animation without
  // remounting anything, so readers / lists keep their state.
  const bodyRef = useRef<HTMLDivElement>(null)
  const firstMode = useRef(true)
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false
      return
    }
    const el = bodyRef.current
    if (!el) return
    el.classList.remove('mode-switching')
    void el.offsetWidth
    el.classList.add('mode-switching')
  }, [libraryMode])

  // Popups fade out on close (see exitAnimations.ts).
  useEffect(() => startExitAnimations(), [])

  // Boot: load persisted settings, cached works, and the previous tab session.
  useEffect(() => {
    ;(async () => {
      const [settings, works, session, onlineFavs, progress] = await Promise.all([
        window.api.getSettings(),
        window.api.getWorks(),
        window.api.getSession(),
        window.api.getOnlineFavs(),
        window.api.getReadProgress()
      ])
      setSettings(settings)
      setExcluded(settings.excludedImageHashes)
      setWorks(works)
      restoreSession(session)
      useStore.getState().setOnlineFavs(onlineFavs)
      useStore.getState().setReadProgressAll(progress)
    })()
  }, [setWorks, setSettings, restoreSession])

  // Snapshot of the persistable tab session (online tabs are transient).
  const snapshot = (): { tabs: { id: string; workId: string; scrollTop: number }[]; activeTabId: string | null } => {
    const { tabs, activeTabId } = useStore.getState()
    const local = tabs
      .filter((t): t is typeof t & { workId: string } => !!t.workId && !t.glance)
      .map((t) => ({ id: t.id, workId: t.workId, scrollTop: t.scrollTop }))
    return { tabs: local, activeTabId }
  }

  // Main intercepts the window X and asks us to show the styled exit modal.
  useEffect(() => window.api.onRequestClose(() => setShowExit(true)), [])

  // Cloudflare auth: main pops its browser window and tells us to show a banner.
  const [cfChallenge, setCfChallenge] = useState(false)
  useEffect(() => window.api.onTokiChallenge((active) => setCfChallenge(active)), [])

  // Auto-update progress → shown as a row in the activity bar.
  useEffect(() => window.api.onUpdateStatus((s) => useStore.getState().setUpdate(s)), [])

  // Record each location change into the nav history (deduped in the store), so
  // the mouse back/forward buttons can step through it browser-style.
  useEffect(() => {
    useStore.getState().recordNav()
  }, [view, activeTabId, libraryMode, manageMode, browseSource, browsePage])

  // Browser-style back/forward: mouse side buttons (via main's app-command on
  // Windows), plus DOM fallbacks (mouse buttons 3/4, Alt+Left/Right).
  useEffect(() => {
    // A single mouse side-button press fires BOTH the DOM mouseup (button 3/4) and
    // the main-process app-command — dedupe so one press = one step.
    const lastAt = { back: 0, forward: 0 }
    const back = (): void => {
      const now = Date.now()
      if (now - lastAt.back < 250) return
      lastAt.back = now
      useStore.getState().navBack()
    }
    const forward = (): void => {
      const now = Date.now()
      if (now - lastAt.forward < 250) return
      lastAt.forward = now
      useStore.getState().navForward()
    }
    const offB = window.api.onNavBack(back)
    const offF = window.api.onNavForward(forward)
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) {
        e.preventDefault()
        back()
      } else if (e.button === 4) {
        e.preventDefault()
        forward()
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      const st = useStore.getState()
      const combo = comboFromEvent(e)
      if (!combo) return
      const is = (id: ShortcutId): boolean => shortcutCombos(st.settings.shortcuts, id).includes(combo)
      // Combos are user-editable (설정 › 단축키); defaults in shared/shortcuts.ts.
      const goTab = (n: number): void => {
        const list = st.tabs.filter((t) => !t.glance)
        const t = n < 0 ? list[list.length - 1] : list[n]
        if (t) st.activateTab(t.id)
      }
      const actions: [ShortcutId, () => void][] = [
        ['focusSearch', () => focusSearch()],
        ['switchMode', () => st.setLibraryMode(st.libraryMode === 'normal' ? 'hitomi' : 'normal')],
        ['navBack', back],
        ['navForward', forward],
        ['reopenTab', () => st.reopenClosedTab()],
        ['closeTab', () => st.activeTabId && st.requestCloseTab(st.activeTabId)],
        ['nextTab', () => cycleTab(1)],
        ['prevTab', () => cycleTab(-1)],
        ['goLibrary', () => st.goHome()],
        ['goOnline', () => st.goBrowse()],
        // Ctrl+1/2 are the 라이브러리/온라인 buttons, so content tabs start at 3.
        ['tab3', () => goTab(0)],
        ['tab4', () => goTab(1)],
        ['tab5', () => goTab(2)],
        ['tab6', () => goTab(3)],
        ['tab7', () => goTab(4)],
        ['tab8', () => goTab(5)],
        ['tabLast', () => goTab(-1)],
        ['reload', () => window.location.reload()]
      ]
      function cycleTab(dir: 1 | -1): void {
        const list = st.tabs.filter((t) => !t.glance)
        if (list.length < 2) return
        const i = list.findIndex((t) => t.id === st.activeTabId)
        st.activateTab(list[(i + dir + list.length) % list.length].id)
      }
      for (const [id, run] of actions) {
        if (!is(id)) continue
        e.preventDefault()
        run()
        return
      }
    }
    window.addEventListener('mouseup', onMouse)
    window.addEventListener('keydown', onKey)
    return () => {
      offB()
      offF()
      window.removeEventListener('mouseup', onMouse)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Feed every download-progress event into the store so the download manager
  // list stays live regardless of which view is open.
  useEffect(
    () => window.api.onHitomiProgress((p) => useStore.getState().pushDownloadProgress(p)),
    []
  )

  const onExit = (decision: 'keep' | 'clear' | 'cancel'): void => {
    setShowExit(false)
    window.api.closeWindow(decision, decision === 'keep' ? snapshot() : undefined)
  }

  return (
    <div className="app">
      <TabBar />
      <MenuDrawer />
      <div className="body" ref={bodyRef}>
        {view === 'settings' ? (
          <Settings />
        ) : view === 'download' ? (
          <Download />
        ) : view === 'browse' ? null : view === 'manage' ? (
          <Manage />
        ) : view === 'reader' ? (
          <ReaderSplit />
        ) : (
          <Home />
        )}
        {/* Kept-alive online browse (hidden when another view is active). */}
        {browseSeen && (
          <div
            className="browse-keepalive"
            style={{ display: view === 'browse' ? 'block' : 'none' }}
          >
            {libraryMode === 'normal' ? <TokiBrowse /> : <Browse />}
          </div>
        )}
      </div>
      <ActivityBar />
      <Tooltip />
      <EditContextMenu />
      <GlanceOverlay />
      {cfChallenge && (
        <div className="cf-banner">
          🔒 사이트 인증이 필요합니다. 방금 뜬 창에서 “사람인지 확인”을 완료해 주세요. 완료되면 자동으로 진행됩니다.
        </div>
      )}
      {showExit && <ExitModal onChoose={onExit} />}
      {askAddr && (
        <ConfirmModal
          icon="🌐"
          title={libraryMode === 'normal' ? '만화 사이트 온라인 주소를 입력하세요' : '동인지 온라인 주소를 입력하세요'}
          desc={
            libraryMode === 'normal'
              ? '온라인 둘러보기·검색·다운로드를 사용하려면 설정 → 네트워크에서 만화 사이트 온라인 주소를 입력해야 합니다. 지금 설정을 열까요?'
              : '온라인 둘러보기·검색·다운로드를 사용하려면 설정 → 네트워크에서 동인지 온라인 주소를 입력해야 합니다. 지금 설정을 열까요?'
          }
          confirmLabel="설정 열기"
          cancelLabel="나중에"
          onConfirm={() => {
            setAskAddr(false)
            useStore.getState().goSettings()
          }}
          onCancel={() => setAskAddr(false)}
        />
      )}
      {needDownloadDir && (
        <ConfirmModal
          icon="📁"
          title="저장 폴더가 없습니다"
          desc={
            libraryMode === 'normal'
              ? '다운로드를 저장하려면 설정 → 일반 만화에서 다운로드 폴더(또는 라이브러리 폴더)를 먼저 지정하세요.'
              : '다운로드를 저장하려면 설정 → 폴더에서 다운로드 폴더(또는 라이브러리 폴더)를 먼저 지정하세요.'
          }
          confirmLabel="설정 열기"
          cancelLabel="나중에"
          onConfirm={() => {
            setNeedDownloadDir(false)
            useStore.getState().goSettings()
          }}
          onCancel={() => setNeedDownloadDir(false)}
        />
      )}
    </div>
  )
}

// Reader with an always-visible, resizable list pane on the left (noa6 layout).
function ReaderSplit(): JSX.Element {
  const listWidth = useStore((s) => s.listWidth)
  const normalListWidth = useStore((s) => s.normalListWidth)
  const listCollapsed = useStore((s) => s.listCollapsed)
  const toggleListCollapsed = useStore((s) => s.toggleListCollapsed)
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const activeOnline = !!activeTab?.online
  const activeToki = activeTab?.online?.kind === 'toki'
  const activeNormal = activeTab?.mode === 'normal'
  const dragging = useRef(false)
  const paneRef = useRef<HTMLDivElement>(null)
  const dragW = useRef(0)
  // General-manga list keeps its own (narrower) width; both stay resizable.
  const paneWidth = activeNormal ? normalListWidth : listWidth

  useEffect(() => {
    const activeIsNormal = (): boolean => {
      const st = useStore.getState()
      return st.tabs.find((x) => x.id === st.activeTabId)?.mode === 'normal'
    }
    // While dragging, resize the pane by writing its width DIRECTLY to the DOM —
    // no store update per frame. Committing to the store each mousemove re-renders
    // the whole left list (the doujin library list can be thousands of rows),
    // which made resizing very laggy. We commit once on mouseup instead.
    const onMove = (e: MouseEvent): void => {
      if (!dragging.current || !paneRef.current) return
      // Min keeps the rating stars + 즐겨찾기/그룹 seg fully visible (thumb + foot).
      const w = Math.max(300, Math.min(720, e.clientX))
      dragW.current = w
      paneRef.current.style.width = `${w}px`
    }
    const onUp = (): void => {
      if (!dragging.current) return
      dragging.current = false
      document.body.classList.remove('resizing')
      if (dragW.current > 0) {
        const st = useStore.getState()
        if (activeIsNormal()) st.setNormalListWidth(dragW.current, true)
        else st.setListWidth(dragW.current, true)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div className="reader-split">
      {/* Kept mounted so the collapse/expand width animation can play (mirrors the
          tab open/close animation); collapsed drives width → 0 via CSS. */}
      <div
        className={`list-pane ${listCollapsed ? 'collapsed' : ''}`}
        ref={paneRef}
        style={{ width: listCollapsed ? 0 : paneWidth }}
      >
        {activeToki ? <TokiChapterList /> : activeOnline ? <OnlineList /> : <LibraryList />}
      </div>
      <div
        className={`divider ${listCollapsed ? 'collapsed' : ''}`}
        onMouseDown={() => {
          if (listCollapsed) return
          dragging.current = true
          document.body.classList.add('resizing')
        }}
      >
        <button
          className="list-toggle"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggleListCollapsed}
          title={listCollapsed ? '목록 펼치기' : '목록 접기'}
        >
          {listCollapsed ? '▶' : '◀'}
        </button>
      </div>
      <div className="reader-pane">
        {!activeTab ? (
          <div className="reader empty">탭이 없습니다.</div>
        ) : activeTab.split ? (
          <SplitReader tab={activeTab} />
        ) : (
          // Key by tab so each tab keeps its own zoom/mode; prev/next reuse the
          // same tab id (same instance) so the view carries over.
          <Reader key={activeTab.id} tabId={activeTab.id} side="left" />
        )}
      </div>
    </div>
  )
}

// Focus the search box of the current view: a visible input.search, preferring
// one in the same pane as the current focus (split view), else the first.
function focusSearch(): boolean {
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input.search')).filter(
    (el) => el.offsetParent !== null
  )
  if (!boxes.length) return false
  const act = document.activeElement
  const pane = act?.closest('.split-pane, .pane, .reader')
  const el = (pane && boxes.find((b) => pane.contains(b))) || boxes[0]
  el.focus()
  el.select()
  return true
}
