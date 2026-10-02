import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore, useSeriesRoots } from '../store'
import type { TokiListSource, TokiSummary, TokiSort, TokiType } from '../../../shared/ipc'
import type { OnlineFav } from '../../../shared/types'
import Stars from './Stars'
import TokiDownloadModal from './TokiDownloadModal'
import type { TokiSeriesRef } from './TokiDownloadModal'
import TokiBackupModal from './TokiBackupModal'
import OnlineThumb from './OnlineThumb'
import { getOnlineImages } from '../images'
import { SearchIcon, FavoriteIcon, DownloadIcon } from './icons'
import { BypassToggle, OnlineOnlyToggle, FavSortSelect } from './FavDlToggle'
import Pager from './Pager'
import { groupSeries, titleKey, isTokiCode } from '../util'
import { useTokiStatus } from './useTokiStatus'
import SearchClear from './SearchClear'

const SORTS: [TokiSort, string][] = [
  ['date', '최신순'],
  ['new', '신작순'],
  ['bookmark', '북마크순'],
  ['view', '조회순'],
  ['rating', '평점순'],
  ['chapter', '화수순']
]
const TYPES: [TokiType, string][] = [
  ['manga', '만화'],
  ['webtoon', '웹툰']
]

// Meta cached alongside a toki online favorite (keyed by the series url).
function favMeta(g: TokiSummary, artist: string | null): Partial<OnlineFav> {
  return { title: g.title, artist, thumbUrl: g.thumb, language: null, pageCount: 0 }
}

// General-manga online browse (toki-family mirror). Full-screen, mirrors the
// hitomi Browse. Clicking a series fetches its chapters and opens chapter 1.
// Favorites/ratings reuse the online-fav store, keyed by the series url (http),
// which keeps them separate from hitomi's numeric-code favorites.
export default function TokiBrowse(): JSX.Element {
  const tokiStatus = useTokiStatus()
  const openToki = useStore((s) => s.openToki)
  const openTokiBackground = useStore((s) => s.openTokiBackground)
  const openGlance = useStore((s) => s.openGlance)
  const onlineFavs = useStore((s) => s.onlineFavs)
  const toggleNormalUnifiedFav = useStore((s) => s.toggleNormalUnifiedFav)
  const favOnlineOnly = useStore((s) => s.favOnlineOnly)
  const works = useStore((s) => s.works)
  const openTab = useStore((s) => s.openTab)
  const roots = useSeriesRoots()
  const normalFavSeries = useStore((s) => s.settings.normalFavSeries)
  const setOnlineRank = useStore((s) => s.setOnlineRank)
  const authorSeed = useStore((s) => s.tokiAuthorSeed)
  const browseTopNonce = useStore((s) => s.browseTopNonce)
  const rootRef = useRef<HTMLDivElement>(null)
  // Bumped to force a fresh fetch even when source/page are unchanged (used by
  // the 🌐 double-press reset when already on the first page).
  const [reloadKey, setReloadKey] = useState(0)
  const tokiBaseUrl = useStore((s) => s.settings.tokiBaseUrl)
  const setSettings = useStore((s) => s.setSettings)
  const [addrOpen, setAddrOpen] = useState(false)
  const [addr, setAddr] = useState(tokiBaseUrl)
  const [genre, setGenre] = useState<string>('전체')
  const [sort, setSort] = useState<TokiSort>('date')
  const [type, setType] = useState<TokiType>('manga')
  const [query, setQuery] = useState('')
  const [field, setField] = useState<'title' | 'author'>('title')
  const [source, setSource] = useState<TokiListSource>({ genre: '전체', sort: 'date', type: 'manga' })
  const [page, setPage] = useState(0)
  // Authors discovered when a series is opened (list cards don't carry them).
  const [authors, setAuthors] = useState<Record<string, string | null>>({})
  const [items, setItems] = useState<TokiSummary[]>([])
  const [hasNext, setHasNext] = useState(false)
  // Start empty so the hardcoded seed genres never flash — chips appear only
  // once the live site responds with its actual genre list.
  const [genres, setGenres] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [dlSeries, setDlSeries] = useState<TokiSeriesRef | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [favMode, setFavMode] = useState(false)
  const [favSort, setFavSort] = useState<'rank' | 'recent'>('recent')

  // The browse view is kept mounted (hidden) once first opened, so this effect
  // only re-runs on an actual source/page/base change or a forced reload
  // (🌐 double-press / reloadKey) — returning to the view does NOT refetch.
  // Set when a typed jump overshoots the last page: the site lands on its last
  // page, we sync `page` to it — that state change must not refetch.
  const skipFetch = useRef(false)
  useEffect(() => {
    if (favMode) return
    if (skipFetch.current) {
      skipFetch.current = false
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    setItems([]) // drop the previous page so it doesn't linger under the loader
    window.api
      .tokiList(source, page)
      .then((r) => {
        if (!alive) return
        setItems(r.items)
        setHasNext(r.hasNext)
        if (r.page !== page) {
          skipFetch.current = true
          setPage(r.page)
        }
        // Use the genre chips the live page actually offers (per type).
        if (r.genres && r.genres.length) setGenres(['전체', ...r.genres.filter((g) => g !== '전체')])
      })
      .catch((e) => alive && setError(String(e?.message ?? e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [source, page, favMode, tokiBaseUrl, reloadKey])

  // Save a new mirror address and reload (the list effect re-runs on base change).
  const saveAddr = async (): Promise<void> => {
    const url = addr.trim().replace(/\/+$/, '')
    if (!url) return
    const s = { ...useStore.getState().settings, tokiBaseUrl: url }
    setSettings(s)
    await window.api.saveSettings(s)
    setAddrOpen(false)
    setPage(0)
    setFavMode(false)
  }

  // Apply the current type/sort/genre/query without needing the 적용 button.
  const applySource = (patch: Partial<TokiListSource>): void => {
    const next: TokiListSource = {
      genre,
      sort,
      type,
      query: query.trim() || undefined,
      field,
      ...patch
    }
    setPage(0)
    setFavMode(false)
    setSource(next)
  }
  const run = (): void => applySource({})
  // Pressing the 🌐 online button while already here bumps browseTopNonce →
  // return to the initial listing: KEEP type/sort/genre, but CLEAR the search
  // query (and field). First page + scroll top. Skip the initial mount.
  const mountNonce = useRef(browseTopNonce)
  useEffect(() => {
    if (browseTopNonce === mountNonce.current) return
    mountNonce.current = browseTopNonce
    setFavMode(false)
    setQuery('')
    setField('title')
    setPage(0)
    setSource({ genre, sort, type })
    setReloadKey((k) => k + 1) // force a fresh fetch even if the source is unchanged
    if (rootRef.current) rootRef.current.scrollTop = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseTopNonce])

  // Changing page (이전/다음, or a source switch resets to 0) → scroll to the top,
  // same as the library home does.
  useEffect(() => {
    if (rootRef.current) rootRef.current.scrollTop = 0
  }, [page])
  // Run an author search for a clicked author name.
  const searchAuthor = (name: string): void => {
    setQuery(name)
    setField('author')
    applySource({ query: name, field: 'author' })
  }

  // Author search triggered from another view (reader header etc.).
  useEffect(() => {
    if (!authorSeed) return
    searchAuthor(authorSeed.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorSeed?.nonce])

  // Local general-manga series (downloaded), keyed by normalized title — links a
  // local series with its online toki counterpart (they share only the title).
  const localSeries = useMemo(() => {
    const m = new Map<string, { key: string; title: string; repId: string; artist: string | null }>()
    for (const g of groupSeries(works.filter((w) => (w.library ?? 'hitomi') === 'normal'), roots)) {
      const k = titleKey(g.title)
      if (k && !m.has(k))
        m.set(k, { key: g.key, title: g.title, repId: g.chapters[0]?.id ?? '', artist: g.chapters.find((c) => c.artist)?.artist ?? null })
    }
    return m
  }, [works, roots])
  // Title keys favorited locally (series hearts in the library).
  const localFavKeys = useMemo(() => {
    const set = new Set<string>()
    for (const [k, v] of localSeries) if ((normalFavSeries ?? []).includes(v.key)) set.add(k)
    return set
  }, [localSeries, normalFavSeries])
  const isFavTitle = (g: TokiSummary): boolean =>
    !!onlineFavs[g.url]?.favorite || localFavKeys.has(titleKey(g.title))

  // Unified favorites: online toki favorites + locally-favorited series that have
  // no online favorite yet (url `local:<key>` → opens the downloaded series).
  const normalFavAt = useStore((s) => s.settings.normalFavAt)
  const favGalleries = useMemo<TokiSummary[]>(() => {
    const rows: { g: TokiSummary; t: number; r: number }[] = []
    const seen = new Set<string>()
    for (const f of Object.values(onlineFavs)) {
      if (!f.favorite || !isTokiCode(f.code)) continue
      seen.add(titleKey(f.title))
      rows.push({ g: { url: f.code, title: f.title, thumb: f.thumbUrl, artist: f.artist, genre: null, chapter: null }, t: f.addedAt, r: f.rank })
    }
    for (const k of localFavKeys) {
      if (seen.has(k)) continue
      const v = localSeries.get(k)
      if (v)
        rows.push({
          g: { url: `local:${v.key}`, title: v.title, thumb: null, artist: v.artist, genre: null, chapter: null },
          t: normalFavAt?.[v.key] ?? 0,
          r: 0
        })
    }
    rows.sort((x, y) => (favSort === 'rank' ? y.r - x.r || y.t - x.t : y.t - x.t))
    return rows.map((x) => x.g)
  }, [onlineFavs, favSort, localFavKeys, localSeries, normalFavAt])
  // "온라인만" toggle hides the local-only entries.
  const gallery = favMode
    ? favOnlineOnly
      ? // not downloaded yet: drop library-only entries and series already in the library
        favGalleries.filter((g) => !g.url.startsWith('local:') && !localSeries.has(titleKey(g.title)))
      : favGalleries
    : items

  const openSeries = async (
    g: TokiSummary,
    target: 'tab' | 'glance' | 'background' = 'tab'
  ): Promise<void> => {
    if (g.url.startsWith('local:')) {
      const v = localSeries.get(titleKey(g.title))
      if (v?.repId) openTab(v.repId)
      return
    }
    setOpening(g.url)
    try {
      const chapters = await window.api.tokiChapters(g.url)
      if (chapters.length === 0) {
        alert('이 작품의 화 목록을 찾지 못했습니다. (사이트 구조가 다를 수 있음)')
        return
      }
      // Author + series title are nice-to-haves; fetch after, never block opening.
      const [author, seriesTitle] = await Promise.all([
        window.api.tokiSeriesAuthor(g.url).catch(() => null),
        window.api.tokiSeriesTitle(g.url).catch(() => null)
      ])
      if (author) setAuthors((a) => ({ ...a, [g.url]: author }))
      const first = chapters[0]
      const payload = {
        code: first.url,
        title: seriesTitle || g.title,
        artist: author ?? g.artist,
        seriesUrl: g.url,
        chapterLabel: first.title,
        thumb: g.thumb
      }
      if (target === 'glance') openGlance({ online: { ...payload, kind: 'toki' } })
      else if (target === 'background') openTokiBackground(payload)
      else openToki(payload)
    } catch (e: any) {
      alert(String(e?.message ?? e))
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="browse" ref={rootRef}>
      <div className="browse-head">
        <div className="badge">Manga & Webtoon online</div>
        <h1>일반 만화 온라인</h1>

        <div className="search-row">
          <select
            className="sort"
            value={sort}
            onChange={(e) => {
              const v = e.target.value as TokiSort
              setSort(v)
              applySource({ sort: v })
            }}
          >
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            className="sort"
            value={field}
            onChange={(e) => setField(e.target.value as 'title' | 'author')}
          >
            <option value="title">제목</option>
            <option value="author">작가</option>
          </select>
          <div className="search-ac">
            <input
              className="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder={field === 'author' ? '작가 검색 후 Enter' : '제목 검색 후 Enter (비우면 둘러보기)'}
            />
            <SearchClear value={query} onClear={() => setQuery('')} />
          </div>
          <button className="btn primary" onClick={run} title="검색">
            <SearchIcon />
          </button>
        </div>

        <div className="chips">
          <BypassToggle onApplied={() => !favMode && setReloadKey((k) => k + 1)} />
          {TYPES.map(([v, l]) => (
            <button
              key={v}
              className={`chip ${type === v ? 'active' : ''}`}
              onClick={() => {
                setType(v)
                applySource({ type: v })
              }}
            >
              {l}
            </button>
          ))}
          <button
            className={`chip ${favMode ? 'active' : ''}`}
            title="즐겨찾기"
            onClick={() => setFavMode((v) => !v)}
          >
            <FavoriteIcon filled className="fav-ico" /> 즐겨찾기 {favGalleries.length}
          </button>
          {favMode && <OnlineOnlyToggle />}
          {favMode && <FavSortSelect value={favSort} onChange={setFavSort} />}
          <button
            className="chip"
            onClick={() => window.api.tokiOpenSite()}
          >
            인증창
          </button>
          <button
            className={`chip ${addrOpen ? 'active' : ''}`}
            onClick={() => {
              setAddr(tokiBaseUrl)
              setAddrOpen((v) => !v)
            }}
          >
            주소
          </button>
          <button
            className="chip"
            onClick={() => setBackupOpen(true)}
          >
            비상용
          </button>
        </div>

        {addrOpen && (
          <div className="search-row">
            <input
              className="search"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveAddr()}
              placeholder="https://example.com (구조가 같은 미러 주소)"
              autoFocus
            />
            <button className="btn primary" onClick={saveAddr}>
              저장 후 새로고침
            </button>
            <button className="btn" onClick={() => setAddrOpen(false)}>
              취소
            </button>
          </div>
        )}

        {!favMode && (
          <div className="genre-chips">
            {genres.map((g) => (
              <span
                key={g}
                className={`tag ${genre === g ? 'fav-tag' : ''}`}
                onClick={() => {
                  setGenre(g)
                  applySource({ genre: g })
                }}
              >
                {g}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && !favMode && <div className="warn err">{error} — 설정의 온라인 주소를 확인하세요.</div>}
      {loading && !favMode && <div className="reader-loading">{tokiStatus ?? '불러오는 중…'}</div>}
      {favMode && gallery.length === 0 && (
        <div className="empty">즐겨찾기한 일반 만화 온라인 작품이 없습니다.</div>
      )}
      {!loading && !error && !favMode && items.length === 0 && (
        <div className="empty">결과가 없습니다. (사이트 구조/주소가 다를 수 있음)</div>
      )}

      <div className="browse-grid">
        {gallery.map((g) => {
          const f = onlineFavs[g.url]
          const artist = authors[g.url] ?? g.artist
          return (
            <div
              key={g.url}
              className="gcard"
              // Alt+click anywhere on the card → Glance (capture beats children).
              onClickCapture={(e) => {
                if (window.getSelection()?.toString()) return e.stopPropagation()
                if (e.altKey) {
                  e.preventDefault()
                  e.stopPropagation()
                  void openSeries(g, 'glance')
                }
              }}
            >
              <div
                onClick={() => openSeries(g)}
                onMouseDown={(e) => {
                  if (e.button === 1) e.preventDefault() // block middle-click autoscroll
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    void openSeries(g, 'background')
                  }
                }}
              >
                <OnlineThumb
                  thumbUrl={g.thumb}
                  localWorkId={localSeries.get(titleKey(g.title))?.repId || undefined}
                  getImgs={async () => {
                    // toki: series URL → first chapter → its images.
                    const ch = await window.api.tokiChapters(g.url)
                    return ch[0] ? getOnlineImages(ch[0].url) : []
                  }}
                >
                  {opening === g.url && <div className="gcard-loading">여는 중…</div>}
                </OnlineThumb>
              </div>
              <div className="gcard-foot">
                <Stars rank={f?.rank ?? 0} onChange={(r) => setOnlineRank(g.url, r, favMeta(g, artist))} size={15} />
                <span
                  className={`gcard-heart ${isFavTitle(g) ? 'on' : ''}`}
                  title="즐겨찾기"
                  onClick={(e) => {
                    e.stopPropagation()
                    void toggleNormalUnifiedFav({
                      title: g.title,
                      url: g.url.startsWith('local:') ? undefined : g.url,
                      meta: favMeta(g, artist)
                    })
                  }}
                >
                  <FavoriteIcon filled={isFavTitle(g)} />
                </span>
              </div>
              <div
                className="gcard-title selectable"
                onClick={() => openSeries(g)}
              >
                {g.title}
              </div>
              <div className="gcard-meta">
                {g.chapter && <span>{g.chapter}</span>}
                {g.genre && <div className="gcard-genre">{g.genre}</div>}
                {artist && (
                  <div
                    className="gcard-artist"
                    title={`작가 "${artist}" 검색`}
                    onClick={(e) => {
                      e.stopPropagation()
                      searchAuthor(artist)
                    }}
                  >
                    {artist}
                  </div>
                )}
              </div>
              <button
                className="gcard-dl"
                title="다운로드"
                onClick={(e) => {
                  e.stopPropagation()
                  setDlSeries({ url: g.url, title: g.title })
                }}
              >
                <DownloadIcon /> 다운로드
              </button>
            </div>
          )
        })}
      </div>

      {!favMode && (
        // Total page count isn't exposed by the site → no "/ N"; type any page
        // and Enter (overshooting lands on the last page).
        <Pager page={page} lastPage={-1} hasNext={hasNext} onPage={(p) => setPage(Math.max(0, p))} />
      )}

      {dlSeries && <TokiDownloadModal series={dlSeries} onClose={() => setDlSeries(null)} />}
      {backupOpen && <TokiBackupModal onClose={() => setBackupOpen(false)} />}
    </div>
  )
}
