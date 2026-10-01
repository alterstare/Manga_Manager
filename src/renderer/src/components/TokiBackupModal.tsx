import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { TokiChapter, HitomiProgress } from '../../../shared/ipc'
import { ChapterPicker, DownloadStatus } from './DownloadParts'

// Backup (gnuboard-style) site downloader. The site isn't scraped into our
// browse UI — the user opens it as a plain web page, navigates to a chapter LIST
// page, then we read that page's chapter list and download (in the background,
// via the hidden window) to the general-manga folder.
export default function TokiBackupModal({ onClose }: { onClose: () => void }): JSX.Element {
  const startDownload = useStore((s) => s.startDownload)
  // No built-in address — the user enters the backup site themselves.
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [chapters, setChapters] = useState<TokiChapter[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<'setup' | 'downloading' | 'done' | 'error'>('setup')
  const [prog, setProg] = useState<{ done: number; total: number; label: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    return window.api.onHitomiProgress((p: HitomiProgress) => {
      if (p.code !== 'backup:' + title) return
      if (p.phase === 'downloading' || p.phase === 'fetching')
        setProg({ done: p.done, total: p.total, label: p.title })
    })
  }, [title])

  const openSite = (): void => {
    const u = url.trim()
    if (!u) {
      setErr('백업 사이트 주소를 입력하세요.')
      return
    }
    setErr(null)
    window.api.tokiOpenSite(/^https?:\/\//i.test(u) ? u : `https://${u}`)
  }

  const loadList = async (): Promise<void> => {
    setLoading(true)
    setErr(null)
    try {
      const list = await window.api.tokiScrapeList()
      setChapters(list)
      setSelected(new Set(list.map((c) => c.url))) // default: all selected
      if (!title && list.length) {
        // Guess a series title from the first chapter (drop trailing "N화 …").
        setTitle(list[0].title.replace(/\s*\d+\s*(?:화|회|장).*$/, '').trim() || '백업만화')
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const download = async (): Promise<void> => {
    if (!chapters || !selected.size) return
    const t = title.trim() || '백업만화'
    setPhase('downloading')
    setErr(null)
    setProg({ done: 0, total: selected.size, label: '' })
    try {
      const only = selected.size === chapters.length ? undefined : [...selected]
      const created = await startDownload({ kind: 'generic', title: t, chapters, only })
      if (!created) {
        setPhase('setup') // stopped by user
        return
      }
      setPhase('done')
    } catch (e: any) {
      setErr(String(e?.message ?? e))
      setPhase('error')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal dl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>비상용 사이트 다운로드</h2>
          <button className="modal-x" onClick={onClose}>
            ✕
          </button>
        </div>

        {phase === 'setup' && (
          <div className="dl-select">
            <p className="hint">
              구조가 다른 백업 사이트를 웹페이지로 열고, <b>여러 회차가 나열된
              목록 페이지</b>로 이동한 뒤 “현재 페이지 목록 불러오기”를 누르세요. 다운로드는
              백그라운드로 진행되어 사이트 창을 닫아도 됩니다.
            </p>
            <div className="search-row" style={{ marginBottom: 8 }}>
              <input
                className="search"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="백업 사이트 주소"
              />
              <button className="btn" onClick={openSite} disabled={!url.trim()}>
                사이트 열기
              </button>
            </div>
            <div className="search-row" style={{ marginBottom: 8 }}>
              <input
                className="search"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="저장 제목 (폴더 이름)"
              />
              <button className="btn primary" onClick={loadList} disabled={loading}>
                {loading ? '불러오는 중…' : '현재 페이지 목록 불러오기'}
              </button>
            </div>

            {err && <div className="warn err">{err}</div>}

            {chapters && chapters.length === 0 && (
              <div className="empty">
                목록을 찾지 못했습니다. 뷰어 화면이 아니라 회차 목록 페이지에서 다시 시도하세요.
              </div>
            )}

            {chapters && chapters.length > 0 && (
              <>
                <ChapterPicker
                  chapters={chapters}
                  selected={selected}
                  setSelected={setSelected}
                  onCancel={onClose}
                  onConfirm={download}
                  confirmLabel={`다운로드 (${selected.size}화)`}
                />
              </>
            )}
          </div>
        )}

        <DownloadStatus
          phase={phase}
          prog={prog}
          err={err}
          note="닫아도 백그라운드로 계속됩니다."
          onClose={onClose}
          onBack={() => setPhase('setup')}
        />
      </div>
    </div>
  )
}
