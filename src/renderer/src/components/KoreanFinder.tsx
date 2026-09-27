import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Work } from '../../../shared/types'
import type { GallerySummary } from '../../../shared/ipc'
import { useStore } from '../store'

// Inline panel (#3): finds Korean editions of a work and lets the user preview /
// download them right from the home list.
export default function KoreanFinder({ work }: { work: Work }): JSX.Element {
  const openOnline = useStore((s) => s.openOnline)
  const startDownload = useStore((s) => s.startDownload)
  const [items, setItems] = useState<GallerySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setItems(null)
    setError(null)
    window.api
      .hitomiFindKorean({ code: work.code, artist: work.artist, title: work.title })
      .then((r) => alive && setItems(r))
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [work.code, work.artist, work.title])

  const download = async (code: string): Promise<void> => {
    setDownloading(code)
    try {
      await startDownload({ kind: 'hitomi', input: code })
    } catch (e: any) {
      alert(String(e?.message ?? e))
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="kfinder" onClick={(e) => e.stopPropagation()}>
      {items === null && !error && <div className="hint">한국어 번역본 찾는 중…</div>}
      {error && <div className="warn err">{error}</div>}
      {items && items.length === 0 && <div className="hint">한국어 번역본을 찾지 못했습니다.</div>}
      <div className="kfinder-list">
        {items?.map((g) => (
          <div className="kfind-row" key={g.code}>
            <div
              className="kfind-thumb"
              onClick={() => openOnline({ code: g.code, title: g.title, artist: g.artists.join(', ') || null })}
            >
              {g.thumbUrl ? <img src={g.thumbUrl} loading="lazy" alt="" /> : <div className="thumb-ph" />}
            </div>
            <div className="kfind-info">
              <div className="kfind-title">{g.title}</div>
              <div className="kfind-meta">
                {g.pageCount}p · [{g.code}]
                {g.artists.length > 0 && ` · ${g.artists.join(', ')}`}
              </div>
              <div className="kfind-tags">
                {g.tags.slice(0, 6).map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <button
              className="btn primary kfind-dl"
              disabled={downloading === g.code}
              onClick={() => download(g.code)}
            >
              {downloading === g.code ? '받는 중…' : '⬇ 다운로드'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
