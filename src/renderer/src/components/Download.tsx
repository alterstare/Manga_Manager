import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore, downloadMode } from '../store'
import type { Job } from '../store'
import type { HitomiMeta } from '../../../shared/types'
import type { HitomiProgress } from '../../../shared/ipc'

// One merged activity entry: background jobs (export/scan) + online downloads.
interface Row {
  id: string
  icon: string
  title: string
  status: 'running' | 'done' | 'error'
  done: number
  total: number
  detail?: string
  error?: string
  // Set only for online-download rows — drives the phase label + stop/retry
  // controls. Jobs (export/scan) leave it undefined.
  dl?: { code: string; phase: HitomiProgress['phase']; canRetry: boolean }
}
const KIND_ICON: Record<Job['kind'], string> = {
  export: '📄',
  scan: '🔄',
  meta: '🖋',
  thumb: '🖼',
  organize: '🗂',
  convert: '♻'
}
const rowPct = (done: number, total: number): number =>
  total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
// Phases where a download is in flight (can be stopped but not retried).
const activePhase = new Set<HitomiProgress['phase']>([
  'queued',
  'fetching',
  'downloading',
  'enriching'
])

export default function Download(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const libraryMode = useStore((s) => s.libraryMode)
  const goBrowse = useStore((s) => s.goBrowse)
  const openTab = useStore((s) => s.openTab)
  const startDownload = useStore((s) => s.startDownload)
  const stopDownload = useStore((s) => s.stopDownload)
  const retryDownload = useStore((s) => s.retryDownload)
  const stopAllDownloads = useStore((s) => s.stopAllDownloads)
  const startAllDownloads = useStore((s) => s.startAllDownloads)
  const allDownloads = useStore((s) => s.downloads)
  const jobs = useStore((s) => s.jobs)
  const clearDone = useStore((s) => s.clearDoneJobs)
  // Show only this mode's downloads (doujin vs general-manga are separate lists).
  const downloads = allDownloads.filter((d) => downloadMode(d.code) === libraryMode)
  // Full activity list for this mode: jobs + downloads, running first, history kept.
  const rows: Row[] = [
    ...jobs
      .filter((j) => j.mode === libraryMode)
      .map((j) => ({
        id: j.id,
        icon: KIND_ICON[j.kind],
        title: j.title,
        status: j.status,
        done: j.done,
        total: j.total,
        detail: j.detail,
        error: j.error
      })),
    ...downloads.map((d) => ({
      id: `dl:${d.code}`,
      icon: '⬇',
      title: d.title || d.code,
      status: (d.phase === 'done' ? 'done' : d.phase === 'error' ? 'error' : 'running') as Row['status'],
      done: d.done,
      total: d.total,
      detail: d.phase,
      error: d.error,
      dl: { code: d.code, phase: d.phase, canRetry: !!d.spec }
    }))
  ]
  rows.sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1))
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<HitomiMeta | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<HitomiProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return window.api.onHitomiProgress((p) => {
      setProgress(p)
      if (p.phase === 'error') setError(`다운로드 실패 (code:${p.code})`)
    })
  }, [])

  const destReady = !!(settings.downloadDir ?? settings.libraryRoots[0])

  const fetchPreview = async (): Promise<void> => {
    setError(null)
    setPreview(null)
    const code = (input.match(/\d{5,}/) ?? [])[0]
    if (!code) {
      setError('코드를 찾을 수 없습니다 (숫자 코드 또는 작품 주소 입력)')
      return
    }
    setBusy(true)
    try {
      setPreview(await window.api.hitomiFetchMeta(code))
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const download = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const works = await startDownload({ kind: 'hitomi', input })
      if (works?.[0]) openTab(works[0].id)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="download">
      <aside className="dl-list">
        <div className="dl-list-head">
          <h2 className="dl-list-title">작업 목록</h2>
          <button className="mini" onClick={clearDone} disabled={!rows.length || rows.every((r) => r.status === 'running')}>
            완료 항목 지우기
          </button>
        </div>
        {downloads.length > 0 && (
          <div className="dl-list-actions">
            <button
              className="mini"
              onClick={() => stopAllDownloads(libraryMode)}
              disabled={!downloads.some((d) => activePhase.has(d.phase))}
            >
              ■ 전체 정지
            </button>
            <button
              className="mini"
              onClick={() => startAllDownloads(libraryMode)}
              disabled={!downloads.some((d) => (d.phase === 'stopped' || d.phase === 'error') && d.spec)}
            >
              ▶ 전체 시작
            </button>
          </div>
        )}
        {rows.length === 0 && <div className="dl-list-empty">작업 기록이 없습니다. 다운로드·내보내기·라이브러리 갱신이 여기에 표시됩니다.</div>}
        {rows.map((r) => {
          const pct = rowPct(r.done, r.total)
          const phase = r.dl?.phase
          // Download rows carry phase-specific labels (대기 중/정지됨); jobs fall
          // back to the coarse running/done/error status.
          const status =
            phase === 'stopped'
              ? { cls: 'stopped', label: '⏸ 정지됨' }
              : phase === 'queued'
                ? { cls: 'busy', label: '대기 중' }
                : phase === 'converting'
                  ? { cls: 'busy', label: r.total > 0 ? `webp 변환 ${pct}%` : 'webp 변환 중' }
                  : r.status === 'done'
                    ? { cls: 'ok', label: '✓ 완료' }
                    : r.status === 'error'
                      ? { cls: 'err', label: '✗ 실패' }
                      : { cls: 'busy', label: r.total > 0 ? `${pct}%` : '진행 중' }
          const active = phase ? activePhase.has(phase) : false
          const canRetry = r.dl?.canRetry && (phase === 'stopped' || phase === 'error')
          // A clean failure line instead of the raw error/stack (요청 사항).
          const errText =
            r.dl && phase === 'error' ? `다운로드 실패 (code:${r.dl.code})` : r.error
          return (
            <div key={r.id} className={`dl-item ${status.cls}`}>
              <div className="dl-item-top">
                <span className="dl-item-title">
                  {r.icon} {r.title}
                </span>
                <span className={`dl-item-status ${status.cls}`}>{status.label}</span>
              </div>
              <div className="dl-item-bar">
                <div
                  className="dl-item-fill"
                  style={{ width: r.status === 'done' ? '100%' : `${pct}%` }}
                />
              </div>
              <div className="dl-item-meta">
                <span>
                  {phase === 'stopped'
                    ? '정지됨'
                    : r.total > 0
                      ? `${r.done}/${r.total}`
                      : r.detail ?? '…'}
                </span>
                {(r.status === 'error' || phase === 'stopped') && errText && (
                  <span className="dl-item-err">{errText}</span>
                )}
                {r.dl && (active || canRetry) && (
                  <span className="dl-item-actions">
                    {active && (
                      <button className="mini" onClick={() => stopDownload(r.dl!.code)}>
                        ■ 정지
                      </button>
                    )}
                    {canRetry && (
                      <button className="mini" onClick={() => retryDownload(r.dl!.code)}>
                        ▶ 재시도
                      </button>
                    )}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </aside>

      {libraryMode === 'normal' ? (
        <div className="download-inner">
          <div className="badge">MANGA&amp;WEBTOON</div>
          <h1>일반 만화 다운로드</h1>
          <p className="sub">
            온라인 둘러보기의 작품 카드 <b>⬇ 다운로드</b> 버튼에서 <b>시리즈 전체 / 선택 화 / 자동 이어서</b>
            받기를 고를 수 있습니다. 감상창 상단의 <b>⬇ 전체 다운로드</b>로도 저장됩니다. 진행 상황은 왼쪽
            목록에 표시됩니다. (저장 위치: 설정 · 일반 만화의 <b>다운로드 폴더</b> → 즐겨찾기 폴더 → 첫 번째
            일반 만화 폴더 순.)
          </p>
          <button className="btn primary" onClick={goBrowse}>
            온라인 둘러보기 열기
          </button>
        </div>
      ) : (
      <div className="download-inner">
        <div className="badge">DOUJINSHI</div>
        <h1>동인지 다운로드</h1>
        <p className="sub">갤러리 코드 또는 주소를 붙여넣으세요. 메타데이터(작가·태그·언어)도 함께 저장됩니다.</p>

        {!destReady && (
          <div className="warn">⚠ 설정에서 다운로드 폴더(또는 라이브러리 폴더)를 먼저 지정하세요.</div>
        )}

        <div className="search-row">
          <input
            className="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchPreview()}
            placeholder="예: 2421331  또는  작품 주소"
          />
          <button className="btn" onClick={fetchPreview} disabled={busy}>
            미리보기
          </button>
          <button className="btn primary" onClick={download} disabled={busy || !destReady}>
            다운로드
          </button>
        </div>

        {error && <div className="warn err">{error}</div>}

        {progress && progress.phase !== 'error' && progress.phase !== 'stopped' && (
          <div className="dl-progress">
            <div className="dl-bar">
              <div
                className="dl-bar-fill"
                style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }}
              />
            </div>
            <div className="dl-label">
              {progress.phase === 'queued' && '대기 중…'}
              {progress.phase === 'fetching' && '메타데이터 가져오는 중…'}
              {progress.phase === 'downloading' &&
                `${progress.title} — ${progress.done}/${progress.total}`}
              {progress.phase === 'done' && '완료 ✓'}
            </div>
          </div>
        )}

        {preview && (
          <div className="meta-card">
            <h2>{preview.title}</h2>
            {preview.japaneseTitle && <div className="jp">{preview.japaneseTitle}</div>}
            <div className="meta-row">
              <span>코드 {preview.code}</span>
              <span>{preview.pageCount} pages</span>
              {preview.language && <span className="lang">{preview.language}</span>}
              {preview.type && <span>{preview.type}</span>}
            </div>
            {preview.artists.length > 0 && (
              <div className="meta-row">작가: {preview.artists.join(', ')}</div>
            )}
            <div className="work-tags">
              {preview.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  )
}
