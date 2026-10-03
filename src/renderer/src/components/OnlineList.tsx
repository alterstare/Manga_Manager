import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useLibraryCodes, useStore } from '../store'
import type { GallerySummary, HitomiListSource, OnlineSort } from '../../../shared/ipc'
import Pager from './Pager'
import CopyCode from './CopyCode'
import ContextMenu from './ContextMenu'
import { useTagMenu } from './useTagMenu'
import { hitomiFavCodes, hitomiFavGalleries } from '../favorites'
import Stars from './Stars'
import Dropdown from './Dropdown'
import { CheckIcon, PauseIcon, PlayIcon, SearchIcon, FavoriteIcon, DownloadIcon, SyncIcon } from './icons'
import OnlineThumb from './OnlineThumb'
import { getOnlineImages } from '../images'
import { favMeta, tagToken } from '../util'
import { useFavSummaries } from '../favSummaries'
import type { OnlineGallery, DownloadItem } from '../store'
import SearchClear from './SearchClear'
import { useTabState } from './useTabState'

// Sidebar keeps it short: 인기 = the yearly ranking.
const SORTS: [OnlineSort, string][] = [
  ['date', '최신'],
  ['year', '인기'],
  ['random', '랜덤']
]

// Compact online browse list shown on the left while reading an online gallery.
// Source + page live in the store so they persist across mounts (feature 5).
export default function OnlineList(): JSX.Element {
  const openOnline = useStore((s) => s.openOnline)
  const openOnlineBackground = useStore((s) => s.openOnlineBackground)
  const openGlance = useStore((s) => s.openGlance)
  const openSplitOnline = useStore((s) => s.openSplitOnline)
  const replaceTabOnline = useStore((s) => s.replaceTabOnline)
  const startDownload = useStore((s) => s.startDownload)
  const stopDownload = useStore((s) => s.stopDownload)
  const retryDownload = useStore((s) => s.retryDownload)
  const downloads = useStore((s) => s.downloads)
  const onlineFavs = useStore((s) => s.onlineFavs)
  const toggleUnifiedFav = useStore((s) => s.toggleUnifiedFav)
  const setOnlineRank = useStore((s) => s.setOnlineRank)
  // Starts from the online browse screen's source/page; once this tab searches,
  // sorts or pages, it keeps its own (per tab — other tabs' lists stay as is).
  const globalSource = useStore((s) => s.browseSource)
  const globalPage = useStore((s) => s.browsePage)
  const [tabSource, setBrowseSource] = useTabState<HitomiListSource | null>('source', null)
  const [tabPage, setBrowsePage] = useTabState<number | null>('page', null)
  const source = tabSource ?? globalSource
  const page = tabPage ?? globalPage
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)

  const [input, setInput] = useTabState('input', '')
  const [items, setItems] = useState<GallerySummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; g: OnlineGallery } | null>(null)
  const { openTagMenu, tagMenu } = useTagMenu('local')
  // Opened from the favorites view → show the unified favorites list (online favs
  // + locally-favorited works) instead of the latest online listing.
  const onlineListFav = useStore((s) => s.onlineListFav)
  const works = useStore((s) => s.works)
  const favCodes = useMemo(() => hitomiFavCodes(onlineFavs), [onlineFavs])
  const sumVer = useFavSummaries(onlineListFav ? favCodes : [])
  const favList = useMemo(
    () => hitomiFavGalleries(onlineFavs, works),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onlineFavs, works, sumVer]
  )
  const displayItems = onlineListFav ? favList : items
  const { codeWorkId, localFavCodes } = useLibraryCodes()
  const isFav = (code: string): boolean => !!onlineFavs[code]?.favorite || localFavCodes.has(code)

  useEffect(() => {
    if (onlineListFav) return // favorites are computed locally; no fetch
    let alive = true
    setLoading(true)
    setError(null)
    window.api
      .hitomiList(source, page)
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
  }, [source, page, onlineListFav])

  const lang = source.language
  const apply = (): void => {
    const q = input.trim()
    const s: HitomiListSource = q ? { kind: 'search', query: q, language: lang } : { kind: 'index', language: lang }
    setBrowsePage(0)
    setBrowseSource(s)
  }
  // Comma-join so multi-word tags survive; quote a lone multi-word token.
  const addToken = (raw: string): void => {
    const tok = raw.includes(' ') ? `"${raw.replace(/"/g, '')}"` : raw
    setInput((c) => (c.trim() ? c.trim().replace(/,\s*$/, '') + ', ' + tok : tok))
  }
  const pageSize = useStore((s) => s.settings.pageSize || 50)
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1)

  const activeCode = tabs.find((t) => t.id === activeTabId)?.online?.code

  // Download a gallery straight from the list (feature 5). Progress shows in the
  // shared download manager (fed by the hitomiProgress channel).
  const dlOf = (code: string): DownloadItem | undefined => downloads.find((d) => d.code === code)
  const download = async (g: GallerySummary): Promise<void> => {
    try {
      await startDownload({ kind: 'hitomi', input: g.code, title: g.title })
    } catch (e: any) {
      alert(String(e?.message ?? e))
    }
  }

  return (
    <div className="lib-list">
      <div className="lib-search-row">
        <div className="search-ac">
          <input
            className="search sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            placeholder="검색 후 Enter"
          />
          <SearchClear value={input} onClear={() => setInput('')} />
        </div>
        <button className="mini" onClick={apply} title="검색">
          <SearchIcon />
        </button>
        {/* Sort — same spot as the local list's 그룹 ▾ button. */}
        <Dropdown<OnlineSort>
          mini
          className="grp-filter"
          value={source.kind === 'index' ? (['today', 'week', 'month'].includes(source.sort ?? '') ? 'year' : source.sort ?? 'date') : 'date'}
          onChange={(v) => {
            setBrowsePage(0)
            setBrowseSource({ kind: 'index', language: lang, sort: v })
          }}
          options={SORTS}
        />
      </div>
      <div className="lib-list-scroll">
        {error && <div className="warn err">{error}</div>}
        {loading && <div className="reader-loading">불러오는 중…</div>}
        {displayItems.map((g) => (
          <div
            key={g.code}
            className={`lib-item ${g.code === activeCode ? 'active' : ''}`}
            // Left-click swaps the gallery IN the current tab; right-click →
            // "새 탭에서 열기" to spawn a new tab.
            onClickCapture={(e) => {
              if (window.getSelection()?.toString()) return e.stopPropagation()
              if (e.altKey) {
                e.preventDefault()
                e.stopPropagation()
                openGlance({ online: { code: g.code, title: g.title, artist: g.artists.join(', ') || null } })
              }
            }}
            onClick={() => {
              const g2 = { code: g.code, title: g.title, artist: g.artists.join(', ') || null }
              if (activeTabId) replaceTabOnline(activeTabId, g2)
              else openOnline(g2)
            }}
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
            <OnlineThumb getImgs={() => getOnlineImages(g.code)} thumbUrl={g.thumbUrl} className="lib-thumb" localWorkId={codeWorkId.get(g.code)} />
            <div className="lib-item-info">
              <div className="lib-item-title selectable">{g.title}</div>
              <div className="lib-item-meta">
                {g.pageCount}p · <CopyCode code={g.code} />
              </div>
              <div className="lib-chips">
                {g.artists[0] && (
                  <span
                    className="chip-mini artist"
                    onClick={(e) => {
                      e.stopPropagation()
                      addToken(`artist:${g.artists[0]}`)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      openTagMenu(e, tagToken(`artist:${g.artists[0]}`), g.artists[0])
                    }}
                  >
                    {g.artists[0]}
                  </span>
                )}
                {g.tags.filter((t) => !t.startsWith('language:')).slice(0, 4).map((t) => (
                  <span
                    key={t}
                    className="chip-mini"
                    onClick={(e) => {
                      e.stopPropagation()
                      addToken(tagToken(t))
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      openTagMenu(e, tagToken(t), t)
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div className="lib-foot">
                <Stars
                  rank={onlineFavs[g.code]?.rank ?? 0}
                  onChange={(r) => setOnlineRank(g.code, r, favMeta(g))}
                  size={14}
                />
                <div className="lib-foot-actions">
                  {(() => {
                    const d = dlOf(g.code)
                    const phase = d?.phase
                    const active =
                      phase === 'queued' ||
                      phase === 'fetching' ||
                      phase === 'downloading' ||
                      phase === 'enriching'
                    const paused = phase === 'stopped'
                    const err = phase === 'error'
                    const done = phase === 'done'
                    const pct = d?.total ? Math.round((d.done / d.total) * 100) : 0
                    return (
                      <span
                        className={`lib-dl ${done ? 'ok' : ''} ${err ? 'err' : ''} ${paused ? 'paused' : ''}`}
                        title={
                          active
                            ? `다운로드 중 ${pct}% — 클릭 시 일시정지`
                            : paused
                              ? `일시정지됨 (${pct}%) — 클릭 시 이어받기`
                              : err
                                ? '실패 — 클릭 시 다시 시도'
                                : done
                                  ? '다운로드 완료'
                                  : '다운로드'
                        }
                        onClick={(e) => {
                          e.stopPropagation()
                          if (active) stopDownload(g.code)
                          else if (paused || err) retryDownload(g.code)
                          else download(g)
                        }}
                      >
                        {active ? (
                          <PauseIcon />
                        ) : paused ? (
                          <PlayIcon />
                        ) : done ? (
                          <CheckIcon />
                        ) : err ? (
                          <SyncIcon />
                        ) : (
                          <DownloadIcon />
                        )}
                      </span>
                    )
                  })()}
                  <span
                    className={`lib-heart ${isFav(g.code) ? 'on' : ''}`}
                    title="즐겨찾기"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleUnifiedFav(g.code, favMeta(g))
                    }}
                  >
                    <FavoriteIcon filled={isFav(g.code)} />
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
        {!onlineListFav && <Pager page={page} lastPage={lastPage} onPage={setBrowsePage} small />}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: '새 탭에서 열기', onClick: () => openOnline(menu.g) },
            { label: '백그라운드에서 열기', onClick: () => openOnlineBackground(menu.g) },
            {
              label: tabs.find((t) => t.id === activeTabId)?.split ? '오른쪽 뷰에서 열기' : '분할 뷰에서 열기',
              onClick: () => openSplitOnline(menu.g)
            },
            { label: '⬇ 다운로드', onClick: () => download({ code: menu.g.code, title: menu.g.title } as GallerySummary) },
            { label: '현재 탭에서 열기', onClick: () => (activeTabId ? replaceTabOnline(activeTabId, menu.g) : openOnline(menu.g)) }
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {tagMenu}
    </div>
  )
}
