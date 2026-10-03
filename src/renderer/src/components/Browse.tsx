import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useLibraryCodes, useStore } from '../store'
import type { GallerySummary, OnlineSort, SearchSort } from '../../../shared/ipc'
import Pager from './Pager'
import TagSearchInput from './TagSearchInput'
import OnlineThumb from './OnlineThumb'
import TagList from './TagList'
import { getOnlineImages } from '../images'
import CopyCode from './CopyCode'
import ContextMenu from './ContextMenu'
import { useTagMenu } from './useTagMenu'
import Stars from './Stars'
import { favMeta, tagTokens, tagToken, tokenLabel, FAV_BASE } from '../util'
import { useFavSummaries } from '../favSummaries'
import Caret from './Caret'
import Dropdown from './Dropdown'
import { CheckIcon, PauseIcon, PlayIcon, SearchIcon, SyncIcon, GridIcon, MenuIcon, FavoriteIcon, DownloadIcon } from './icons'
import { OnlineOnlyToggle, FavSortSelect } from './FavDlToggle'
import { hitomiFavCodes, hitomiFavGalleries } from '../favorites'
import type { OnlineGallery } from '../store'

const LANGS = [
  ['all', '전체'],
  ['korean', '한국어'],
  ['japanese', '日本語'],
  ['english', 'English'],
  ['chinese', '中文']
] as const

const SORTS: [OnlineSort, string][] = [
  ['date', '최신순'],
  ['today', '인기-오늘'],
  ['week', '인기-주간'],
  ['month', '인기-월간'],
  ['year', '인기-연간']
]


export default function Browse(): JSX.Element {
  const openOnline = useStore((s) => s.openOnline)
  const openOnlineBackground = useStore((s) => s.openOnlineBackground)
  const openGlance = useStore((s) => s.openGlance)
  const openSplitOnline = useStore((s) => s.openSplitOnline)
  const splitOpen = useStore((s) => !!s.tabs.find((t) => t.id === s.activeTabId)?.split)
  const onlineFavs = useStore((s) => s.onlineFavs)
  const toggleUnifiedFav = useStore((s) => s.toggleUnifiedFav)
  const setOnlineRank = useStore((s) => s.setOnlineRank)
  const startDownload = useStore((s) => s.startDownload)
  const stopDownload = useStore((s) => s.stopDownload)
  const retryDownload = useStore((s) => s.retryDownload)
  const pushSearchHistory = useStore((s) => s.pushSearchHistory)
  const searchHistory = useStore((s) => s.settings.searchHistory ?? [])
  const favoriteSearches = useStore((s) => s.settings.favoriteSearches ?? [])
  const favoriteTags = useStore((s) => s.settings.favoriteTags ?? [])
  const downloads = useStore((s) => s.downloads)
  const works = useStore((s) => s.works)
  const [favMode, setFavMode] = useState(false)
  const [favSort, setFavSort] = useState<'rank' | 'recent'>('recent')
  const onlineFavLists = useStore((s) => s.settings.onlineFavLists ?? [])
  const pageSize = useStore((s) => s.settings.pageSize || 50)
  const marginWidth = useStore((s) => s.settings.marginWidth)
  const [favPage, setFavPage] = useState(0)
  const [favPanel, setFavPanel] = useState(false)
  // Fav lists the user UNchecked in the drawer (all checked by default).
  const [favUnchecked, setFavUnchecked] = useState<string[]>([])
  const allFavNames = useMemo(() => [FAV_BASE, ...onlineFavLists.map((l) => l.name)], [onlineFavLists])
  const favSelected = useMemo(
    () => allFavNames.filter((n) => !favUnchecked.includes(n)),
    [allFavNames, favUnchecked]
  )
  const [listGallery, setListGallery] = useState<GallerySummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const activeSource = useStore((s) => s.browseSource)
  const setBrowseSource = useStore((s) => s.setBrowseSource)
  const page = useStore((s) => s.browsePage)
  const setBrowsePage = useStore((s) => s.setBrowsePage)
  const browseTopNonce = useStore((s) => s.browseTopNonce)
  const rootRef = useRef<HTMLDivElement>(null)
  // Bumped to force a fresh fetch even when source/page are unchanged (used by
  // the 🌐 double-press reset when already on the first page).
  const [reloadKey, setReloadKey] = useState(0)
  // Tag autocomplete for the search box (replaces the old tag-builder row).
  const libTokens = useMemo(() => tagTokens(works), [works])
  const [lang, setLang] = useState<string>(activeSource.language ?? 'all')
  const [query, setQuery] = useState(activeSource.kind === 'search' ? activeSource.query : '')
  // One sort drives BOTH browse and search. Search only supports date/popular, so
  // any "인기-기간" maps to popular there.
  const [sort, setSort] = useState<OnlineSort>(
    activeSource.kind === 'index' ? activeSource.sort ?? 'date' : 'date'
  )
  const [reverse, setReverse] = useState(false)
  const [browseLayout, setBrowseLayout] = useState<'grid' | 'list'>('grid')
  const [items, setItems] = useState<GallerySummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; g: OnlineGallery } | null>(null)
  const { openTagMenu, tagMenu } = useTagMenu('local')

  // Descending sort must reverse the WHOLE list, not just the visible page, so
  // page N (user-facing) maps to the mirrored source page (lastPage - N) and its
  // items are reversed. Only for the online browse (favorites paginate locally).
  // total is 0 until the first fetch; then fetchPage recomputes and self-corrects.
  const lastSrcPage = Math.max(0, Math.ceil(total / pageSize) - 1)
  const fetchPage = !favMode && reverse && total > 0 ? Math.max(0, lastSrcPage - page) : page
  // Reset the known total when the source changes so the reverse page-mirror
  // doesn't briefly use the previous source's page count.
  useEffect(() => setTotal(0), [activeSource])

  // The browse view is kept mounted (hidden) once first opened, so this effect
  // only re-runs on an actual source/page change or a forced reload (🌐 double-
  // press / reloadKey) — returning to the view does NOT refetch.
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setItems([]) // drop the previous page so it doesn't linger under the loader
    window.api
      .hitomiList(activeSource, fetchPage)
      .then((r) => {
        if (!alive) return
        setItems(r.items)
        setTotal(r.total)
      })
      .catch((e) => alive && setError(String(e?.message ?? e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [activeSource, fetchPage, reloadKey])

  // Comma-separated tokens so multi-word tags (e.g. "female:sole female") survive.
  // A lone multi-word token (no comma to separate it) is quoted so the backend
  // keeps it whole.
  const tokens = query.split(',').map((t) => t.trim()).filter(Boolean)
  const addToken = (raw: string): void => {
    const tok = raw.includes(' ') ? `"${raw.replace(/"/g, '')}"` : raw
    if (!tokens.includes(tok)) setQuery([...tokens, tok].join(', '))
  }

  const runIndex = (): void => {
    setBrowsePage(0)
    setBrowseSource({ kind: 'index', language: lang === 'all' ? null : lang, sort })
  }
  const runSearch = (q = query): void => {
    const t = q.trim()
    if (!t) return runIndex()
    pushSearchHistory(t)
    setBrowsePage(0)
    const ss: SearchSort = sort === 'date' ? 'date' : 'popular'
    setBrowseSource({ kind: 'search', query: t, language: lang === 'all' ? null : lang, sort: ss })
  }
  // Individual chips for the current search's tokens (comma-separated), shown above
  // the results like the local library's active-filter chip. Removing a chip
  // re-runs the search without it.
  const searchTokens =
    activeSource.kind === 'search'
      ? activeSource.query.split(',').map((s) => s.trim()).filter(Boolean)
      : []
  const removeToken = (tok: string): void => {
    const rest = searchTokens.filter((t) => t !== tok)
    const q = rest.join(', ')
    setQuery(q)
    if (rest.length) runSearch(q)
    else runIndex()
  }
  // Pressing the 🌐 online button while already here bumps browseTopNonce →
  // return to the initial listing: KEEP the language + browse sort, but CLEAR
  // the search query/tags. First page + scroll top. Skip the initial mount.
  const mountNonce = useRef(browseTopNonce)
  useEffect(() => {
    if (browseTopNonce === mountNonce.current) return
    mountNonce.current = browseTopNonce
    setFavMode(false)
    setQuery('')
    setSort('date')
    setBrowsePage(0)
    const keepSort: OnlineSort = activeSource.kind === 'index' ? activeSource.sort ?? 'date' : 'date'
    setBrowseSource({ kind: 'index', language: lang === 'all' ? null : lang, sort: keepSort })
    setReloadKey((k) => k + 1) // force a fresh fetch even if the source is unchanged
    if (rootRef.current) rootRef.current.scrollTop = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseTopNonce])

  // Changing page (pager / 🎲 / source switch resets to 0) → scroll to the top,
  // same as the library home does.
  useEffect(() => {
    if (rootRef.current) rootRef.current.scrollTop = 0
  }, [page])

  // Change the single sort; re-run whichever view is active (search vs browse).
  const changeSort = (s: OnlineSort): void => {
    setSort(s)
    setBrowsePage(0)
    if (query.trim()) {
      setBrowseSource({
        kind: 'search',
        query: query.trim(),
        language: lang === 'all' ? null : lang,
        sort: s === 'date' ? 'date' : 'popular'
      })
    } else {
      setBrowseSource({ kind: 'index', language: lang === 'all' ? null : lang, sort: s })
    }
  }

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1)

  // "내 즐겨찾기" view: render the persisted online favorites instead of doujin
  // results, sorted by rank or recency.
  // Favorites are stored without tags → fetch their gallery summaries (cached).
  const favCodes = useMemo(() => hitomiFavCodes(onlineFavs), [onlineFavs])
  const sumVer = useFavSummaries(favMode ? favCodes : [])
  // Unified favorites (online + locally favorited coded works), sorted by
  // favorite time or rating. sumVer re-runs it as summaries (tags) arrive.
  const favGalleries = useMemo(
    () => hitomiFavGalleries(onlineFavs, works, favSort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onlineFavs, favSort, works, sumVer]
  )
  // Checked online lists → fetch their gallery summaries (union of codes). '기본'
  // has no codes (it's the app's own online favorites), so it isn't fetched.
  useEffect(() => {
    const codes = [
      ...new Set(
        onlineFavLists.filter((l) => favSelected.includes(l.name)).flatMap((l) => l.codes)
      )
    ]
    if (!favMode || codes.length === 0) {
      setListGallery([])
      return
    }
    let alive = true
    setListLoading(true)
    window.api
      .hitomiSummaries(codes)
      .then((r) => alive && setListGallery(r))
      .finally(() => alive && setListLoading(false))
    return () => {
      alive = false
    }
  }, [favMode, favSelected, onlineFavLists])

  const gallery = useMemo<GallerySummary[]>(() => {
    if (!favMode) return items
    // Union of the checked lists: '기본' contributes the app's own online favorites,
    // each imported list contributes its fetched summaries.
    const base = favSelected.includes(FAV_BASE) ? favGalleries : []
    const seen = new Set<string>()
    return [...base, ...listGallery].filter((g) => !seen.has(g.code) && seen.add(g.code))
  }, [favMode, favSelected, items, favGalleries, listGallery])
  // Library lookups by gallery code (downloaded? local cover? local heart?).
  const { libCodes, codeWorkId, localFavCodes } = useLibraryCodes()

  // Online favorites view: "ALL" (unified: online favs + local favorites) vs
  // "온라인만" (only actual online favorites, hiding local-only merged entries).
  const favOnlineOnly = useStore((s) => s.favOnlineOnly)
  const setOnlineListFav = useStore((s) => s.setOnlineListFav)
  // Remember whether the reader's left online list should show favorites: it
  // mirrors the view the user opened a work from (favorites vs plain browse).
  useEffect(() => setOnlineListFav(favMode), [favMode, setOnlineListFav])
  const base = favMode
    ? favOnlineOnly
      ? gallery.filter((g) => !libCodes.has(g.code)) // not downloaded yet
      : gallery
    : items
  const favLastPage = Math.max(0, Math.ceil(base.length / pageSize) - 1)
  useEffect(() => setFavPage(0), [favMode, favSort, favSelected, base.length])
  const ordered = reverse ? [...base].reverse() : base
  const shown = favMode ? ordered.slice(favPage * pageSize, favPage * pageSize + pageSize) : ordered

  // Direct download from a card (feature 10). Progress shows in the shared
  // download manager (fed by the hitomiProgress channel).
  const dlOf = (code: string): (typeof downloads)[number] | undefined =>
    downloads.find((d) => d.code === code)
  const download = async (code: string, title?: string): Promise<void> => {
    try {
      await startDownload({ kind: 'hitomi', input: code, title })
    } catch (e: any) {
      alert(String(e?.message ?? e))
    }
  }

  return (
    <div className="browse" ref={rootRef} style={{ ['--mw' as string]: `${marginWidth}px` }}>
      <div className="browse-head">
        <div className="badge">Doujinshi online</div>
        <h1>온라인 둘러보기</h1>

        <div className="search-row">
          <Dropdown<string> className="field" value={lang} onChange={setLang} options={LANGS} />
          <Dropdown<OnlineSort> className="field" value={sort} onChange={changeSort} options={SORTS} />
          <TagSearchInput
            value={query}
            onChange={setQuery}
            onEnter={() => runSearch()}
            tokens={libTokens}
            fetchTokens={(q) => window.api.hitomiSuggest(q)}
            history={searchHistory}
            onPickHistory={(q) => {
              setQuery(q)
              runSearch(q)
            }}
            favorites={[
              ...favoriteSearches,
              // Highlighted tags (favoriteTags) double as one-tap favorite searches.
              ...favoriteTags.map((t) => tagToken(t)).filter((t) => !favoriteSearches.includes(t))
            ]}
            onPickFavorite={(fav) => {
              // Append to the search box (comma-joined) so the user can compose a
              // combo from several favorites, then search when ready.
              setQuery((prev) => {
                const p = prev.trim().replace(/,\s*$/, '')
                return p ? `${p}, ${fav}` : fav
              })
            }}
            placeholder="검색 후 Enter"
          />
          <button className="btn primary" onClick={() => runSearch()} title="검색">
            <SearchIcon />
          </button>
          <button
            className="btn"
            title="랜덤 페이지"
            onClick={() => lastPage > 0 && setBrowsePage(Math.floor(Math.random() * (lastPage + 1)))}
          >
            <SyncIcon />
          </button>
        </div>

        <div className="chips">
          <button
            className="chip layout-toggle"
            onClick={() => setBrowseLayout((l) => (l === 'grid' ? 'list' : 'grid'))}
            title={browseLayout === 'grid' ? '격자형' : '목록형'}
          >
            {browseLayout === 'grid' ? <GridIcon /> : <MenuIcon />}
          </button>
          <button
            className="chip layout-toggle"
            onClick={() => setReverse((v) => !v)}
            title={reverse ? '오름차순' : '내림차순'}
          >
            <Caret up={reverse} />
          </button>
          <button
            className={`chip ${!favMode ? 'active' : ''}`}
            onClick={() => {
              setFavUnchecked([])
              setFavMode(false)
            }}
          >
            전체
          </button>
          <div className="cat-wrap">
            <span className={`chip fav-chip ${favMode ? 'active' : ''}`}>
              <span
                className="fav-label"
                onClick={() => {
                  setFavUnchecked([])
                  setFavMode(true)
                }}
                title="즐겨찾기"
              >
                <FavoriteIcon filled className="fav-ico" /> 즐겨찾기 {favGalleries.length}
              </span>
              <span className="fav-caret" onClick={() => setFavPanel((v) => !v)} title="즐겨찾기 목록">
                <span className={`dt ${favPanel ? 'up' : ''}`} />
              </span>
            </span>
            {favPanel && (
              <div className="cat-panel" onMouseLeave={() => setFavPanel(false)}>
                {[{ name: FAV_BASE, codes: [] as string[] }, ...onlineFavLists].map((l) => (
                  <label key={l.name}>
                    <input
                      type="checkbox"
                      checked={!favUnchecked.includes(l.name)}
                      onChange={() => {
                        setFavUnchecked((cur) =>
                          cur.includes(l.name) ? cur.filter((x) => x !== l.name) : [...cur, l.name]
                        )
                        setFavMode(true)
                      }}
                    />
                    ★ {l.name}
                    {l.name !== FAV_BASE && ` · ${l.codes.length}`}
                  </label>
                ))}
              </div>
            )}
          </div>
          {favMode && <OnlineOnlyToggle />}
          {favMode && <FavSortSelect value={favSort} onChange={setFavSort} />}
        </div>
      </div>

      {searchTokens.length > 0 && (
        <div className="search-chips">
          {searchTokens.map((tok) => (
            <button
              key={tok}
              className="chip active search-tok"
              title="검색에서 제거"
              onClick={() => removeToken(tok)}
            >
              {tokenLabel(tok)} ✕
            </button>
          ))}
        </div>
      )}

      {error && !favMode && <div className="warn err">{error} — 온라인 접속/태그 경로를 확인하세요.</div>}
      {loading && !favMode && <div className="reader-loading">불러오는 중…</div>}
      {favMode && listLoading && <div className="reader-loading">목록 불러오는 중…</div>}
      {favMode && !listLoading && gallery.length === 0 && (
        <div className="empty">
          {favUnchecked.length ? '이 목록에서 불러온 작품이 없습니다.' : '즐겨찾기한 온라인 작품이 없습니다.'}
        </div>
      )}

      <div className={`browse-grid ${browseLayout === 'list' ? 'list' : ''}`}>
        {shown.map((g) => {
          const f = onlineFavs[g.code]
          const d = dlOf(g.code)
          const phase = d?.phase
          // In flight (can pause) vs user-paused (can resume) vs failed.
          const dlActive =
            phase === 'queued' || phase === 'fetching' || phase === 'downloading' || phase === 'enriching'
          const dlPaused = phase === 'stopped'
          const dlErr = phase === 'error'
          const dlPct = d?.total ? Math.round((d.done / d.total) * 100) : 0
          const have = libCodes.has(g.code) || phase === 'done'
          return (
          <div
            key={g.code}
            className="gcard"
            onClickCapture={(e) => {
              if (window.getSelection()?.toString()) return e.stopPropagation()
              if (e.altKey) {
                e.preventDefault()
                e.stopPropagation()
                openGlance({ online: { code: g.code, title: g.title, artist: g.artists.join(', ') || null } })
              }
            }}
            onClick={() => openOnline({ code: g.code, title: g.title, artist: g.artists.join(', ') || null })}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault() // block middle-click autoscroll
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                openOnlineBackground({ code: g.code, title: g.title, artist: g.artists.join(', ') || null })
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({
                x: e.clientX,
                y: e.clientY,
                g: { code: g.code, title: g.title, artist: g.artists.join(', ') || null }
              })
            }}
          >
            <OnlineThumb getImgs={() => getOnlineImages(g.code)} thumbUrl={g.thumbUrl} localWorkId={codeWorkId.get(g.code)}>
              {(dlActive || dlPaused || have) && (
                <div className="gcard-dlbar">
                  <div
                    className={`gcard-dlbar-fill ${have ? 'done' : ''} ${dlPaused ? 'paused' : ''}`}
                    style={{ width: have ? '100%' : `${dlPct}%` }}
                  />
                </div>
              )}
            </OnlineThumb>
            <div className="gcard-foot">
              <Stars rank={f?.rank ?? 0} onChange={(r) => setOnlineRank(g.code, r, favMeta(g))} size={15} />
              <span className="seg" style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
                <span
                  className={`seg-heart ${f?.favorite || localFavCodes.has(g.code) ? 'on' : ''}`}
                  title="즐겨찾기"
                  onClick={() => toggleUnifiedFav(g.code, favMeta(g))}
                >
                  <FavoriteIcon filled={!!f?.favorite || localFavCodes.has(g.code)} />
                </span>
                <span
                  className={`seg-dl ${have ? 'ok' : ''} ${dlErr ? 'err' : ''} ${dlPaused ? 'paused' : ''}`}
                  title={
                    dlActive
                      ? `다운로드 중 ${dlPct}% — 클릭 시 일시정지`
                      : dlPaused
                        ? `일시정지됨 (${dlPct}%) — 클릭 시 이어받기`
                        : dlErr
                          ? '실패 — 클릭 시 다시 시도'
                          : have
                            ? '이미 라이브러리에 있음 (다시 받기)'
                            : '이 작품 다운로드'
                  }
                  onClick={() => {
                    if (dlActive) stopDownload(g.code)
                    else if (dlPaused || dlErr) retryDownload(g.code)
                    else download(g.code, g.title)
                  }}
                >
                  {dlActive ? (
                    <PauseIcon />
                  ) : dlPaused ? (
                    <PlayIcon />
                  ) : have ? (
                    <CheckIcon />
                  ) : dlErr ? (
                    <SyncIcon />
                  ) : (
                    <DownloadIcon />
                  )}
                </span>
              </span>
            </div>
            <div className="gcard-title selectable">{g.title}</div>
            <div className="gcard-meta">
              {g.pageCount}p · <CopyCode code={g.code} />
              {g.language && ` · ${g.language}`}
              {g.artists.length > 0 && ' · '}
              {g.artists.length > 0 && (
                <div
                  className="gcard-artist"
                  onClick={(e) => {
                    e.stopPropagation()
                    const a = g.artists[0]
                    runSearch(a.includes(' ') ? `artist:"${a}"` : `artist:${a}`)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openTagMenu(e, tagToken(`artist:${g.artists[0]}`), g.artists[0])
                  }}
                >
                  {g.artists.join(', ')}
                </div>
              )}
            </div>
            <div className="gcard-tags">
              <TagList
                tags={g.tags.filter((t) => !t.startsWith('language:'))}
                favoriteTags={favoriteTags}
                onTagClick={(t) => addToken(tagToken(t))}
                onTagContext={(t, e) => openTagMenu(e, tagToken(t), t)}
                lines={browseLayout === 'grid' ? 5 : undefined}
              />
            </div>
          </div>
          )
        })}
      </div>

      {!favMode && total > 0 && <Pager page={page} lastPage={lastPage} onPage={setBrowsePage} />}
      {favMode && gallery.length > pageSize && (
        <Pager page={favPage} lastPage={favLastPage} onPage={setFavPage} />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: '새 탭에서 열기', onClick: () => openOnline(menu.g) },
            { label: '백그라운드에서 열기', onClick: () => openOnlineBackground(menu.g) },
            { label: splitOpen ? '오른쪽 뷰에서 열기' : '분할 뷰에서 열기', onClick: () => openSplitOnline(menu.g) },
            { label: '⬇ 다운로드', onClick: () => download(menu.g.code, menu.g.title) }
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {tagMenu}
    </div>
  )
}
