import { create } from 'zustand'
import type { Work, Settings, SortMode, SessionState, OnlineFav, FitMode } from '../../shared/types'
import { DEFAULT_SETTINGS, SPLIT_SETTING_KEYS } from '../../shared/types'
import type { HitomiListSource, HitomiProgress, TokiChapter, UpdateStatus } from '../../shared/ipc'
import { exportWorkText, exportWorkImages } from './export'
import { warmThumbs, invalidateThumb } from './thumbs'
import { convertWorkToWebp } from './convert'
import { thumbTargetIds, groupSeries, titleKey } from './util'

// Merge the active mode's per-mode overrides over the base settings so hitomi and
// general-manga keep independent display/reader/sort prefs. The result still
// carries `perMode`, so it round-trips through saveSettings unchanged.
function effectiveSettings(s: Settings, mode: 'hitomi' | 'normal'): Settings {
  const overlay = s.perMode?.[mode]
  if (!overlay) return s
  // Only keys that are still split apply — stale overlay entries from keys that
  // became shared (e.g. theme) must not shadow the shared value.
  const picked = Object.fromEntries(
    SPLIT_SETTING_KEYS.filter((k) => k in overlay).map((k) => [k, overlay[k]])
  ) as Partial<Settings>
  return { ...s, ...picked }
}

export interface OnlineGallery {
  // For hitomi this is the numeric gallery code; for toki it's the chapter
  // viewer URL (always starts with http, which is how the reader tells them
  // apart). Unique per online tab either way.
  code: string
  title: string
  artist: string | null
  kind?: 'hitomi' | 'toki' // undefined = hitomi (legacy)
  seriesUrl?: string // toki: the series page, for the sibling-chapter list
  chapterLabel?: string // toki: current chapter label ("n화"), shown in the tab title
  thumb?: string | null // toki: wrapped cover url (hitomi fetches its own)
}

// Everything needed to (re)start a download. Stored on the DownloadItem so a
// stopped/failed download can be retried or resumed from the activity list.
export type DownloadSpec =
  | { kind: 'hitomi'; input: string; title?: string }
  | { kind: 'toki'; seriesUrl: string; title: string; chapterUrls?: string[] }
  | { kind: 'generic'; title: string; chapters: TokiChapter[]; only?: string[] }

// The progress code a spec reports under (matches main's emitted code).
export function specCode(s: DownloadSpec): string {
  if (s.kind === 'hitomi') return (s.input.match(/\d{5,}/) ?? [s.input])[0]
  if (s.kind === 'toki') return s.seriesUrl
  return 'backup:' + s.title
}

// One entry in the download manager list (feature 1). Keyed by gallery code.
export interface DownloadItem {
  code: string
  title: string
  done: number
  total: number
  phase: HitomiProgress['phase']
  error?: string
  spec?: DownloadSpec // how to (re)start this download; set on dispatch
}

// A background task shown in the global activity bar (text export, library scan…).
// Online downloads live in `downloads` and are merged into the same UI, so this
// covers everything else. total=0 → indeterminate (spinner, no percentage).
export interface Job {
  id: string
  kind: 'export' | 'scan' | 'meta' | 'thumb' | 'organize' | 'convert'
  mode: 'hitomi' | 'normal' // which library the task belongs to (bar is per-mode)
  title: string
  status: 'running' | 'done' | 'error'
  done: number
  total: number
  detail?: string
  error?: string
  startedAt: number
  endedAt?: number
}

// A download's library mode is encoded in its code: numeric = hitomi gallery;
// an http(s) url (toki chapter) or a "backup:" code = general-manga (normal).
export function downloadMode(code: string): 'hitomi' | 'normal' {
  return /^https?:/.test(code) || code.startsWith('backup:') ? 'normal' : 'hitomi'
}

export interface Tab {
  id: string
  workId: string // '' for online-only tabs
  online?: OnlineGallery
  scrollTop: number
  // Split view: when `split` is true the tab shows two panes side by side. The
  // right pane may be empty (rightWorkId '' and no rightOnline) → shows a picker.
  split?: boolean
  rightWorkId?: string
  rightOnline?: OnlineGallery
  rightScrollTop?: number
  splitRatio?: number // left pane fraction, 0..1 (default 0.5)
  groupId?: string // manual tab group membership
  mode?: 'hitomi' | 'normal' // which library this tab belongs to
  // Glance (peek) tab: rendered in a floating overlay, hidden from the tab bar,
  // discarded on close. Promote clears the flag → becomes a normal tab.
  glance?: boolean
  // Work ids visited in this tab's LEFT pane (oldest→newest, excluding current).
  // Back (mouse side button) rewinds through these; when empty, back closes the
  // tab. Only in-tab work swaps (replaceTabWork) push here.
  back?: string[]
  // Per-tab (per-pane) view state: zoom + reading mode. Kept on the tab so each
  // tab remembers its own; a newly opened tab inherits the last-viewed tab's.
  // Undefined → fall back to settings.readerMode / 100%.
  zoom?: number
  readerMode?: 'scroll' | 'paged' | 'spread'
  fit?: FitMode
  rightZoom?: number
  rightReaderMode?: 'scroll' | 'paged' | 'spread'
  rightFit?: FitMode
}

export interface TabGroup {
  id: string
  name: string
  color: string
}

// A work/online reference used when filling a split pane.
export interface PaneSrc {
  workId?: string
  online?: OnlineGallery
}

export type Filter =
  | { kind: 'all' }
  | { kind: 'artist'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'favorites' }
  | { kind: 'favlists'; value: string[] } // works in ANY of the checked favorite lists

type View = 'home' | 'reader' | 'settings' | 'download' | 'browse' | 'manage'

// One browser-style navigation entry: enough to restore where the user was.
export interface NavEntry {
  view: View
  activeTabId: string | null
  libraryMode: 'hitomi' | 'normal'
  manageMode: 'duplicates' | 'translations' | 'merge' | 'collections'
  // Only meaningful when view === 'browse': the online list source + page, so back
  // steps through previous online searches/pages before leaving the online view.
  browseSource?: HitomiListSource
  browsePage?: number
}

// One reversible navBack step, consumed by navForward.
type RedoEntry =
  // In-tab work rewind: restore the tab's work + its back stack to before the back.
  | { kind: 'work'; tabId: string; workId: string; back: string[]; libraryMode: 'hitomi' | 'normal' }
  // Tab was closed while stepping out: reopen it and step the nav history forward.
  | { kind: 'close'; tab: Tab }
  // Plain history step: just move the nav position forward.
  | { kind: 'nav' }

interface AppState {
  works: Work[]
  settings: Settings
  loading: boolean

  // navigation
  view: View
  manageMode: 'duplicates' | 'translations' | 'merge' | 'collections'
  // Which library the home/list views show: hitomi galleries or general manga.
  libraryMode: 'hitomi' | 'normal'
  menuOpen: boolean // ☰ left nav drawer
  // Unsaved-settings guard. Settings marks itself dirty; any attempt to navigate
  // away while dirty is stashed in `pendingNav` so a confirm modal can offer
  // 저장 / 저장 안 함 / 닫기 before the navigation runs.
  settingsDirty: boolean
  pendingNav: (() => void) | null
  // Home scroll memory: last scrollTop of the library home, restored when the user
  // returns; a bumped nonce tells Home to jump to the top (홈 pressed while home).
  homeScroll: number
  homePage: number
  homeTopNonce: number
  // Browser-style navigation history (mouse back/forward side buttons).
  navStack: NavEntry[]
  navPos: number
  // Redo stack for the forward button: each entry knows how to reverse one
  // navBack step (rewind an in-tab work / reopen a closed tab / step nav forward).
  // Cleared whenever a NEW navigation happens (browser semantics).
  navRedo: RedoEntry[]
  listCollapsed: boolean // reader left list pane hidden
  thumbNonce: number // bumped to force all <Thumb>s to reload (cover regen)
  tabs: Tab[]
  tabGroups: TabGroup[]
  activeTabId: string | null

  // home controls
  search: string
  // A tag clicked on a work card seeds the home search input (not applied
  // immediately) — Home appends it on nonce change. Mirrors the online flow.
  searchSeed: { tok: string; nonce: number } | null
  sort: SortMode
  sortDir: 'asc' | 'desc' // home list sort direction (desc = default order)
  favSort: 'rank' | 'recent' // favorites-view sort; persists across Home remounts
  filter: Filter
  randomSeed: number
  popularRanks: Record<string, number> | null
  showCoded: boolean
  showUncoded: boolean
  langFilter: { korean: boolean; english: boolean; japanese: boolean; other: boolean }
  groupFilter: Record<string, boolean> // group id -> shown (missing = shown)
  showUngrouped: boolean

  // reader split
  listWidth: number
  normalListWidth: number
  readerMode: 'scroll' | 'paged' | 'spread'
  homeLayout: 'list' | 'grid'

  // online
  browseSource: HitomiListSource
  browsePage: number
  // Bumped when the online (🌐) button is pressed while already on the browse
  // view → tells the open browse component to jump to the first page + scroll
  // top, WITHOUT resetting the language/sort/genre filters.
  browseTopNonce: number
  // Seed for a general-manga online author search, set from a clicked author
  // name elsewhere (reader header / card). TokiBrowse consumes it on change.
  tokiAuthorSeed: { name: string; nonce: number } | null
  onlineProgress: Record<string, { scrollTop: number; pageIdx: number }>
  downloads: DownloadItem[] // active + finished downloads this session (newest first)
  onlineFavs: Record<string, OnlineFav> // hitomi gallery favorites/ranks by code
  jobs: Job[] // background tasks (export/scan) this session, newest first
  activityOpen: boolean // is the activity panel (above the bar) expanded
  update: UpdateStatus | null // auto-update state, shown as a row in the activity bar
  setUpdate: (s: UpdateStatus) => void
  installUpdate: () => void // quit + install the downloaded update
  needDownloadDir: boolean // download attempted with no destination folder → prompt
  setNeedDownloadDir: (v: boolean) => void
  favDownloadedOnly: boolean // local favorites view: show only already-downloaded entries
  setFavDownloadedOnly: (v: boolean) => void
  favOnlineOnly: boolean // online favorites view: show only online favorites (exclude local-only)
  setFavOnlineOnly: (v: boolean) => void
  onlineListFav: boolean // reader's left online list shows favorites (opened from fav view)
  setOnlineListFav: (v: boolean) => void

  // Job helpers + the tasks that run through them (kept in the store so they
  // survive view switches — progress + completion show in the global activity bar).
  toggleActivity: (open?: boolean) => void
  clearDoneJobs: () => void
  startJob: (kind: Job['kind'], mode: Job['mode'], title: string, detail?: string) => string
  updateJob: (id: string, patch: Partial<Job>) => void
  endJob: (id: string, patch: Partial<Job>) => void
  exportWorkJob: (workId: string, withTr: boolean) => Promise<void>
  exportImagesJob: (workId: string) => Promise<void>
  scanFolderJob: (path: string, mode: Job['mode']) => Promise<void>
  scanLibraryJob: () => Promise<void>

  setWorks: (w: Work[]) => void
  upsertWork: (w: Work) => void
  addWork: (w: Work) => void
  removeWork: (id: string) => void
  setSettings: (s: Settings) => void
  // Prepend a query to the online search history (deduped, capped, persisted).
  pushSearchHistory: (q: string) => void
  // Toggle a general-manga in-app favorite (series key or chapter work id).
  toggleNormalFav: (kind: 'series' | 'chapter', key: string, fav: boolean) => Promise<void>
  setLoading: (b: boolean) => void
  setSettingsDirty: (b: boolean) => void
  // Run `nav`, or (if in dirty Settings) stash it for the leave-confirm modal.
  guardedNav: (nav: () => void) => void
  clearPendingNav: () => void
  setHomeScroll: (n: number) => void
  setHomePage: (n: number) => void
  scrollHomeTop: () => void
  scrollBrowseTop: () => void
  // Record the current location in the nav history (deduped); step back/forward.
  recordNav: () => void
  navBack: () => void
  navForward: () => void

  goHome: () => void
  // Browser-style back: from a reader, return to the list it came from — the
  // online browse for an online tab, the library home for a local work.
  goBack: () => void
  goSettings: () => void
  goDownload: () => void
  goBrowse: () => void
  goManage: (mode: 'duplicates' | 'translations' | 'merge' | 'collections') => void
  setLibraryMode: (m: 'hitomi' | 'normal') => void
  toggleMenu: () => void
  setMenuOpen: (b: boolean) => void
  toggleListCollapsed: () => void
  bumpThumbNonce: () => void
  // Replace the work shown in one pane of a tab in place (chapter prev/next).
  replaceTabWork: (tabId: string, side: 'left' | 'right', workId: string) => void
  // Continuous reading: the ordered work ids of the current left list. The reader
  // uses it to flow from the last page of one work into the next (and back).
  readingQueue: string[]
  setReadingQueue: (ids: string[]) => void
  // Per-tab flag: the next load should start at the LAST page / bottom (used when
  // continuing BACKWARD into the previous work). Reader consumes + clears it.
  startAtBottom: Record<string, boolean>
  clearStartAtBottom: (tabId: string) => void
  // Advance the left pane to the neighbour work in readingQueue. dir +1 = next,
  // -1 = previous. Returns true if it moved (a neighbour existed).
  continueReading: (tabId: string, side: 'left' | 'right', dir: 1 | -1) => boolean
  replaceTabOnline: (tabId: string, g: OnlineGallery) => void
  openTab: (workId: string) => void
  openOnline: (g: OnlineGallery) => void
  // Open a toki (general-manga online) chapter, keeping general-manga mode.
  openToki: (g: OnlineGallery) => void
  // Open in a background tab: add the tab but stay on the current view/tab.
  openTabBackground: (workId: string) => void
  openOnlineBackground: (g: OnlineGallery) => void
  openTokiBackground: (g: OnlineGallery) => void
  closeTab: (tabId: string) => void
  // Tabs currently collapse-animating before closeTab actually removes them. The
  // tab bar renders these with a closing animation; requestCloseTab starts it.
  closingTabs: string[]
  requestCloseTab: (tabId: string) => void
  // Stack of recently closed tabs; reopenClosedTab restores the most recent.
  closedTabs: Tab[]
  reopenClosedTab: () => void
  // Glance (peek) overlay: open a work/online gallery in a floating reader without
  // creating a real tab. Promote turns it into a normal tab.
  glanceTabId: string | null
  openGlance: (src: { workId: string } | { online: OnlineGallery }) => void
  closeGlance: () => void
  promoteGlance: () => void
  activateTab: (tabId: string) => void
  moveTab: (dragId: string, overId: string | null) => void // reorder; null = move to end
  refreshTab: (tabId: string) => void // reload that tab's content
  reloadNonce: number
  // Split view.
  openSplit: (workId: string) => void
  openSplitOnline: (g: OnlineGallery) => void
  openSplitFromTab: (tabId: string) => void
  fillSplitRight: (tabId: string, src: PaneSrc) => void
  closeSplitSide: (tabId: string, side: 'left' | 'right') => void
  splitDetach: (tabId: string) => void // 뷰 분리: split → two separate tabs
  swapSplitSides: (tabId: string) => void // 뷰 반전: swap left/right
  swapTabIntoSplit: (sourceTabId: string, side: 'left' | 'right') => void // move a tab into the active split, swapping out the old pane
  setSplitRatio: (tabId: string, ratio: number) => void
  // Manual tab groups.
  createTabGroup: (name?: string) => string
  setTabGroup: (tabId: string, groupId: string | null) => void
  renameTabGroup: (groupId: string, name: string) => void
  deleteTabGroup: (groupId: string) => void
  setTabRightScroll: (tabId: string, scrollTop: number) => void
  setTabScroll: (tabId: string, scrollTop: number) => void
  // Persist a pane's zoom / reading mode onto its tab.
  setTabReader: (
    tabId: string,
    side: 'left' | 'right',
    patch: { zoom?: number; readerMode?: 'scroll' | 'paged' | 'spread'; fit?: FitMode }
  ) => void
  restoreSession: (s: SessionState) => void

  setSearch: (s: string) => void
  addSearchToken: (tok: string) => void
  setSort: (s: SortMode) => void
  toggleSortDir: () => void
  setFavSort: (s: 'rank' | 'recent') => void
  setFilter: (f: Filter) => void
  reshuffle: () => void
  setPopularRanks: (r: Record<string, number>) => void
  setShowCoded: (b: boolean) => void
  setShowUncoded: (b: boolean) => void
  setLangFilter: (cat: 'korean' | 'english' | 'japanese' | 'other', on: boolean) => void
  setGroupFilter: (id: string, on: boolean) => void
  setShowUngrouped: (b: boolean) => void
  createGroup: (name: string) => Promise<string | null>
  deleteGroup: (id: string) => Promise<void>
  setSeriesTags: (key: string, tags: string[]) => Promise<void>
  pushDownloadProgress: (p: HitomiProgress) => void
  // Dispatch (or redispatch) a download through the main queue. Records the spec
  // on the item so it can be stopped/retried later, calls the right IPC, and
  // adds the resulting work(s) to the library. Returns created works, or null if
  // the download was stopped. Real failures reject so callers can surface them.
  startDownload: (spec: DownloadSpec) => Promise<Work[] | null>
  stopDownload: (code: string) => void // abort a running/queued download
  retryDownload: (code: string) => void // restart a stopped/failed download
  removeDownload: (code: string) => void // cancel + drop from the activity list
  stopAllDownloads: (mode: 'hitomi' | 'normal') => void
  startAllDownloads: (mode: 'hitomi' | 'normal') => void
  setListWidth: (px: number, persist?: boolean) => void
  setNormalListWidth: (px: number, persist?: boolean) => void
  setReaderMode: (m: 'scroll' | 'paged' | 'spread') => void
  setLastReaderMode: (lib: 'hitomi' | 'normal', m: 'scroll' | 'paged' | 'spread') => void
  setLastFit: (lib: 'hitomi' | 'normal', f: FitMode) => void
  setLastZoom: (lib: 'hitomi' | 'normal', z: number) => void
  setHomeLayout: (l: 'list' | 'grid') => void
  setBrowseSource: (s: HitomiListSource) => void
  // Cross-search: jump to the online browse and run a query (from a local card),
  // or jump to the local home and search there (from an online card).
  searchOnline: (query: string) => void
  searchLocal: (query: string) => void
  addFavoriteTag: (tag: string) => void // add a tag/artist to the highlighted set
  setBrowsePage: (p: number) => void
  searchTokiAuthor: (name: string) => void
  setOnlineProgress: (code: string, p: { scrollTop: number; pageIdx: number }) => void
  setOnlineFavs: (list: OnlineFav[]) => void
  toggleOnlineFav: (code: string, meta?: Partial<OnlineFav>) => Promise<void>
  // Unified favorite toggle: flips BOTH the online favorite and (if the gallery is
  // in the local library) the local favorite, so a favorite is one state everywhere.
  toggleUnifiedFav: (code: string, meta?: Partial<OnlineFav>) => Promise<void>
  // General-manga unified favorite: a local series (by key) and its online toki
  // series (by url) are linked by normalized title and toggled together.
  toggleNormalUnifiedFav: (p: { title: string; localKey?: string; url?: string; meta?: Partial<OnlineFav> }) => Promise<void>
  setOnlineRank: (code: string, rank: number, meta?: Partial<OnlineFav>) => Promise<void>
}

function applyFav(favs: Record<string, OnlineFav>, fav: OnlineFav): Record<string, OnlineFav> {
  const n = { ...favs }
  if (!fav.favorite && fav.rank === 0) delete n[fav.code]
  else n[fav.code] = fav
  return n
}

let tabSeq = 1

// Palette cycled through for new manual tab groups.
const TAB_GROUP_COLORS = ['#4c8dff', '#3ddc84', '#ff9b4d', '#c77dff', '#ff5d8f', '#36c5d0', '#ffcc4d']

// View state (zoom + mode) a newly opened tab inherits from the last-viewed tab,
// so prev/next-chapter and list-selected works keep the current look. Reader mode
// is only inherited within the SAME library (hitomi/normal); across libraries the
// tab starts unset so the Reader restores that library's own last-used mode.
function inheritReader(
  st: AppState,
  newMode?: 'hitomi' | 'normal'
): { zoom?: number; readerMode?: Tab['readerMode']; fit?: Tab['fit'] } {
  const cur = st.tabs.find((t) => t.id === st.activeTabId)
  const sameLib = !newMode || cur?.mode === newMode
  return {
    zoom: sameLib ? cur?.zoom : undefined,
    readerMode: sameLib ? cur?.readerMode : undefined,
    fit: sameLib ? cur?.fit : undefined
  }
}

function makeTab(src: { workId?: string; online?: OnlineGallery; scrollTop?: number }): Tab {
  return {
    id: `t${tabSeq++}`,
    workId: src.online ? '' : src.workId ?? '',
    online: src.online,
    scrollTop: src.scrollTop ?? 0
  }
}

// Set one pane of a tab to `src`. If that pane already held a work, the displaced
// work is spun back out into its own standalone tab (inserted right after) so it
// is never silently lost.
function setPane(tabs: Tab[], tabId: string, side: 'left' | 'right', src: PaneSrc): Tab[] {
  const T = tabs.find((t) => t.id === tabId)
  if (!T) return tabs
  const oldWork = side === 'right' ? T.rightWorkId : T.workId
  const oldOnline = side === 'right' ? T.rightOnline : T.online
  const displaced = oldWork || oldOnline ? makeTab({ workId: oldWork, online: oldOnline }) : null
  const out = tabs.map((t) => {
    if (t.id !== tabId) return t
    if (side === 'right') {
      return {
        ...t,
        split: true,
        rightWorkId: src.online ? '' : src.workId ?? '',
        rightOnline: src.online,
        rightScrollTop: 0,
        splitRatio: t.splitRatio ?? 0.5
      }
    }
    return { ...t, workId: src.online ? '' : src.workId ?? '', online: src.online, scrollTop: 0 }
  })
  if (displaced) {
    const idx = out.findIndex((t) => t.id === tabId)
    out.splice(idx + 1, 0, displaced)
  }
  return out
}

// Shared logic for "open in split": fill the active reader tab's right pane, or
// create a new split tab with the content on the left.
function splitInto(st: AppState, src: PaneSrc): Partial<AppState> {
  const active = st.tabs.find((t) => t.id === st.activeTabId)
  if (st.view === 'reader' && active) {
    return { tabs: setPane(st.tabs, active.id, 'right', src) }
  }
  // New split tab (opened from the library/home). Stamp the tab's library mode
  // from the work so it lands in the right tab bar and switches the mode.
  const mode: 'hitomi' | 'normal' = src.online
    ? src.online.kind === 'toki'
      ? 'normal'
      : 'hitomi'
    : (st.works.find((w) => w.id === src.workId)?.library ?? 'hitomi')
  const tab: Tab = { ...makeTab(src), mode, split: true, splitRatio: 0.5 }
  return { tabs: [...st.tabs, tab], activeTabId: tab.id, view: 'reader', libraryMode: mode }
}

// Route a navigation through the unsaved-settings guard: if the user is in
// Settings with unsaved edits, stash the navigation for the confirm modal instead
// of running it now.
function guardLeave(get: () => AppState, set: (p: Partial<AppState>) => void, nav: () => void): void {
  const s = get()
  if (s.view === 'settings' && s.settingsDirty) {
    set({ pendingNav: () => nav() })
    return
  }
  nav()
}

function sameNav(a: NavEntry, b: NavEntry): boolean {
  if (
    a.view !== b.view ||
    a.activeTabId !== b.activeTabId ||
    a.libraryMode !== b.libraryMode ||
    a.manageMode !== b.manageMode
  )
    return false
  // On the online view, the page + search source also distinguish entries.
  if (a.view === 'browse')
    return a.browsePage === b.browsePage && JSON.stringify(a.browseSource) === JSON.stringify(b.browseSource)
  return true
}

// Jump to a stored nav entry. A reader entry whose tab has since closed falls
// back to the library home so we never show a dead tab.
function applyNav(
  get: () => AppState,
  set: (p: Partial<AppState>) => void,
  e: NavEntry
): void {
  const st = get()
  if (e.view === 'reader' && !st.tabs.some((t) => t.id === e.activeTabId)) {
    set({ view: 'home', activeTabId: null, libraryMode: e.libraryMode })
    return
  }
  set({ view: e.view, activeTabId: e.activeTabId, libraryMode: e.libraryMode, manageMode: e.manageMode })
  // Restore the online list position for browse entries.
  if (e.view === 'browse') {
    if (e.browseSource) set({ browseSource: e.browseSource })
    if (e.browsePage != null) set({ browsePage: e.browsePage })
  }
}

export const useStore = create<AppState>((set, get) => ({
  works: [],
  settings: { ...DEFAULT_SETTINGS },
  loading: false,

  view: 'home',
  manageMode: 'duplicates',
  libraryMode: 'hitomi',
  menuOpen: false,
  settingsDirty: false,
  pendingNav: null,
  homeScroll: 0,
  homePage: 0,
  homeTopNonce: 0,
  navStack: [],
  navPos: -1,
  navRedo: [],
  listCollapsed: false,
  thumbNonce: 0,
  tabs: [],
  closedTabs: [],
  glanceTabId: null,
  tabGroups: [],
  activeTabId: null,
  reloadNonce: 0,

  search: '',
  searchSeed: null,
  sort: 'random',
  sortDir: 'desc',
  favSort: 'recent',
  filter: { kind: 'all' },
  randomSeed: Math.random(),
  popularRanks: null,
  showCoded: true,
  showUncoded: true,
  langFilter: { korean: true, english: true, japanese: true, other: true },
  groupFilter: {},
  showUngrouped: true,

  listWidth: DEFAULT_SETTINGS.listPaneWidth,
  normalListWidth: DEFAULT_SETTINGS.normalListPaneWidth,
  readerMode: DEFAULT_SETTINGS.readerMode,
  homeLayout: DEFAULT_SETTINGS.homeLayout,
  browseSource: { kind: 'index', language: 'korean' },
  browsePage: 0,
  browseTopNonce: 0,
  tokiAuthorSeed: null,
  onlineProgress: {},
  downloads: [],
  onlineFavs: {},
  jobs: [],
  activityOpen: false,
  update: null,
  needDownloadDir: false,
  favDownloadedOnly: false,
  favOnlineOnly: false,
  onlineListFav: false,

  setWorks: (works) => set({ works }),
  upsertWork: (w) => set((st) => ({ works: st.works.map((x) => (x.id === w.id ? w : x)) })),
  addWork: (w) =>
    set((st) => ({
      works: st.works.some((x) => x.id === w.id)
        ? st.works.map((x) => (x.id === w.id ? w : x))
        : [w, ...st.works]
    })),
  removeWork: (id) =>
    set((st) => ({
      works: st.works.filter((x) => x.id !== id),
      tabs: st.tabs.filter((t) => t.workId !== id)
    })),
  setSettings: (raw) =>
    set((st) => {
      const settings = effectiveSettings(raw, st.libraryMode)
      return {
        settings,
        sort: settings.defaultSort,
        listWidth: settings.listPaneWidth,
        normalListWidth: settings.normalListPaneWidth,
        readerMode: settings.readerMode,
        homeLayout: settings.homeLayout
      }
    }),
  toggleNormalFav: async (kind, key, fav) => {
    const saved = await window.api.setNormalFav(kind, key, fav)
    get().setSettings(saved)
  },
  setLoading: (loading) => set({ loading }),

  setSettingsDirty: (b) => set({ settingsDirty: b }),
  guardedNav: (nav) => guardLeave(get, set, nav),
  clearPendingNav: () => set({ pendingNav: null }),
  setHomeScroll: (n) => set({ homeScroll: n }),
  setHomePage: (n) => set({ homePage: n }),
  scrollHomeTop: () => set((st) => ({ homeScroll: 0, homeTopNonce: st.homeTopNonce + 1 })),
  scrollBrowseTop: () => set((st) => ({ browseTopNonce: st.browseTopNonce + 1 })),

  recordNav: () =>
    set((st) => {
      const cur: NavEntry = {
        view: st.view,
        activeTabId: st.activeTabId,
        libraryMode: st.libraryMode,
        manageMode: st.manageMode,
        ...(st.view === 'browse'
          ? { browseSource: st.browseSource, browsePage: st.browsePage }
          : {})
      }
      const top = st.navStack[st.navPos]
      // Equal to the current position → this change came from back/forward (or is a
      // no-op); don't record it. Otherwise truncate any forward history and push.
      if (top && sameNav(top, cur)) return {}
      const stack = st.navStack.slice(0, st.navPos + 1)
      stack.push(cur)
      const capped = stack.slice(-100)
      return { navStack: capped, navPos: capped.length - 1, navRedo: [] }
    }),
  // Back/forward (incl. mouse side buttons) route through guardLeave, so an
  // unsaved-settings edit pops the save-confirm modal just like menu navigation.
  navBack: () =>
    guardLeave(get, set, () => {
      const st = get()
      // In a reader tab, back first rewinds through the works visited IN this tab
      // (in-tab swaps aren't in the nav history). Only once we're back at the work
      // the tab was first opened on does back close the tab and step out.
      const pushRedo = (e: RedoEntry): void => set((s) => ({ navRedo: [...s.navRedo, e] }))
      if (st.view === 'reader') {
        const tab = st.tabs.find((t) => t.id === st.activeTabId)
        if (tab && tab.back && tab.back.length) {
          const back = [...tab.back]
          const prev = back.pop()!
          const mode = (st.works.find((w) => w.id === prev)?.library ?? 'hitomi') as 'hitomi' | 'normal'
          // Redo restores the work we're leaving + its back stack as it is now.
          pushRedo({ kind: 'work', tabId: tab.id, workId: tab.workId, back: tab.back ?? [], libraryMode: st.libraryMode })
          set({
            tabs: st.tabs.map((t) =>
              t.id === tab.id ? { ...t, workId: prev, online: undefined, scrollTop: 0, back, mode } : t
            ),
            libraryMode: mode
          })
          return
        }
        // First work → close the tab, then step to the previous screen.
        const closeId = st.activeTabId
        if (st.navPos > 0) {
          if (tab) pushRedo({ kind: 'close', tab })
          set({ navPos: st.navPos - 1 })
          applyNav(get, set, st.navStack[st.navPos - 1])
        } else {
          set({ view: 'home', activeTabId: null })
        }
        if (closeId) set((s) => ({ tabs: s.tabs.filter((t) => t.id !== closeId) }))
        return
      }
      // Non-reader screens: normal history back.
      if (st.navPos <= 0) return
      pushRedo({ kind: 'nav' })
      set({ navPos: st.navPos - 1 })
      applyNav(get, set, st.navStack[st.navPos - 1])
    }),
  // Redo the last navBack: pull the top redo entry and reverse that one step.
  navForward: () =>
    guardLeave(get, set, () => {
      const st = get()
      if (st.navRedo.length === 0) return
      const e = st.navRedo[st.navRedo.length - 1]
      set({ navRedo: st.navRedo.slice(0, -1) })
      if (e.kind === 'work') {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === e.tabId ? { ...t, workId: e.workId, online: undefined, scrollTop: 0, back: e.back } : t
          ),
          libraryMode: e.libraryMode
        }))
        return
      }
      if (e.kind === 'close') {
        // Reopen the closed tab, then step the nav history back to its reader entry.
        set((s) => ({ tabs: s.tabs.some((t) => t.id === e.tab.id) ? s.tabs : [...s.tabs, e.tab] }))
        if (st.navPos < st.navStack.length - 1) {
          set((s) => ({ navPos: s.navPos + 1 }))
          applyNav(get, set, st.navStack[get().navPos])
        }
        return
      }
      // kind 'nav'
      if (st.navPos < st.navStack.length - 1) {
        set((s) => ({ navPos: s.navPos + 1 }))
        applyNav(get, set, st.navStack[get().navPos])
      }
    }),

  goHome: () => guardLeave(get, set, () => set({ view: 'home', activeTabId: null })),
  goBack: () =>
    set((st) => {
      if (st.view !== 'reader') return {}
      const active = st.tabs.find((t) => t.id === st.activeTabId)
      // Online tab → back to the online browse; local work → back to the library
      // home. Keep the tab open so it can be reopened. libraryMode already tracks
      // the tab's mode, so browse renders the right list (hitomi vs 일반 만화).
      return active?.online ? { view: 'browse' } : { view: 'home', activeTabId: null }
    }),
  goSettings: () => set({ view: 'settings' }),
  goDownload: () => guardLeave(get, set, () => set({ view: 'download' })),
  goBrowse: () => guardLeave(get, set, () => set({ view: 'browse' })),
  goManage: (mode) => guardLeave(get, set, () => set({ view: 'manage', manageMode: mode })),
  // Switch library mode → reset home filters and go to the home list.
  setLibraryMode: (m) =>
    guardLeave(get, set, () =>
      set((st) => {
        // Re-apply the target mode's per-mode setting overrides.
        const settings = effectiveSettings(st.settings, m)
        return {
          libraryMode: m,
          view: 'home',
          activeTabId: null,
          filter: { kind: 'all' },
          search: '',
          settings,
          sort: settings.defaultSort,
          readerMode: settings.readerMode,
          homeLayout: settings.homeLayout
        }
      })
    ),
  toggleMenu: () => set((st) => ({ menuOpen: !st.menuOpen })),
  setMenuOpen: (b) => set({ menuOpen: b }),
  toggleListCollapsed: () => set((st) => ({ listCollapsed: !st.listCollapsed })),
  bumpThumbNonce: () => set((st) => ({ thumbNonce: st.thumbNonce + 1 })),
  replaceTabWork: (tabId, side, workId) =>
    set((st) => {
      const mode = (st.works.find((w) => w.id === workId)?.library ?? 'hitomi') as 'hitomi' | 'normal'
      return {
        tabs: st.tabs.map((t) => {
          if (t.id !== tabId) return t
          if (side === 'right') return { ...t, rightWorkId: workId, rightOnline: undefined, rightScrollTop: 0 }
          // Push the outgoing work so back can rewind to it (skip no-op re-opens).
          const prev = t.workId
          const back =
            prev && prev !== workId ? [...(t.back ?? []), prev].slice(-100) : t.back
          return { ...t, workId, online: undefined, scrollTop: 0, mode, back }
        }),
        navRedo: [] // a new forward move invalidates the redo stack
      }
    }),

  readingQueue: [],
  setReadingQueue: (ids) => {
    // Avoid needless re-renders when the list is unchanged.
    const cur = get().readingQueue
    if (cur.length === ids.length && cur.every((x, i) => x === ids[i])) return
    set({ readingQueue: ids })
  },
  startAtBottom: {},
  clearStartAtBottom: (tabId) =>
    set((st) => {
      if (!st.startAtBottom[tabId]) return {}
      const next = { ...st.startAtBottom }
      delete next[tabId]
      return { startAtBottom: next }
    }),
  continueReading: (tabId, side, dir) => {
    if (side !== 'left') return false
    const st = get()
    const tab = st.tabs.find((t) => t.id === tabId)
    if (!tab || !tab.workId) return false
    const i = st.readingQueue.indexOf(tab.workId)
    if (i < 0) return false
    const nextId = st.readingQueue[i + dir]
    if (!nextId) return false
    st.replaceTabWork(tabId, 'left', nextId)
    if (dir < 0) set((s) => ({ startAtBottom: { ...s.startAtBottom, [tabId]: true } }))
    return true
  },

  // Load another online chapter/gallery IN the same tab (left pane) instead of
  // spawning a new one — used by the reader's chapter list + prev/next buttons.
  replaceTabOnline: (tabId, g) =>
    set((st) => ({
      tabs: st.tabs.map((t) =>
        t.id !== tabId ? t : { ...t, workId: '', online: g, scrollTop: 0 }
      )
    })),

  openTab: (workId) => {
    const modeOf = (id: string): 'hitomi' | 'normal' =>
      (get().works.find((w) => w.id === id)?.library ?? 'hitomi') as 'hitomi' | 'normal'
    const existing = get().tabs.find((t) => t.workId === workId)
    if (existing) {
      set({ activeTabId: existing.id, view: 'reader', libraryMode: existing.mode ?? modeOf(workId) })
      return
    }
    const mode = modeOf(workId)
    set((st) => {
      const tab: Tab = { id: `t${tabSeq++}`, workId, scrollTop: 0, mode, ...inheritReader(st, mode) }
      return { tabs: [...st.tabs, tab], activeTabId: tab.id, view: 'reader', libraryMode: mode }
    })
  },

  openOnline: (g) => {
    const existing = get().tabs.find((t) => t.online?.code === g.code)
    if (existing) {
      set({ activeTabId: existing.id, view: 'reader', libraryMode: 'hitomi' })
      return
    }
    set((st) => {
      const tab: Tab = { id: `t${tabSeq++}`, workId: '', online: g, scrollTop: 0, mode: 'hitomi', ...inheritReader(st, 'hitomi') }
      return { tabs: [...st.tabs, tab], activeTabId: tab.id, view: 'reader', libraryMode: 'hitomi' }
    })
  },

  // Same as openOnline but stays in general-manga mode and stamps the tab as
  // normal, so the reader shows the toki chapter list (not the hitomi browse).
  openToki: (g) => {
    const existing = get().tabs.find((t) => t.online?.code === g.code)
    if (existing) {
      set({ activeTabId: existing.id, view: 'reader', libraryMode: 'normal' })
      return
    }
    set((st) => {
      const tab: Tab = {
        id: `t${tabSeq++}`,
        workId: '',
        online: { ...g, kind: 'toki' },
        scrollTop: 0,
        mode: 'normal',
        ...inheritReader(st, 'normal')
      }
      return { tabs: [...st.tabs, tab], activeTabId: tab.id, view: 'reader', libraryMode: 'normal' }
    })
  },

  openTabBackground: (workId) =>
    set((st) => {
      if (st.tabs.some((t) => t.workId === workId)) return {} // already open
      const mode = (st.works.find((w) => w.id === workId)?.library ?? 'hitomi') as 'hitomi' | 'normal'
      const tab: Tab = { id: `t${tabSeq++}`, workId, scrollTop: 0, mode, ...inheritReader(st, mode) }
      return { tabs: [...st.tabs, tab] } // no activeTabId / view change
    }),

  openOnlineBackground: (g) =>
    set((st) => {
      if (st.tabs.some((t) => t.online?.code === g.code)) return {}
      const tab: Tab = { id: `t${tabSeq++}`, workId: '', online: g, scrollTop: 0, mode: 'hitomi', ...inheritReader(st, 'hitomi') }
      return { tabs: [...st.tabs, tab] }
    }),

  openTokiBackground: (g) =>
    set((st) => {
      if (st.tabs.some((t) => t.online?.code === g.code)) return {}
      const tab: Tab = {
        id: `t${tabSeq++}`,
        workId: '',
        online: { ...g, kind: 'toki' },
        scrollTop: 0,
        mode: 'normal',
        ...inheritReader(st, 'normal')
      }
      return { tabs: [...st.tabs, tab] }
    }),

  moveTab: (dragId, overId) =>
    set((st) => {
      if (dragId === overId) return {}
      const from = st.tabs.findIndex((t) => t.id === dragId)
      if (from < 0) return {}
      const tabs = [...st.tabs]
      const [moved] = tabs.splice(from, 1)
      // Insert directly before overId (index recomputed after removal), or append.
      const to = overId ? tabs.findIndex((t) => t.id === overId) : -1
      if (to < 0) tabs.push(moved)
      else tabs.splice(to, 0, moved)
      return { tabs }
    }),

  refreshTab: (tabId) =>
    set((st) => ({
      activeTabId: tabId,
      view: 'reader',
      reloadNonce: st.reloadNonce + 1
    })),

  // Open a work in split view. If a reader tab is active, the work fills that
  // tab's right pane; otherwise a new split tab opens with the work on the left.
  openSplit: (workId) =>
    set((st) => splitInto(st, { workId })),
  openSplitOnline: (g) =>
    set((st) => splitInto(st, { online: g })),

  openSplitFromTab: (tabId) =>
    set((st) => {
      const src = st.tabs.find((t) => t.id === tabId)
      const active = st.tabs.find((t) => t.id === st.activeTabId)
      if (!src) return {}
      // Fill a different active reader's right pane with this tab's content and
      // remove the now-absorbed standalone tab. (Any previous right pane is spun
      // back out by setPane.)
      if (st.view === 'reader' && active && active.id !== tabId) {
        const payload: PaneSrc = src.online ? { online: src.online } : { workId: src.workId }
        const tabs = setPane(st.tabs, active.id, 'right', payload).filter((t) => t.id !== tabId)
        return { tabs }
      }
      return { activeTabId: tabId, view: 'reader' }
    }),

  fillSplitRight: (tabId, src) => set((st) => ({ tabs: setPane(st.tabs, tabId, 'right', src) })),

  splitDetach: (tabId) =>
    set((st) => {
      const t = st.tabs.find((x) => x.id === tabId)
      if (!t) return {}
      const unsplit = (x: Tab): Tab => ({
        ...x,
        split: false,
        rightWorkId: undefined,
        rightOnline: undefined,
        rightScrollTop: undefined
      })
      const tabs = st.tabs.map((x) => (x.id === tabId ? unsplit(x) : x))
      if (t.rightWorkId || t.rightOnline) {
        const detached = makeTab({ workId: t.rightWorkId, online: t.rightOnline, scrollTop: t.rightScrollTop })
        const idx = tabs.findIndex((x) => x.id === tabId)
        tabs.splice(idx + 1, 0, detached)
      }
      return { tabs }
    }),

  swapSplitSides: (tabId) =>
    set((st) => ({
      tabs: st.tabs.map((t) => {
        if (t.id !== tabId || !(t.rightWorkId || t.rightOnline)) return t
        return {
          ...t,
          workId: t.rightWorkId ?? '',
          online: t.rightOnline,
          scrollTop: t.rightScrollTop ?? 0,
          rightWorkId: t.online ? '' : t.workId,
          rightOnline: t.online,
          rightScrollTop: t.scrollTop
        }
      })
    })),

  swapTabIntoSplit: (sourceId, side) =>
    set((st) => {
      const active = st.tabs.find((t) => t.id === st.activeTabId)
      const source = st.tabs.find((t) => t.id === sourceId)
      if (!active?.split || !source || active.id === sourceId) return {}
      const paneW = side === 'right' ? active.rightWorkId : active.workId
      const paneO = side === 'right' ? active.rightOnline : active.online
      const paneS = side === 'right' ? active.rightScrollTop : active.scrollTop
      const tabs = st.tabs.map((t) => {
        if (t.id === active.id) {
          if (side === 'right') {
            return { ...t, rightWorkId: source.online ? '' : source.workId, rightOnline: source.online, rightScrollTop: 0 }
          }
          return { ...t, workId: source.online ? '' : source.workId, online: source.online, scrollTop: 0 }
        }
        if (t.id === source.id) {
          // The standalone source tab now shows the displaced pane content.
          return {
            ...t,
            workId: paneO ? '' : paneW ?? '',
            online: paneO,
            scrollTop: paneS ?? 0,
            split: false,
            rightWorkId: undefined,
            rightOnline: undefined,
            rightScrollTop: undefined
          }
        }
        return t
      })
      return { tabs }
    }),

  closeSplitSide: (tabId, side) =>
    set((st) => {
      const t = st.tabs.find((x) => x.id === tabId)
      if (!t) return {}
      if (side === 'right') {
        return {
          tabs: st.tabs.map((x) =>
            x.id === tabId
              ? { ...x, split: false, rightWorkId: undefined, rightOnline: undefined, rightScrollTop: undefined }
              : x
          )
        }
      }
      // Closing the left pane: promote the right pane to be the sole work, or
      // close the whole tab if the right pane is empty.
      const hasRight = !!(t.rightWorkId || t.rightOnline)
      if (!hasRight) {
        // delegate to the normal close
        const idx = st.tabs.findIndex((x) => x.id === tabId)
        const tabs = st.tabs.filter((x) => x.id !== tabId)
        let activeTabId = st.activeTabId
        let view = st.view
        if (st.activeTabId === tabId) {
          const next = tabs[idx] ?? tabs[idx - 1]
          activeTabId = next?.id ?? null
          view = next ? 'reader' : 'home'
        }
        return { tabs, activeTabId, view }
      }
      return {
        tabs: st.tabs.map((x) =>
          x.id === tabId
            ? {
                ...x,
                workId: t.rightWorkId ?? '',
                online: t.rightOnline,
                scrollTop: t.rightScrollTop ?? 0,
                split: false,
                rightWorkId: undefined,
                rightOnline: undefined,
                rightScrollTop: undefined
              }
            : x
        )
      }
    }),

  setSplitRatio: (tabId, ratio) =>
    set((st) => ({
      tabs: st.tabs.map((t) =>
        t.id === tabId ? { ...t, splitRatio: Math.max(0.15, Math.min(0.85, ratio)) } : t
      )
    })),

  createTabGroup: (name) => {
    const id = 'tg' + Date.now().toString(36)
    const existing = get().tabGroups
    const color = TAB_GROUP_COLORS[existing.length % TAB_GROUP_COLORS.length]
    // Default name auto-numbers (새 그룹 1, 2, …) so groups are distinguishable.
    const used = existing.map((g) => Number(/^새 그룹 (\d+)$/.exec(g.name)?.[1] ?? 0))
    const n = Math.max(0, ...used) + 1
    set((st) => ({ tabGroups: [...st.tabGroups, { id, name: name?.trim() || `새 그룹 ${n}`, color }] }))
    return id
  },

  setTabGroup: (tabId, groupId) =>
    set((st) => {
      const tabs = st.tabs.map((t) => (t.id === tabId ? { ...t, groupId: groupId ?? undefined } : t))
      if (!groupId) return { tabs }
      // Keep group members contiguous: move the tab right after the last member.
      const moving = tabs.find((t) => t.id === tabId)
      if (!moving) return { tabs }
      const rest = tabs.filter((t) => t.id !== tabId)
      let lastIdx = -1
      rest.forEach((t, i) => {
        if (t.groupId === groupId) lastIdx = i
      })
      if (lastIdx < 0) return { tabs } // first member → leave in place
      rest.splice(lastIdx + 1, 0, moving)
      return { tabs: rest }
    }),

  renameTabGroup: (groupId, name) =>
    set((st) => ({
      tabGroups: st.tabGroups.map((g) => (g.id === groupId ? { ...g, name: name.trim() || g.name } : g))
    })),

  deleteTabGroup: (groupId) =>
    set((st) => ({
      tabGroups: st.tabGroups.filter((g) => g.id !== groupId),
      tabs: st.tabs.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t))
    })),

  setTabRightScroll: (tabId, scrollTop) =>
    set((st) => ({ tabs: st.tabs.map((t) => (t.id === tabId ? { ...t, rightScrollTop: scrollTop } : t)) })),

  closingTabs: [],
  requestCloseTab: (tabId) => {
    if (get().closingTabs.includes(tabId)) return
    const st = get()
    // Closing the active tab: switch content to the neighbor NOW so the reader
    // updates immediately, while the closing tab element collapses over the same
    // duration (content + tab finish together — Chrome-like).
    if (st.activeTabId === tabId) {
      const idx = st.tabs.findIndex((t) => t.id === tabId)
      const mode = st.tabs[idx]?.mode ?? 'hitomi'
      const sameMode = (t: Tab): boolean => (t.mode ?? 'hitomi') === mode && t.id !== tabId
      const next = st.tabs.slice(idx + 1).find(sameMode) ?? [...st.tabs.slice(0, idx)].reverse().find(sameMode)
      set({
        activeTabId: next?.id ?? null,
        libraryMode: mode,
        view: st.view === 'reader' ? (next ? 'reader' : 'home') : st.view
      })
    }
    set((s) => ({ closingTabs: [...s.closingTabs, tabId] }))
    setTimeout(() => {
      get().closeTab(tabId)
      set((s) => ({ closingTabs: s.closingTabs.filter((x) => x !== tabId) }))
    }, 180)
  },
  closeTab: (tabId) =>
    set((st) => {
      const idx = st.tabs.findIndex((t) => t.id === tabId)
      const closing = st.tabs[idx]
      const mode = closing?.mode ?? 'hitomi'
      const tabs = st.tabs.filter((t) => t.id !== tabId)
      // Remember it for Ctrl+Shift+T (most-recent-first, cap 15).
      const closedTabs = closing ? [closing, ...st.closedTabs].slice(0, 15) : st.closedTabs
      let activeTabId = st.activeTabId
      let view = st.view
      let libraryMode = st.libraryMode
      if (st.activeTabId === tabId) {
        // Pick the nearest remaining tab of the SAME library mode — hitomi and
        // general manga are separate, so closing the last normal tab must not
        // jump into a hitomi tab (and vice versa). None left → go home in that
        // mode instead of yanking into the other library.
        const sameMode = (t: Tab): boolean => (t.mode ?? 'hitomi') === mode
        const after = tabs.slice(idx).find(sameMode)
        const before = [...tabs.slice(0, idx)].reverse().find(sameMode)
        const next = after ?? before
        activeTabId = next?.id ?? null
        libraryMode = mode
        // Only switch the view when we're actually reading that tab. If the user
        // is on the online browse (or any non-reader) screen, closing a tab must
        // not yank them back to the library home.
        if (st.view === 'reader') view = next ? 'reader' : 'home'
      }
      return { tabs, activeTabId, view, libraryMode, closedTabs }
    }),

  reopenClosedTab: () =>
    guardLeave(get, set, () =>
      set((st) => {
        const [tab, ...rest] = st.closedTabs
        if (!tab) return {}
        const mode = tab.mode ?? 'hitomi'
        // If somehow still open, just re-focus it; otherwise re-add.
        const tabs = st.tabs.some((t) => t.id === tab.id) ? st.tabs : [...st.tabs, tab]
        return { tabs, closedTabs: rest, activeTabId: tab.id, view: 'reader', libraryMode: mode }
      })
    ),

  activateTab: (tabId) =>
    guardLeave(get, set, () =>
      set((st) => {
        const t = st.tabs.find((x) => x.id === tabId)
        return { activeTabId: tabId, view: 'reader', libraryMode: t?.mode ?? st.libraryMode }
      })
    ),

  openGlance: (src) =>
    set((st) => {
      const id = `glance${tabSeq++}`
      const mode: 'hitomi' | 'normal' =
        'online' in src ? (src.online.kind === 'toki' ? 'normal' : 'hitomi') : ((st.works.find((w) => w.id === src.workId)?.library ?? 'hitomi') as 'hitomi' | 'normal')
      const tab: Tab =
        'online' in src
          ? { id, workId: '', online: src.online, scrollTop: 0, mode, glance: true, ...inheritReader(st, mode) }
          : { id, workId: src.workId, scrollTop: 0, mode, glance: true, ...inheritReader(st, mode) }
      // Only one glance at a time — drop any previous peek tab.
      const tabs = [...st.tabs.filter((t) => !t.glance), tab]
      return { tabs, glanceTabId: id }
    }),
  closeGlance: () =>
    set((st) => ({ tabs: st.tabs.filter((t) => t.id !== st.glanceTabId), glanceTabId: null })),
  promoteGlance: () =>
    set((st) => {
      const g = st.tabs.find((t) => t.id === st.glanceTabId)
      if (!g) return { glanceTabId: null }
      return {
        tabs: st.tabs.map((t) => (t.id === g.id ? { ...t, glance: false } : t)),
        glanceTabId: null,
        activeTabId: g.id,
        view: 'reader',
        libraryMode: g.mode ?? st.libraryMode
      }
    }),
  setTabScroll: (tabId, scrollTop) =>
    set((st) => ({ tabs: st.tabs.map((t) => (t.id === tabId ? { ...t, scrollTop } : t)) })),

  setTabReader: (tabId, side, patch) =>
    set((st) => ({
      tabs: st.tabs.map((t) => {
        if (t.id !== tabId) return t
        if (side === 'right') {
          return {
            ...t,
            ...(patch.zoom !== undefined && { rightZoom: patch.zoom }),
            ...(patch.readerMode !== undefined && { rightReaderMode: patch.readerMode }),
            ...(patch.fit !== undefined && { rightFit: patch.fit })
          }
        }
        return {
          ...t,
          ...(patch.zoom !== undefined && { zoom: patch.zoom }),
          ...(patch.readerMode !== undefined && { readerMode: patch.readerMode }),
          ...(patch.fit !== undefined && { fit: patch.fit })
        }
      })
    })),

  restoreSession: (s) =>
    set((st) => {
      const modeOf = (id: string): 'hitomi' | 'normal' =>
        (st.works.find((w) => w.id === id)?.library ?? 'hitomi') as 'hitomi' | 'normal'
      const tabs: Tab[] = s.tabs.map((t) => ({
        id: t.id,
        workId: t.workId,
        scrollTop: t.scrollTop,
        mode: modeOf(t.workId)
      }))
      for (const t of tabs) {
        const n = parseInt(t.id.replace(/\D/g, ''), 10)
        if (n >= tabSeq) tabSeq = n + 1
      }
      const active = tabs.find((t) => t.id === s.activeTabId)
      return {
        tabs,
        activeTabId: active?.id ?? null,
        view: active ? 'reader' : 'home',
        libraryMode: active?.mode ?? st.libraryMode
      }
    }),

  setSearch: (search) => set({ search }),
  // Seed the home search input with a clicked tag (view→home so it's visible);
  // Home consumes the nonce and appends the token without auto-searching.
  addSearchToken: (tok) =>
    set((st) => ({
      view: 'home',
      searchSeed: { tok, nonce: (st.searchSeed?.nonce ?? 0) + 1 }
    })),
  setSort: (sort) => set({ sort }),
  toggleSortDir: () => set((st) => ({ sortDir: st.sortDir === 'asc' ? 'desc' : 'asc' })),
  setFavSort: (favSort) => set({ favSort }),
  setFilter: (filter) => set({ filter, view: 'home' }),
  reshuffle: () => set({ randomSeed: Math.random() }),
  setPopularRanks: (r) => set({ popularRanks: r }),
  setShowCoded: (b) => set({ showCoded: b }),
  setShowUncoded: (b) => set({ showUncoded: b }),
  setLangFilter: (cat, on) => set((st) => ({ langFilter: { ...st.langFilter, [cat]: on } })),
  setGroupFilter: (id, on) => set((st) => ({ groupFilter: { ...st.groupFilter, [id]: on } })),
  setShowUngrouped: (b) => set({ showUngrouped: b }),
  createGroup: async (name) => {
    const n = name.trim()
    if (!n) return null
    const id = 'g' + Date.now().toString(36)
    // Scope the group to the current library mode (hitomi vs general manga).
    const mode = get().libraryMode
    const s = { ...get().settings, groups: [...get().settings.groups, { id, name: n, mode }] }
    set({ settings: s })
    await window.api.saveSettings(s)
    return id
  },
  pushSearchHistory: async (q) => {
    const cur = get().settings
    if (!cur.searchHistoryEnabled) return
    const query = q.trim()
    if (!query) return
    const max = cur.searchHistoryMax || 20
    const searchHistory = [query, ...(cur.searchHistory ?? []).filter((x) => x !== query)].slice(0, max)
    const s = { ...cur, searchHistory }
    set({ settings: s })
    await window.api.saveSettings(s)
  },
  setSeriesTags: async (key, tags) => {
    const seriesTags = { ...(get().settings.seriesTags ?? {}) }
    if (tags.length) seriesTags[key] = tags
    else delete seriesTags[key]
    const s = { ...get().settings, seriesTags }
    set({ settings: s })
    await window.api.saveSettings(s)
  },
  deleteGroup: async (id) => {
    const { settings, works } = await window.api.deleteGroup(id)
    set((st) => {
      const groupFilter = { ...st.groupFilter }
      delete groupFilter[id]
      return { settings, works, groupFilter }
    })
  },
  pushDownloadProgress: (p) =>
    set((st) => {
      // Only download-flow events carry a gallery code; enrich emits code:''.
      if (!p.code) return {}
      const i = st.downloads.findIndex((d) => d.code === p.code)
      const prev = i >= 0 ? st.downloads[i] : null
      const item: DownloadItem = {
        code: p.code,
        title: p.title || prev?.title || p.code,
        done: p.done,
        total: p.total || prev?.total || 0,
        phase: p.phase,
        // Clear the old error once a fresh (re)start moves past the error state.
        error: p.message ?? (p.phase === 'error' ? prev?.error : undefined),
        spec: prev?.spec
      }
      const downloads =
        i >= 0
          ? st.downloads.map((d, j) => (j === i ? item : d))
          : [item, ...st.downloads]
      return { downloads }
    }),
  startDownload: async (spec) => {
    // No destination folder configured → surface a styled prompt (with a jump to
    // settings) instead of letting the download fail with a raw alert.
    const s = get().settings
    const destReady =
      spec.kind === 'hitomi'
        ? !!(s.downloadDir || s.libraryRoots[0])
        : !!(s.normalDownloadDir || s.normalFavoritesDir || s.normalRoots?.[0])
    if (!destReady) {
      set({ needDownloadDir: true })
      return null
    }
    const code = specCode(spec)
    // Seed/refresh the list entry immediately so it shows as 대기 중 and carries
    // the spec for later stop/retry. Progress events then drive the phase.
    set((st) => {
      const i = st.downloads.findIndex((d) => d.code === code)
      const prev = i >= 0 ? st.downloads[i] : null
      const item: DownloadItem = {
        code,
        title: ('title' in spec && spec.title) || prev?.title || code,
        done: 0,
        total: prev?.total ?? 0,
        phase: 'queued',
        spec
      }
      return {
        downloads: i >= 0 ? st.downloads.map((d, j) => (j === i ? item : d)) : [item, ...st.downloads]
      }
    })
    try {
      let works: Work[]
      if (spec.kind === 'hitomi') {
        works = [await window.api.hitomiDownload(spec.input)]
      } else if (spec.kind === 'toki') {
        works = spec.chapterUrls?.length
          ? await window.api.tokiDownloadChapters(spec.seriesUrl, spec.title, spec.chapterUrls)
          : await window.api.tokiDownload(spec.seriesUrl, spec.title)
      } else {
        works = await window.api.tokiDownloadGeneric(spec.title, spec.chapters, spec.only)
      }
      works.forEach((w) => get().addWork(w))
      // hitomi often ships avif only; if the user picked webp, convert the pages
      // right on THIS download's item (phase 'converting') — one row per work, no
      // separate job. (Pupil compatibility.)
      if (spec.kind === 'hitomi' && get().settings.downloadImageFormat === 'webp') {
        const patchItem = (p: Partial<DownloadItem>): void =>
          set((st) => ({ downloads: st.downloads.map((d) => (d.code === code ? { ...d, ...p } : d)) }))
        patchItem({ phase: 'converting', done: 0, total: 0 })
        try {
          for (const w of works) {
            await convertWorkToWebp(w.id, 0.92, (done, total) => patchItem({ done, total }))
          }
          patchItem({ phase: 'done' })
        } catch {
          // Conversion failed but the (avif) download itself is fine — mark done.
          patchItem({ phase: 'done' })
        }
      }
      return works
    } catch (e: any) {
      // Stopped by the user — not a failure; the 'stopped' progress event already
      // updated the item, so swallow it.
      if (String(e?.message ?? e).includes('DOWNLOAD_STOPPED')) return null
      throw e
    }
  },
  stopDownload: (code) => {
    void window.api.downloadStop(code)
  },
  retryDownload: (code) => {
    const item = get().downloads.find((d) => d.code === code)
    if (item?.spec) void get().startDownload(item.spec)
  },
  // Cancel + remove a download from the list (aborts first if it's still running).
  removeDownload: (code) => {
    const active = new Set(['queued', 'fetching', 'downloading', 'enriching', 'converting'])
    const item = get().downloads.find((d) => d.code === code)
    if (item && active.has(item.phase)) void window.api.downloadStop(code)
    set((st) => ({ downloads: st.downloads.filter((d) => d.code !== code) }))
  },
  stopAllDownloads: (mode) => {
    const active = new Set(['queued', 'fetching', 'downloading', 'enriching'])
    for (const d of get().downloads) {
      if (downloadMode(d.code) === mode && active.has(d.phase)) void window.api.downloadStop(d.code)
    }
  },
  startAllDownloads: (mode) => {
    for (const d of get().downloads) {
      if (downloadMode(d.code) === mode && (d.phase === 'stopped' || d.phase === 'error') && d.spec) {
        void get().startDownload(d.spec)
      }
    }
  },
  toggleActivity: (open) =>
    set((st) => ({ activityOpen: open === undefined ? !st.activityOpen : open })),
  setUpdate: (s) => set({ update: s }),
  installUpdate: () => window.api.installUpdate(),
  setNeedDownloadDir: (v) => set({ needDownloadDir: v }),
  setFavDownloadedOnly: (v) => set({ favDownloadedOnly: v }),
  setFavOnlineOnly: (v) => set({ favOnlineOnly: v }),
  setOnlineListFav: (v) => set({ onlineListFav: v }),
  clearDoneJobs: () =>
    set((st) => ({
      jobs: st.jobs.filter((j) => j.status === 'running'),
      // Finished downloads live in their own slice — drop those too so the bar clears.
      downloads: st.downloads.filter((d) => d.phase !== 'done' && d.phase !== 'error')
    })),
  startJob: (kind, mode, title, detail) => {
    const id = `${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`
    set((st) => ({
      jobs: [
        { id, kind, mode, title, status: 'running', done: 0, total: 0, detail, startedAt: Date.now() },
        ...st.jobs
      ]
    }))
    return id
  },
  updateJob: (id, patch) =>
    set((st) => ({ jobs: st.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
  endJob: (id, patch) =>
    set((st) => ({
      jobs: st.jobs.map((j) => (j.id === id ? { ...j, endedAt: Date.now(), ...patch } : j))
    })),
  exportWorkJob: async (workId, withTr) => {
    const work = get().works.find((w) => w.id === workId)
    if (!work) return
    const { startJob, updateJob, endJob } = get()
    const id = startJob('export', work.library ?? 'hitomi', `내보내기 · ${work.title}`, withTr ? '원문+번역' : '원문만')
    try {
      const path = await exportWorkText(work, withTr, (pr) => updateJob(id, { done: pr.page, total: pr.total }))
      endJob(id, { status: 'done', detail: path })
    } catch (e: any) {
      endJob(id, { status: 'error', error: String(e?.message ?? e) })
    }
  },
  exportImagesJob: async (workId) => {
    const work = get().works.find((w) => w.id === workId)
    if (!work) return
    const { startJob, updateJob, endJob } = get()
    const id = startJob('export', work.library ?? 'hitomi', `이미지 내보내기 · ${work.title}`, '번역 이미지')
    try {
      const dir = await exportWorkImages(work, (pr) => updateJob(id, { done: pr.page, total: pr.total }))
      endJob(id, { status: 'done', detail: dir })
    } catch (e: any) {
      endJob(id, { status: 'error', error: String(e?.message ?? e) })
    }
  },
  scanFolderJob: async (path, mode) => {
    const { startJob, endJob } = get()
    const id = startJob('scan', mode, `폴더 갱신 · ${path}`)
    try {
      const works = await window.api.scanFolder(path)
      set({ works })
      endJob(id, { status: 'done', detail: `${works.length}개` })
    } catch (e: any) {
      endJob(id, { status: 'error', error: String(e?.message ?? e) })
    }
  },
  // Full library scan (triggered from Settings). Rescans every root, then warms
  // thumbnails for the current library mode. Progress shows in the activity bar.
  scanLibraryJob: async () => {
    const { startJob, endJob, updateJob, libraryMode } = get()
    set({ loading: true })
    const jobId = startJob('scan', libraryMode, '라이브러리 갱신')
    let w: Work[] = []
    try {
      w = await window.api.scanLibrary()
      set({ works: w })
      endJob(jobId, { status: 'done', detail: `${w.length}개` })
    } catch (e: any) {
      endJob(jobId, { status: 'error', error: String(e?.message ?? e) })
    }
    set({ loading: false })
    const s = get().settings
    const normalRoots = [s.normalRoots, s.normalFavoritesDir, s.normalDownloadDir].flat().filter(Boolean) as string[]
    const ids = thumbTargetIds(w, libraryMode, normalRoots)
    if (ids.length) {
      const thumbJob = startJob('thumb', libraryMode, '썸네일 생성')
      updateJob(thumbJob, { total: ids.length })
      warmThumbs(ids, (done, total) => updateJob(thumbJob, { done, total }))
        .then(() => endJob(thumbJob, { status: 'done', detail: `${ids.length}개` }))
        .catch((e: any) => endJob(thumbJob, { status: 'error', error: String(e?.message ?? e) }))
    }
    // Auto-fill hitomi metadata for coded works.
    if (get().settings.autoEnrichOnScan && w.some((x) => x.code && !x.language)) {
      window.api.hitomiEnrichAll().then(() => window.api.getWorks().then((ws) => set({ works: ws })))
    }
    // Auto-move works into their genre rule's folder.
    if (get().settings.autoMoveByGenre && get().settings.genreRules.some((r) => r.genre && r.moveDir)) {
      const gjob = startJob('organize', libraryMode, '장르별 폴더 이동')
      window.api
        .organizeByGenre()
        .then((r) => {
          set({ works: r.works })
          endJob(gjob, { status: 'done', detail: `${r.moved}개 이동` })
        })
        .catch((e: any) => endJob(gjob, { status: 'error', error: String(e?.message ?? e) }))
    }
  },
  setListWidth: (px, persist) => {
    const w = Math.max(200, Math.min(700, px))
    set({ listWidth: w })
    if (persist) {
      const s = { ...get().settings, listPaneWidth: w }
      set({ settings: s })
      window.api.saveSettings(s)
    }
  },
  setNormalListWidth: (px, persist) => {
    const w = Math.max(160, Math.min(600, px))
    set({ normalListWidth: w })
    if (persist) {
      const s = { ...get().settings, normalListPaneWidth: w }
      set({ settings: s })
      window.api.saveSettings(s)
    }
  },
  setReaderMode: (m) => {
    set({ readerMode: m })
    const s = { ...get().settings, readerMode: m }
    set({ settings: s })
    window.api.saveSettings(s)
  },
  // Remember the last-used reader mode per library (hitomi/normal) and persist,
  // so a freshly opened tab restores that library's preferred view after a
  // restart or navigating home.
  setLastReaderMode: (lib, m) => {
    const cur = get().settings.lastReaderMode ?? { hitomi: 'scroll', normal: 'scroll' }
    if (cur[lib] === m) return
    const s = { ...get().settings, lastReaderMode: { ...cur, [lib]: m } }
    set({ settings: s })
    window.api.saveSettings(s)
  },
  // Persist the fit mode / free zoom per library (same pattern as reader mode).
  setLastFit: (lib, f) => {
    const cur = get().settings.lastFit ?? { hitomi: 'contain', normal: 'width' }
    if (cur[lib] === f) return
    const s = { ...get().settings, lastFit: { ...cur, [lib]: f } }
    set({ settings: s })
    window.api.saveSettings(s)
  },
  setLastZoom: (lib, z) => {
    const cur = get().settings.lastZoom ?? { hitomi: 1, normal: 1 }
    if (cur[lib] === z) return
    const s = { ...get().settings, lastZoom: { ...cur, [lib]: z } }
    set({ settings: s })
    window.api.saveSettings(s)
  },
  setHomeLayout: (l) => {
    set({ homeLayout: l })
    const s = { ...get().settings, homeLayout: l }
    set({ settings: s })
    window.api.saveSettings(s)
  },
  setBrowseSource: (s) => set({ browseSource: s }),
  searchOnline: (query) =>
    guardLeave(get, set, () =>
      set({
        view: 'browse',
        libraryMode: 'hitomi', // online browse is the hitomi gallery index
        browsePage: 0,
        browseSource: { kind: 'search', query, language: null, sort: 'date' }
      })
    ),
  searchLocal: (query) =>
    guardLeave(get, set, () => {
      set({ view: 'home', libraryMode: 'hitomi', activeTabId: null, filter: { kind: 'all' } })
      set({ search: query })
    }),
  addFavoriteTag: async (tag) => {
    const cur = get().settings
    const t = tag.trim()
    if (!t || cur.favoriteTags.includes(t)) return
    const s = { ...cur, favoriteTags: [...cur.favoriteTags, t] }
    set({ settings: s })
    await window.api.saveSettings(s)
  },
  setBrowsePage: (p) => set({ browsePage: p }),
  // Jump to general-manga online browse and run an author search for `name`.
  searchTokiAuthor: (name) =>
    set((st) => ({
      view: 'browse',
      libraryMode: 'normal',
      tokiAuthorSeed: { name, nonce: (st.tokiAuthorSeed?.nonce ?? 0) + 1 }
    })),
  setOnlineProgress: (code, p) =>
    set((st) => ({ onlineProgress: { ...st.onlineProgress, [code]: p } })),

  setOnlineFavs: (list) =>
    set({ onlineFavs: Object.fromEntries(list.map((f) => [f.code, f])) }),
  toggleOnlineFav: async (code, meta) => {
    const cur = get().onlineFavs[code]
    const fav = await window.api.setOnlineFav(code, { favorite: !cur?.favorite }, meta)
    set((st) => ({ onlineFavs: applyFav(st.onlineFavs, fav) }))
  },
  toggleUnifiedFav: async (code, meta) => {
    const st = get()
    const work = st.works.find((w) => w.code === code)
    const on = !!st.onlineFavs[code]?.favorite || !!work?.favorite
    const next = !on
    // Online favorite state.
    const fav = await window.api.setOnlineFav(code, { favorite: next }, meta)
    set((s) => ({ onlineFavs: applyFav(s.onlineFavs, fav) }))
    // Local favorite state (folder-as-truth: moves into/out of the favorites dir).
    if (work) get().upsertWork(await window.api.setFavorite(work.id, next))
  },
  toggleNormalUnifiedFav: async ({ title, localKey, url, meta }) => {
    const st = get()
    const k = titleKey(title)
    const s = st.settings
    const roots = [...(s.normalRoots ?? []), s.normalFavoritesDir].filter(Boolean) as string[]
    const localKeys = localKey
      ? [localKey]
      : k
        ? groupSeries(st.works.filter((w) => (w.library ?? 'hitomi') === 'normal'), roots)
            .filter((g) => titleKey(g.title) === k)
            .map((g) => g.key)
        : []
    const urls = new Set<string>(url ? [url] : [])
    if (k) {
      for (const f of Object.values(st.onlineFavs)) {
        if (/^https?:/.test(f.code) && titleKey(f.title) === k) urls.add(f.code)
      }
    }
    const favS = s.normalFavSeries ?? []
    const on = localKeys.some((x) => favS.includes(x)) || [...urls].some((u) => st.onlineFavs[u]?.favorite)
    const next = !on
    for (const x of localKeys) await get().toggleNormalFav('series', x, next)
    for (const u of urls) {
      const fav = await window.api.setOnlineFav(u, { favorite: next }, { title, ...meta })
      set((x) => ({ onlineFavs: applyFav(x.onlineFavs, fav) }))
    }
  },
  setOnlineRank: async (code, rank, meta) => {
    const fav = await window.api.setOnlineFav(code, { rank }, meta)
    set((st) => ({ onlineFavs: applyFav(st.onlineFavs, fav) }))
  }
}))

// Background thumbnail warm-up whenever the works list changes (boot, downloads,
// folder rescans, moves) — not only on a full library scan. Each id is checked
// once per session: existing thumbs just resolve from disk into the memory cache,
// missing ones are generated now instead of while the user scrolls.
const warmedIds = new Map<string, number>() // workId → pageCount when checked
let warmTimer: number | undefined
useStore.subscribe((st, prev) => {
  // Bulk cover regen → re-check every thumb (new raw covers get shrunk).
  if (st.thumbNonce !== prev.thumbNonce) warmedIds.clear()
  if (st.works === prev.works && st.settings === prev.settings && st.thumbNonce === prev.thumbNonce) return
  window.clearTimeout(warmTimer)
  warmTimer = window.setTimeout(() => {
    const { works, settings: s, startJob, updateJob, endJob } = useStore.getState()
    const normalRoots = [s.normalRoots, s.normalFavoritesDir, s.normalDownloadDir].flat().filter(Boolean) as string[]
    for (const mode of ['hitomi', 'normal'] as const) {
      // Keyed by page count too: a work registered mid-download (no images yet →
      // "no cover" cached) gets re-checked once its pages land, without a restart.
      const pc = new Map(works.map((w) => [w.id, w.pageCount]))
      const ids = thumbTargetIds(works, mode, normalRoots).filter((id) => warmedIds.get(id) !== pc.get(id))
      if (!ids.length) continue
      for (const id of ids) {
        if (warmedIds.has(id)) invalidateThumb(id) // pages changed → re-resolve
        warmedIds.set(id, pc.get(id) ?? 0)
      }
      // Small batches (a finished download) run silently; big ones show progress.
      const job = ids.length >= 20 ? startJob('thumb', mode, '썸네일 준비') : null
      if (job) updateJob(job, { total: ids.length })
      warmThumbs(ids, job ? (done, total) => updateJob(job, { done, total }) : undefined)
        .then(() => job && endJob(job, { status: 'done', detail: `${ids.length}개` }))
        .catch((e: any) => job && endJob(job, { status: 'error', error: String(e?.message ?? e) }))
    }
  }, 500)
})
