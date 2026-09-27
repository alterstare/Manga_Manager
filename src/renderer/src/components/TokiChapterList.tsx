import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { getTokiChapters } from '../toki'
import type { TokiChapter } from '../../../shared/ipc'
import type { OnlineFav } from '../../../shared/types'
import Stars from './Stars'

// Left list shown while reading a toki chapter: the sibling chapters of the active
// tab's series. Mirrors the local general-manga left list (LibraryList) so the
// reader chrome is identical between local and online in general-manga mode.
export default function TokiChapterList(): JSX.Element {
  const replaceTabOnline = useStore((s) => s.replaceTabOnline)
  const goHome = useStore((s) => s.goHome)
  const onlineFavs = useStore((s) => s.onlineFavs)
  const toggleOnlineFav = useStore((s) => s.toggleOnlineFav)
  const setOnlineRank = useStore((s) => s.setOnlineRank)
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const online = active?.online
  const seriesUrl = online?.seriesUrl

  // Per-chapter online favorite/rank stored in onlineFavs, keyed by chapter url —
  // gives the online reader the same 평점/즐겨찾기 controls as the local one.
  const chapterMeta = (c: TokiChapter): Partial<OnlineFav> => ({
    title: c.title,
    artist: online?.artist ?? null,
    thumbUrl: online?.thumb,
    language: null,
    pageCount: 0
  })

  const [chapters, setChapters] = useState<TokiChapter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [applied, setApplied] = useState('')

  useEffect(() => {
    if (!seriesUrl) {
      setChapters([])
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    getTokiChapters(seriesUrl)
      .then((c) => alive && setChapters(c))
      .catch((e) => alive && setError(String(e?.message ?? e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [seriesUrl])

  const apply = (): void => setApplied(input.trim())
  const q = applied.toLowerCase()
  const list = q ? chapters.filter((c) => c.title.toLowerCase().includes(q)) : chapters

  return (
    <div className="lib-list">
      <div className="lib-list-head">
        <button className="mini" onClick={goHome}>
          ← 홈
        </button>
        <span className="lib-series-label">
          📖 시리즈 · {chapters.length}화
        </span>
      </div>
      <div className="lib-search-row">
        <input
          className="search sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          placeholder="검색 후 Enter"
        />
        <button className="mini" onClick={apply}>
          검색
        </button>
      </div>
      {applied && (
        <div className="applied-row">
          <span className="applied-q">“{applied}”</span>
          <span
            className="mini"
            onClick={() => {
              setInput('')
              setApplied('')
            }}
          >
            초기화
          </span>
        </div>
      )}
      <div className="lib-list-scroll compact">
        {error && <div className="warn err">{error}</div>}
        {loading && <div className="reader-loading">불러오는 중…</div>}
        {list.map((c) => {
          const fav = onlineFavs[c.url]
          return (
            <div
              key={c.url}
              className={`chapter-row ${c.url === online?.code ? 'active' : ''}`}
              onClick={() =>
                active &&
                replaceTabOnline(active.id, {
                  code: c.url,
                  title: online?.title ?? c.title,
                  artist: online?.artist ?? null,
                  kind: 'toki',
                  seriesUrl,
                  chapterLabel: c.title,
                  thumb: online?.thumb
                })
              }
              title={c.title}
            >
              <div className="chapter-line">
                <span className="ch-label">{c.title}</span>
                <span className="ch-spacer" />
                <Stars rank={fav?.rank ?? 0} onChange={(r) => setOnlineRank(c.url, r, chapterMeta(c))} size={13} />
                <span
                  className={`ch-heart ${fav?.favorite ? 'on' : ''}`}
                  title="즐겨찾기"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleOnlineFav(c.url, chapterMeta(c))
                  }}
                >
                  {fav?.favorite ? '♥' : '♥'}
                </span>
              </div>
            </div>
          )
        })}
        {!loading && !error && chapters.length === 0 && <div className="hint">화 목록이 없습니다.</div>}
        {chapters.length > 0 && <div className="result-count">{chapters.length}개</div>}
      </div>
    </div>
  )
}
