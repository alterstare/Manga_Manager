import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { selectWorks, SORT_LABELS, groupSeries, matchesSearch, tagTokens, tokenLabel, favListNames, matchesFavList, analyzeSeries, CHAP_FAV_PREFIX, FAV_BASE, titleKey, type SeriesGroup } from '../util'
import type { SortMode, Work, OnlineFav } from '../../../shared/types'
import { langCategory, LANG_CAT_LABELS, type LangCat } from '../../../shared/lang'
import Caret from './Caret'
import { SearchIcon, SyncIcon, GridIcon, MenuIcon, FavoriteIcon } from './icons'
import Dropdown from './Dropdown'
import WorkCard from './WorkCard'
import WorkGridCard from './WorkGridCard'
import SeriesCard from './SeriesCard'
import SeriesGridCard from './SeriesGridCard'
import OnlineFavCard from './OnlineFavCard'
import FavDlToggle from './FavDlToggle'
import TagSearchInput from './TagSearchInput'
import Pager from './Pager'
import ConfirmModal from './ConfirmModal'

export default function Home(): JSX.Element {
  const works = useStore((s) => s.works)
  const libraryMode = useStore((s) => s.libraryMode)
  const settings = useStore((s) => s.settings)
  const search = useStore((s) => s.search)
  const sort = useStore((s) => s.sort)
  const sortDir = useStore((s) => s.sortDir)
  const toggleSortDir = useStore((s) => s.toggleSortDir)
  const filter = useStore((s) => s.filter)
  const seed = useStore((s) => s.randomSeed)
  const loading = useStore((s) => s.loading)
  const setSearch = useStore((s) => s.setSearch)
  const setSort = useStore((s) => s.setSort)
  const setFilter = useStore((s) => s.setFilter)
  const reshuffle = useStore((s) => s.reshuffle)
  const homeLayout = useStore((s) => s.homeLayout)
  const setHomeLayout = useStore((s) => s.setHomeLayout)
  const onlineFavs = useStore((s) => s.onlineFavs)
  const favDownloadedOnly = useStore((s) => s.favDownloadedOnly)
  const setFavDownloadedOnly = useStore((s) => s.setFavDownloadedOnly)
  const popularRanks = useStore((s) => s.popularRanks)
  const setPopularRanks = useStore((s) => s.setPopularRanks)
  const showCoded = useStore((s) => s.showCoded)
  const showUncoded = useStore((s) => s.showUncoded)
  const setShowCoded = useStore((s) => s.setShowCoded)
  const setShowUncoded = useStore((s) => s.setShowUncoded)
  const langFilter = useStore((s) => s.langFilter)
  const setLangFilter = useStore((s) => s.setLangFilter)
  const groups = useStore((s) => s.settings.groups)
  const groupFilter = useStore((s) => s.groupFilter)
  const showUngrouped = useStore((s) => s.showUngrouped)
  const setGroupFilter = useStore((s) => s.setGroupFilter)
  const setShowUngrouped = useStore((s) => s.setShowUngrouped)
  const createGroup = useStore((s) => s.createGroup)
  const deleteGroup = useStore((s) => s.deleteGroup)
  const homeTopNonce = useStore((s) => s.homeTopNonce)
  const scrollRef = useRef<HTMLDivElement>(null)
  const mountNonce = useRef(homeTopNonce)
  const [delGroup, setDelGroup] = useState<{ id: string; name: string } | null>(null)

  // Restore the previous home scroll position on mount; save it continuously so
  // returning to the library lands where the user left off. 홈 pressed while
  // already home bumps homeTopNonce → jump to the top (but not on mount).
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = useStore.getState().homeScroll
  }, [])
  useEffect(() => {
    if (homeTopNonce === mountNonce.current) return
    // Returning to the initial screen (홈 pressed while already home): clear the
    // search + tag/artist filter, but KEEP the chosen sort. Then first page/top.
    setQuery('')
    setSearch('')
    setFilter({ kind: 'all' })
    setPage(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeTopNonce])

  const [progress, setProgress] = useState<{ scanned: number; current: string } | null>(null)
  const [organizeProg, setOrganizeProg] = useState<{ moved: number; current: string } | null>(null)
  const [enrichProg, setEnrichProg] = useState<{ done: number; total: number } | null>(null)
  const [query, setQuery] = useState(search) // pending search text (applied on Enter/button)
  // Individual chips for the active search's tokens (comma-separated), shown above
  // the list. Removing a chip re-runs the search without it.
  const searchTokens = search.split(',').map((s) => s.trim()).filter(Boolean)
  const removeSearchToken = (tok: string): void => {
    const q = searchTokens.filter((t) => t !== tok).join(', ')
    setQuery(q)
    setSearch(q)
  }
  // A tag clicked on a work card is appended to the search box (not searched
  // immediately), like the online browse. Consumes the store seed on change.
  const searchSeed = useStore((s) => s.searchSeed)
  useEffect(() => {
    if (!searchSeed) return
    setQuery((cur) => {
      const toks = cur.split(',').map((s) => s.trim()).filter(Boolean)
      return toks.includes(searchSeed.tok) ? cur : [...toks, searchSeed.tok].join(', ') + ', '
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchSeed?.nonce])
  // Only one classification panel (작품/언어/그룹 분류) open at a time — opening
  // one collapses whichever was open.
  const [openPanel, setOpenPanel] = useState<'cat' | 'lang' | 'group' | 'fav' | null>(null)
  const togglePanel = (p: 'cat' | 'lang' | 'group' | 'fav'): void =>
    setOpenPanel((cur) => (cur === p ? null : p))
  // Favorite lists the user has UNchecked in the drawer (all checked by default).
  const [favUnchecked, setFavUnchecked] = useState<string[]>([])
  // Favorites-view sort (mirrors the online favorites): 평점 높은순 / 최근 추가순.
  // Lives in the store so it survives Home unmount/remount (opening a work).
  const favSort = useStore((s) => s.favSort)
  const setFavSort = useStore((s) => s.setFavSort)
  const [newGroup, setNewGroup] = useState('')
  const [loadingPopular, setLoadingPopular] = useState(false)

  // Load site popularity ranks the first time the user sorts by 인기순.
  useEffect(() => {
    if (sort !== 'popular' || popularRanks) return
    const codes = works.filter((w) => w.code).map((w) => w.code!)
    if (!codes.length) return
    setLoadingPopular(true)
    window.api
      .hitomiPopularRanks(codes)
      .then(setPopularRanks)
      .finally(() => setLoadingPopular(false))
  }, [sort, popularRanks, works])

  useEffect(() => {
    return window.api.onScanProgress((p) => {
      if (p.done) setProgress(null)
      else setProgress({ scanned: p.scanned, current: p.current })
    })
  }, [])

  useEffect(() => {
    return window.api.onOrganizeProgress((p) => {
      if (p.done) setOrganizeProg(null)
      else setOrganizeProg({ moved: p.moved, current: p.current })
    })
  }, [])

  useEffect(() => {
    return window.api.onHitomiProgress((p) => {
      if (p.phase === 'enriching') setEnrichProg({ done: p.done, total: p.total })
      else if (p.phase === 'done') setEnrichProg(null)
    })
  }, [])

  // Only the current library's works (hitomi vs general manga).
  const modeWorks = useMemo(
    () => works.filter((w) => (w.library ?? 'hitomi') === libraryMode),
    [works, libraryMode]
  )
  // Tag autocomplete for the search box (replaces the old tag-builder row).
  const libTokens = useMemo(() => tagTokens(modeWorks), [modeWorks])

  // Groups are scoped per library mode.
  const modeGroups = useMemo(
    () => groups.filter((g) => (g.mode ?? 'hitomi') === libraryMode),
    [groups, libraryMode]
  )

  // Category filter: choose whether coded / uncoded works appear, and which
  // languages. Works with unknown (null) language always pass the language gate.
  const allLang = langFilter.korean && langFilter.english && langFilter.japanese && langFilter.other
  const allGroups = modeGroups.every((g) => groupFilter[g.id] !== false) && showUngrouped
  const categoryWorks = useMemo(
    () =>
      modeWorks.filter((w) => {
        // Normal mode hides the coded/language chips → don't let their state filter.
        if (libraryMode !== 'normal') {
          if (!(w.code ? showCoded : showUncoded)) return false
          const lc = langCategory(w.language)
          if (lc !== null && !langFilter[lc]) return false
        }
        const gids = w.groups ?? []
        if (gids.length === 0) return showUngrouped
        return gids.some((id) => groupFilter[id] !== false)
      }),
    [modeWorks, showCoded, showUncoded, langFilter, groupFilter, showUngrouped, libraryMode]
  )

  const favActive = filter.kind === 'favorites' || filter.kind === 'favlists'
  // General-manga: online (toki) favorites by normalized title — a local series
  // with the same title is the same favorite (one unified list).
  const onlineNormalFavKeys = useMemo(
    () =>
      new Set(
        Object.values(onlineFavs)
          .filter((f) => f.favorite && /^https?:/.test(f.code))
          .map((f) => titleKey(f.title))
          .filter(Boolean)
      ),
    [onlineFavs]
  )
  const list = useMemo(() => {
    // In the favorites view, the dedicated 평점/최근 sort overrides the main sort.
    const effSort = favActive ? (favSort === 'rank' ? 'rank' : 'recent') : sort
    let base = selectWorks(
      categoryWorks,
      search,
      filter,
      effSort,
      seed,
      settings.ignoreBracketTagsInSort,
      popularRanks ?? undefined
    )
    // Unified favorites: also include downloaded works that are ONLINE favorites
    // even if they were never hearted locally (so a fav is a fav everywhere).
    if (favActive && filter.kind === 'favorites') {
      const onlineCodes = new Set(
        Object.values(onlineFavs)
          .filter((f) => f.favorite && !/^https?:/.test(f.code))
          .map((f) => f.code)
      )
      const have = new Set(base.map((w) => w.id))
      const extra = categoryWorks.filter((w) => w.code && onlineCodes.has(w.code) && !have.has(w.id))
      if (extra.length) base = [...base, ...extra]
    }
    if (favActive || sortDir !== 'asc') return base
    const r = [...base].reverse()
    // Keep artist-less works last regardless of direction.
    if (sort === 'artist') return [...r.filter((w) => w.artist?.trim()), ...r.filter((w) => !w.artist?.trim())]
    return r
  }, [categoryWorks, search, filter, favActive, favSort, sort, sortDir, seed, settings.ignoreBracketTagsInSort, popularRanks, onlineFavs])

  // Normal mode: collapse chapters into one entry per series.
  const normal = libraryMode === 'normal'
  const normalRoots = useMemo(
    () => [...(settings.normalRoots ?? []), settings.normalFavoritesDir].filter(Boolean) as string[],
    [settings.normalRoots, settings.normalFavoritesDir]
  )
  // Whole-mode series count (ignores the fav filter) for the 전체 chip.
  const seriesTotal = useMemo(
    () => (normal ? groupSeries(modeWorks, normalRoots).length : 0),
    [normal, modeWorks, normalRoots]
  )
  const seriesList = useMemo(() => {
    if (!normal) return []
    let arr = groupSeries(categoryWorks, normalRoots)
    const q = search.trim()
    if (q) {
      const ql = q.toLowerCase()
      arr = arr.filter((s) => s.title.toLowerCase().includes(ql) || s.chapters.some((c) => matchesSearch(c, q)))
    }
    // Favorites view (normal): in-app favorites — favorited SERIES as their group,
    // plus chapters favorited on their own as single-chapter entries that open the
    // chapter directly. No dependence on the folder-move/favlist system.
    if (favActive) {
      const favS = settings.normalFavSeries ?? []
      const favC = settings.normalFavChapters ?? []
      const favGroups = arr.filter((s) => favS.includes(s.key) || onlineNormalFavKeys.has(titleKey(s.title)))
      const covered = new Set(favGroups.flatMap((s) => s.chapters.map((c) => c.id)))
      const chapEntries: SeriesGroup[] = []
      for (const s of arr) {
        if (favGroups.includes(s)) continue
        const infos = analyzeSeries(s.chapters, s.title, settings.normalChapterScheme)
        for (const ci of infos) {
          if (!favC.includes(ci.work.id) || covered.has(ci.work.id)) continue
          covered.add(ci.work.id)
          chapEntries.push({
            key: CHAP_FAV_PREFIX + ci.work.id,
            title: `${s.title} · ${ci.label}`,
            chapters: [ci.work]
          })
        }
      }
      arr = [...favGroups, ...chapEntries]
    }
    const recentOf = (s: (typeof arr)[number]): number => Math.max(...s.chapters.map((c) => c.mtime))
    const viewedOf = (s: (typeof arr)[number]): number =>
      Math.max(0, ...s.chapters.map((c) => c.lastViewedAt ?? 0))
    const sumViews = (s: (typeof arr)[number]): number => s.chapters.reduce((n, c) => n + c.viewCount, 0)
    const maxRank = (s: (typeof arr)[number]): number => Math.max(0, ...s.chapters.map((c) => c.rank))
    if (sort === 'recent') arr = [...arr].sort((a, b) => recentOf(b) - recentOf(a))
    else if (sort === 'viewed') arr = [...arr].sort((a, b) => viewedOf(b) - viewedOf(a))
    else if (sort === 'title')
      arr = [...arr].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))
    else if (sort === 'views') arr = [...arr].sort((a, b) => sumViews(b) - sumViews(a))
    else if (sort === 'rank') arr = [...arr].sort((a, b) => maxRank(b) - maxRank(a))
    else if (sort === 'artist') {
      const artistOf = (s: (typeof arr)[number]): string => s.chapters.find((c) => c.artist)?.artist?.trim() ?? ''
      arr = [...arr].sort((a, b) => {
        const ka = artistOf(a)
        const kb = artistOf(b)
        if (!ka && !kb) return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
        if (!ka) return 1
        if (!kb) return -1
        return ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' })
      })
    }
    // random / popular → natural order
    if (sortDir === 'asc') {
      arr = [...arr].reverse()
      if (sort === 'artist') {
        const has = (s: (typeof arr)[number]): boolean => !!s.chapters.find((c) => c.artist)?.artist?.trim()
        arr = [...arr.filter(has), ...arr.filter((s) => !has(s))]
      }
    }
    return arr
  }, [
    normal,
    categoryWorks,
    normalRoots,
    favActive,
    search,
    sort,
    sortDir,
    settings.normalChapterScheme,
    settings.normalFavSeries,
    settings.normalFavChapters,
    onlineNormalFavKeys
  ])

  // Unified favorites: in the favorites view, online favorites that aren't already
  // downloaded appear as online cards after the local cards. "받음" toggle hides
  // them. Per mode: hitomi = numeric codes, general-manga = http (toki) codes.
  // Title keys of every local general-manga series (downloaded), to dedupe online
  // favorites that are already in the library.
  const localSeriesKeys = useMemo(
    () => (normal ? new Set(groupSeries(modeWorks, normalRoots).map((g) => titleKey(g.title))) : new Set<string>()),
    [normal, modeWorks, normalRoots]
  )
  const onlineOnlyFavs = useMemo(() => {
    if (!favActive || favDownloadedOnly) return []
    const libCodes = new Set(works.map((w) => w.code).filter(Boolean) as string[])
    return Object.values(onlineFavs)
      .filter(
        (f) =>
          f.favorite &&
          /^https?:/.test(f.code) === normal &&
          !libCodes.has(f.code) &&
          !(normal && localSeriesKeys.has(titleKey(f.title)))
      )
      .sort((a, b) => (favSort === 'rank' ? b.rank - a.rank || b.addedAt - a.addedAt : b.addedAt - a.addedAt))
  }, [favActive, favDownloadedOnly, onlineFavs, works, normal, favSort, localSeriesKeys])
  // One merged favorites list (local works / series + online-only), sorted together
  // by when each was favorited (최근 추가순) or by rating (평점 높은순), then paged.
  type FavEntry =
    | { kind: 'local'; work: Work; t: number; r: number }
    | { kind: 'series'; series: SeriesGroup; t: number; r: number }
    | { kind: 'online'; fav: OnlineFav; t: number; r: number }
  const favMerged = useMemo<FavEntry[] | null>(() => {
    if (!favActive) return null
    const arr: FavEntry[] = []
    if (!normal) {
      for (const w of list) {
        const of = w.code ? onlineFavs[w.code] : undefined
        arr.push({ kind: 'local', work: w, t: of?.addedAt ?? w.favoritedAt ?? 0, r: Math.max(w.rank, of?.rank ?? 0) })
      }
    } else {
      const at = settings.normalFavAt ?? {}
      const byTitle = new Map<string, OnlineFav>()
      for (const f of Object.values(onlineFavs))
        if (f.favorite && /^https?:/.test(f.code)) byTitle.set(titleKey(f.title), f)
      for (const sg of seriesList) {
        const key = sg.key.startsWith(CHAP_FAV_PREFIX) ? sg.key.slice(CHAP_FAV_PREFIX.length) : sg.key
        const of = byTitle.get(titleKey(sg.title))
        const r = Math.max(0, ...sg.chapters.map((c) => c.rank), of?.rank ?? 0)
        arr.push({ kind: 'series', series: sg, t: at[key] ?? of?.addedAt ?? 0, r })
      }
    }
    for (const f of onlineOnlyFavs) arr.push({ kind: 'online', fav: f, t: f.addedAt, r: f.rank })
    arr.sort((a, b) => (favSort === 'rank' ? b.r - a.r || b.t - a.t : b.t - a.t))
    return arr
  }, [favActive, normal, list, seriesList, onlineOnlyFavs, onlineFavs, favSort, settings.normalFavAt])

  const pageSize = settings.pageSize || 50
  const [page, setPage] = useState(() => useStore.getState().homePage)
  const total = favMerged ? favMerged.length : normal ? seriesList.length : list.length
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1)
  // Persist the current page so returning to home restores it (with the scroll).
  useEffect(() => useStore.getState().setHomePage(page), [page])
  // Any list-level action (search / filter chip / sort / mode switch / layout /
  // page move) collapses an open classification panel. Panel-internal toggles
  // (language/coded/group checkboxes) aren't in the deps, so adjusting them keeps
  // the panel open.
  useEffect(() => {
    setOpenPanel(null)
  }, [search, filter, sort, libraryMode, homeLayout, page])
  // Click anywhere outside a classification panel (empty space or any other
  // control) collapses it. Clicks inside the panel/its chip stay open, so
  // adjusting the checkboxes doesn't dismiss it.
  useEffect(() => {
    if (!openPanel) return
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.cat-wrap')) setOpenPanel(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openPanel])
  // Reset to first page (top) only when the user changes the query/filter/sort —
  // never on mount/remount, and never when works count changes (delete/scan), so
  // the scroll+page stay put. Keyed on the filter signature; a ref guards the
  // first run and StrictMode's double-invoke, both of which see an unchanged key.
  const resetKey = JSON.stringify([search, filter, sort, seed, libraryMode])
  const prevKey = useRef<string | null>(null)
  useEffect(() => {
    if (prevKey.current === null || prevKey.current === resetKey) {
      prevKey.current = resetKey
      return
    }
    prevKey.current = resetKey
    setPage(0)
    useStore.getState().setHomeScroll(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [resetKey])
  // Clamp a restored page that no longer exists (data shrank while away).
  useEffect(() => {
    if (page > lastPage) setPage(lastPage)
  }, [lastPage, page])
  const pageItems = useMemo(
    () => list.slice(page * pageSize, page * pageSize + pageSize),
    [list, page, pageSize]
  )
  const pageFav = useMemo(
    () => (favMerged ? favMerged.slice(page * pageSize, page * pageSize + pageSize) : null),
    [favMerged, page, pageSize]
  )
  const pageSeries = useMemo(
    () => seriesList.slice(page * pageSize, page * pageSize + pageSize),
    [seriesList, page, pageSize]
  )

  const artistCount = useMemo(
    () => new Set(modeWorks.map((w) => w.artist).filter(Boolean)).size,
    [modeWorks]
  )
  // Persisted list names (settings) unioned with any present on works.
  const favLists = useMemo(() => {
    // Imported favlist names (settings.favLists) are a hitomi-only feature, so
    // don't leak them into the general-manga (normal) drawer. Normal mode only
    // shows lists actually present on its own works.
    const imported = libraryMode === 'hitomi' ? (settings.favLists ?? []) : []
    return [...new Set([...imported, ...favListNames(modeWorks)])].sort((a, b) => a.localeCompare(b))
  }, [settings.favLists, modeWorks, libraryMode])
  // All selectable favorite lists (기본 + imported). The drawer defaults to ALL
  // checked; `favUnchecked` tracks the ones the user explicitly turned off, so a
  // newly-imported list shows up checked automatically.
  const allFavNames = useMemo(() => [FAV_BASE, ...favLists], [favLists])
  const favSelected = useMemo(
    () => allFavNames.filter((n) => !favUnchecked.includes(n)),
    [allFavNames, favUnchecked]
  )
  // Count reflects the checked selection (updates as lists are toggled). Normal
  // mode counts its in-app favorites (series + standalone chapters) instead.
  // Unified favorite count: local + online favorites, each favorite counted once.
  const favCount = useMemo(() => {
    if (normal) {
      const favS = settings.normalFavSeries ?? []
      const keys = new Set(onlineNormalFavKeys)
      for (const g of groupSeries(modeWorks, normalRoots)) if (favS.includes(g.key)) keys.add(titleKey(g.title))
      return keys.size + (settings.normalFavChapters?.length ?? 0)
    }
    const ids = new Set<string>()
    for (const w of modeWorks) if (favSelected.some((n) => matchesFavList(w, n))) ids.add(w.code ?? w.id)
    for (const f of Object.values(onlineFavs)) if (f.favorite && !/^https?:/.test(f.code)) ids.add(f.code)
    return ids.size
  }, [normal, modeWorks, normalRoots, favSelected, onlineFavs, onlineNormalFavKeys, settings.normalFavSeries, settings.normalFavChapters])
  const groupCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const w of modeWorks) for (const id of w.groups ?? []) m[id] = (m[id] ?? 0) + 1
    return m
  }, [modeWorks])

  return (
    <div
      className="home"
      ref={scrollRef}
      onScroll={(e) => useStore.getState().setHomeScroll(e.currentTarget.scrollTop)}
      style={{ ['--mw' as string]: `${settings.marginWidth}px` }}
    >
      <div className="home-head">
        <div className="badge">{libraryMode === 'normal' ? 'Manga & Webtoon' : 'Doujinshi'}</div>
        <h1>라이브러리 탐색</h1>

        <div className="search-row">
          <Dropdown<SortMode>
            className="field"
            value={sort}
            onChange={setSort}
            options={(Object.keys(SORT_LABELS) as SortMode[])
              .filter((m) => !(normal && m === 'popular'))
              .map((m) => [m, SORT_LABELS[m]])}
          />
          <TagSearchInput
            value={query}
            onChange={setQuery}
            onEnter={() => setSearch(query.trim())}
            tokens={libTokens}
            placeholder={normal ? '시리즈 제목·태그 검색 후 Enter' : '제목, 코드, 태그, artist:작가명 / tag:태그명 으로 검색 후 Enter'}
          />
          <button className="btn primary" onClick={() => setSearch(query.trim())} title="검색">
            <SearchIcon />
          </button>
          {sort === 'random' && (
            <button className="btn" onClick={reshuffle} title="무작위 다시 섞기">
              <SyncIcon />
            </button>
          )}
        </div>

        <div className="chips">
          <button
            className="chip layout-toggle"
            onClick={() => setHomeLayout(homeLayout === 'grid' ? 'list' : 'grid')}
            title={homeLayout === 'grid' ? '격자형' : '목록형'}
          >
            {homeLayout === 'grid' ? <GridIcon /> : <MenuIcon />}
          </button>
          <button
            className="chip layout-toggle"
            onClick={toggleSortDir}
            title={sortDir === 'asc' ? '오름차순' : '내림차순'}
          >
            <Caret up={sortDir === 'asc'} />
          </button>
          <Chip active={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>
            전체 {normal ? seriesTotal : modeWorks.length}
          </Chip>
          <div className="cat-wrap">
            <span
              className={`chip fav-chip ${filter.kind === 'favorites' || filter.kind === 'favlists' ? 'active' : ''}`}
            >
              <span
                className="fav-label"
                onClick={() => {
                  // Show everything: re-check all lists.
                  setFavUnchecked([])
                  setFilter({ kind: 'favorites' })
                }}
              >
                <FavoriteIcon filled className="fav-ico" /> 즐겨찾기 {favCount}
              </span>
              <span className="fav-caret" onClick={() => togglePanel('fav')} title="즐겨찾기 목록">
                <span className={`dt ${openPanel === 'fav' ? 'up' : ''}`} />
              </span>
            </span>
            {openPanel === 'fav' && (
              <div className="cat-panel">
                {allFavNames.map((n) => (
                  <label key={n}>
                    <input
                      type="checkbox"
                      checked={!favUnchecked.includes(n)}
                      onChange={() => {
                        const nextUnchecked = favUnchecked.includes(n)
                          ? favUnchecked.filter((x) => x !== n)
                          : [...favUnchecked, n]
                        setFavUnchecked(nextUnchecked)
                        const sel = allFavNames.filter((x) => !nextUnchecked.includes(x))
                        // All checked → plain 'favorites' (also drives normal mode);
                        // a subset (incl. none) → 'favlists' so unchecked lists hide.
                        setFilter(
                          sel.length === allFavNames.length
                            ? { kind: 'favorites' }
                            : { kind: 'favlists', value: sel }
                        )
                      }}
                    />
                    ★ {n}
                  </label>
                ))}
              </div>
            )}
          </div>
          {favActive && (
            <FavDlToggle
              checked={favDownloadedOnly}
              onChange={setFavDownloadedOnly}
              onTitle="다운로드한 즐겨찾기만 보는 중"
              offTitle="모든 즐겨찾기 보는 중"
            />
          )}
          {favActive && (
            <Dropdown<'rank' | 'recent'>
              className="field sm"
              value={favSort}
              onChange={setFavSort}
              options={[
                ['rank', '평점 높은순'],
                ['recent', '최근 추가순']
              ]}
            />
          )}
          {!normal && <span className="chip-stat">작가 {artistCount}</span>}

          {!normal && (
          <>
          <div className="cat-wrap">
            <button
              className={`chip ${!(showCoded && showUncoded) ? 'active' : ''}`}
              onClick={() => togglePanel('cat')}
            >
              작품 분류 <span className={`dt ${openPanel === 'cat' ? 'up' : ''}`} />
            </button>
            {openPanel === 'cat' && (
              <div className="cat-panel">
                <label>
                  <input type="checkbox" checked={showCoded} onChange={(e) => setShowCoded(e.target.checked)} />
                  hitomi 번호 작품
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showUncoded}
                    onChange={(e) => setShowUncoded(e.target.checked)}
                  />
                  번호 없는 작품
                </label>
              </div>
            )}
          </div>

          <div className="cat-wrap">
            <button
              className={`chip ${!allLang ? 'active' : ''}`}
              onClick={() => togglePanel('lang')}
            >
              언어 분류 <span className={`dt ${openPanel === 'lang' ? 'up' : ''}`} />
            </button>
            {openPanel === 'lang' && (
              <div className="cat-panel">
                {(['korean', 'english', 'japanese', 'other'] as LangCat[]).map((c) => (
                  <label key={c}>
                    <input
                      type="checkbox"
                      checked={langFilter[c]}
                      onChange={(e) => setLangFilter(c, e.target.checked)}
                    />
                    {LANG_CAT_LABELS[c]}
                  </label>
                ))}
              </div>
            )}
          </div>
          </>
          )}

          <div className="cat-wrap">
            <button className={`chip ${!allGroups ? 'active' : ''}`} onClick={() => togglePanel('group')}>
              그룹 분류 <span className={`dt ${openPanel === 'group' ? 'up' : ''}`} />
            </button>
            {openPanel === 'group' && (
              <div className="cat-panel">
                {modeGroups.map((g) => (
                  <label key={g.id} className="grp-row">
                    <input
                      type="checkbox"
                      checked={groupFilter[g.id] !== false}
                      onChange={(e) => setGroupFilter(g.id, e.target.checked)}
                    />
                    <span className="grp-row-name">
                      {g.name}
                    </span>
                    <span className="grp-row-count">({groupCounts[g.id] ?? 0})</span>
                    <span
                      className="grp-row-x"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setDelGroup({ id: g.id, name: g.name })
                      }}
                    >
                      ×
                    </span>
                  </label>
                ))}
                <label>
                  <input
                    type="checkbox"
                    checked={showUngrouped}
                    onChange={(e) => setShowUngrouped(e.target.checked)}
                  />
                  그룹 없음
                </label>
                <div className="grp-create">
                  <input
                    value={newGroup}
                    placeholder="새 그룹 이름"
                    onChange={(e) => setNewGroup(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && newGroup.trim()) {
                        await createGroup(newGroup)
                        setNewGroup('')
                      }
                    }}
                  />
                  <button
                    className="mini"
                    onClick={async () => {
                      if (newGroup.trim()) {
                        await createGroup(newGroup)
                        setNewGroup('')
                      }
                    }}
                  >
                    + 그룹 생성
                  </button>
                </div>
              </div>
            )}
          </div>
          {sort === 'popular' && loadingPopular && <span className="chip-stat">인기순 불러오는 중…</span>}
          {filter.kind === 'artist' && (
            <Chip active onClick={() => setFilter({ kind: 'all' })}>
              작가: {filter.value} ✕
            </Chip>
          )}
          {filter.kind === 'tag' && (
            <Chip active onClick={() => setFilter({ kind: 'all' })}>
              태그: {filter.value} ✕
            </Chip>
          )}
        </div>

        {searchTokens.length > 0 && (
          <div className="search-chips">
            {searchTokens.map((tok) => (
              <button
                key={tok}
                className="chip active search-tok"
                title="검색에서 제거"
                onClick={() => removeSearchToken(tok)}
              >
                {tokenLabel(tok)} ✕
              </button>
            ))}
          </div>
        )}

        {progress && (
          <div className="scan-progress">
            스캔 중… {progress.scanned}개 · {progress.current}
          </div>
        )}
        {enrichProg && (
          <div className="scan-progress">
            메타 채우는 중… {enrichProg.done}/{enrichProg.total}
          </div>
        )}
        {organizeProg && (
          <div className="scan-progress">
            언어 정리 중… {organizeProg.moved}개 이동 · {organizeProg.current}
          </div>
        )}
      </div>

      {modeWorks.length === 0 && !loading && (
        <div className="empty">
          {libraryMode === 'normal' ? (
            <>
              일반 만화 라이브러리가 비어 있습니다. <b>설정 ⚙</b>에서 <b>일반 만화 폴더</b>를 추가하고{' '}
              <b>라이브러리 스캔</b>을 누르세요.
            </>
          ) : (
            <>
              라이브러리가 비어 있습니다. <b>설정 ⚙</b>에서 폴더를 추가하고 <b>라이브러리 스캔</b>을
              누르세요.
            </>
          )}
        </div>
      )}

      {pageFav ? (
        // Unified favorites: local / series / online cards interleaved in one order.
        <div className={homeLayout === 'grid' ? 'work-grid' : normal ? 'series-list' : 'work-list'}>
          {pageFav.map((e) =>
            e.kind === 'local' ? (
              homeLayout === 'grid' ? <WorkGridCard key={e.work.id} work={e.work} /> : <WorkCard key={e.work.id} work={e.work} />
            ) : e.kind === 'series' ? (
              homeLayout === 'grid' ? <SeriesGridCard key={e.series.key} series={e.series} /> : <SeriesCard key={e.series.key} series={e.series} />
            ) : (
              <OnlineFavCard key={e.fav.code} fav={e.fav} layout={homeLayout === 'grid' ? 'grid' : 'list'} />
            )
          )}
        </div>
      ) : normal ? (
        homeLayout === 'grid' ? (
          <div className="work-grid">
            {pageSeries.map((s) => (
              <SeriesGridCard key={s.key} series={s} />
            ))}
          </div>
        ) : (
          <div className="series-list">
            {pageSeries.map((s) => (
              <SeriesCard key={s.key} series={s} />
            ))}
          </div>
        )
      ) : homeLayout === 'grid' ? (
        <div className="work-grid">
          {pageItems.map((w) => (
            <WorkGridCard key={w.id} work={w} />
          ))}
        </div>
      ) : (
        <div className="work-list">
          {pageItems.map((w) => (
            <WorkCard key={w.id} work={w} />
          ))}
        </div>
      )}

      {total > pageSize && (
        <Pager
          page={page}
          lastPage={lastPage}
          onPage={(p) => {
            setPage(p)
            useStore.getState().setHomeScroll(0)
            if (scrollRef.current) scrollRef.current.scrollTop = 0
          }}
        />
      )}
      <div className="result-count">
        {normal ? `${total}개 시리즈` : `${total}개 작품`} · {pageSize}개씩
      </div>

      {delGroup && (
        <ConfirmModal
          icon="🗑"
          danger
          title={`'${delGroup.name}' 그룹을 삭제하시겠습니까?`}
          desc={
            <>
              그룹이 사라지고, 속한 작품들은 그룹 폴더 밖으로 이동합니다. 작품 자체는 삭제되지
              않습니다.
            </>
          }
          confirmLabel="삭제"
          onConfirm={() => {
            const id = delGroup.id
            setDelGroup(null)
            deleteGroup(id)
          }}
          onCancel={() => setDelGroup(null)}
        />
      )}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button className={`chip ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}
