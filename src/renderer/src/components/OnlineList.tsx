import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { GallerySummary, HitomiListSource, OnlineSort } from '../../../shared/ipc'
import Pager from './Pager'
import CopyCode from './CopyCode'
import ContextMenu from './ContextMenu'
import Stars from './Stars'
import Dropdown from './Dropdown'
import { CheckIcon, PauseIcon, PlayIcon } from './icons'
import OnlineThumb from './OnlineThumb'
import { getOnlineImages } from '../images'
import { favMeta, tagToken } from '../util'
import type { OnlineGallery, DownloadItem } from '../store'

const SORTS: [OnlineSort, string][] = [
  ['date', '최신'],
  ['today', '인기-오늘'],
  ['week', '인기-주'],
  ['month', '인기-월'],
  ['year', '인기-년']
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
  const toggleOnlineFav = useStore((s) => s.toggleOnlineFav)
  const setOnlineRank = useStore((s) => s.setOnlineRank)
  const goBrowse = useStore((s) => s.goBrowse)
  const source = useStore((s) => s.browseSource)
  const setBrowseSource = useStore((s) => s.setBrowseSource)
  const page = useStore((s) => s.browsePage)
  const setBrowsePage = useStore((s) => s.setBrowsePage)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)

  const [input, setInput] = useState('')
  const [items, setItems] = useState<GallerySummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; g: OnlineGallery } | null>(null)
  const [crossMenu, setCrossMenu] = useState<{ x: number; y: number; query: string; raw: string } | null>(null)
  const searchLocal = useStore((s) => s.searchLocal)
  const addFavoriteTag = useStore((s) => s.addFavoriteTag)

  useEffect(() => {
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
  }, [source, page])

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
      <div className="lib-list-head">
        <button className="mini" onClick={goBrowse}>
          🌐
        </button>
        <Dropdown<OnlineSort>
          className="field sm"
          value={source.kind === 'index' ? source.sort ?? 'date' : 'date'}
          onChange={(v) => {
            setBrowsePage(0)
            setBrowseSource({ kind: 'index', language: lang, sort: v })
          }}
          options={SORTS}
        />
      </div>
      <div className="lib-search-row">
        <input
          className="search sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          placeholder="제목, 코드, 태그, artist:작가명 / tag:태그명 으로 검색 후 Enter"
        />
        <button className="mini" onClick={apply}>
          검색
        </button>
      </div>
      <div className="lib-list-scroll">
        {error && <div className="warn err">{error}</div>}
        {loading && <div className="reader-loading">불러오는 중…</div>}
        {items.map((g) => (
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
            <OnlineThumb getImgs={() => getOnlineImages(g.code)} thumbUrl={g.thumbUrl} className="lib-thumb" />
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
                      setCrossMenu({ x: e.clientX, y: e.clientY, query: tagToken(`artist:${g.artists[0]}`), raw: g.artists[0] })
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
                      setCrossMenu({ x: e.clientX, y: e.clientY, query: tagToken(t), raw: t })
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
                          '↻'
                        ) : (
                          '⬇'
                        )}
                      </span>
                    )
                  })()}
                  <span
                    className={`lib-heart ${onlineFavs[g.code]?.favorite ? 'on' : ''}`}
                    title="즐겨찾기"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleOnlineFav(g.code, favMeta(g))
                    }}
                  >
                    {onlineFavs[g.code]?.favorite ? '♥' : '♥'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
        <Pager page={page} lastPage={lastPage} onPage={setBrowsePage} small />
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
      {crossMenu && (
        <ContextMenu
          x={crossMenu.x}
          y={crossMenu.y}
          items={[
            { label: '로컬에서 검색', onClick: () => searchLocal(crossMenu.query) },
            { label: '즐겨찾는 태그로 추가', onClick: () => addFavoriteTag(crossMenu.raw) }
          ]}
          onClose={() => setCrossMenu(null)}
        />
      )}
    </div>
  )
}
