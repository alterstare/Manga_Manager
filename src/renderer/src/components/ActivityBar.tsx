import { useEffect, useRef } from 'react'
import type { JSX, ReactNode } from 'react'
import { useStore, downloadMode } from '../store'
import type { Job } from '../store'
import type { HitomiProgress } from '../../../shared/ipc'
import {
  PauseIcon,
  PlayIcon,
  XIcon,
  ConvertIcon,
  Download2Icon,
  DescriptionIcon,
  ScanIcon,
  EditIcon,
  AddPhotoIcon,
  FolderIcon
} from './icons'

// Unified row for the activity list: background jobs (export/scan) merged with the
// online downloads (which also carry the avif→webp conversion on the same row).
interface Row {
  id: string
  icon: ReactNode
  title: string
  status: 'running' | 'done' | 'error'
  done: number
  total: number
  detail?: string
  error?: string
  // Set only for download rows — drives the phase label + stop/retry/remove controls.
  dl?: { code: string; phase: HitomiProgress['phase']; canStop: boolean; canRetry: boolean }
}

const KIND_ICON: Record<Job['kind'], ReactNode> = {
  export: <DescriptionIcon />,
  scan: <ScanIcon />,
  meta: <EditIcon />,
  thumb: <AddPhotoIcon />,
  organize: <FolderIcon />,
  convert: <ConvertIcon />
}

const ACTIVE = new Set<HitomiProgress['phase']>(['queued', 'fetching', 'downloading', 'enriching'])

function pct(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
}

// The global bottom bar + slide-up panel. Always mounted; hides itself when there
// has been no activity at all this session.
export default function ActivityBar(): JSX.Element | null {
  const jobs = useStore((s) => s.jobs)
  const downloads = useStore((s) => s.downloads)
  const open = useStore((s) => s.activityOpen)
  const toggle = useStore((s) => s.toggleActivity)
  const clearDone = useStore((s) => s.clearDoneJobs)
  const stopDownload = useStore((s) => s.stopDownload)
  const retryDownload = useStore((s) => s.retryDownload)
  const removeDownload = useStore((s) => s.removeDownload)
  const stopAll = useStore((s) => s.stopAllDownloads)
  const startAll = useStore((s) => s.startAllDownloads)
  const listWidth = useStore((s) => s.listWidth)
  const libraryMode = useStore((s) => s.libraryMode)
  const update = useStore((s) => s.update)
  const installUpdate = useStore((s) => s.installUpdate)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Clicking anywhere outside the activity widget closes the open panel.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) toggle()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, toggle])

  // The bar is per-mode: hitomi vs general-manga tasks don't mix.
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
    ...downloads
      .filter((d) => downloadMode(d.code) === libraryMode)
      .map((d) => ({
        id: `dl:${d.code}`,
        icon: <Download2Icon />,
        title: d.title,
        status: (d.phase === 'done' ? 'done' : d.phase === 'error' ? 'error' : 'running') as Row['status'],
        done: d.done,
        total: d.total,
        detail: d.phase,
        error: d.error,
        dl: {
          code: d.code,
          phase: d.phase,
          canStop: ACTIVE.has(d.phase),
          canRetry: (d.phase === 'stopped' || d.phase === 'error') && !!d.spec
        }
      }))
  ]
  rows.sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1))

  // The auto-update row is global (not per-mode) and can appear on its own.
  const showUpdate = !!update && update.state !== 'error'
  const updateLabel = !update
    ? ''
    : update.state === 'downloading'
      ? `⬆ 업데이트 다운로드 중 · ${update.percent ?? 0}%`
      : update.state === 'downloaded'
        ? `⬆ 업데이트 준비됨${update.version ? ` · v${update.version}` : ''} — 지금 재시작`
        : `⬆ 새 버전 발견${update.version ? ` · v${update.version}` : ''}`

  if (rows.length === 0 && !showUpdate) return null

  const running = rows.filter((r) => r.status === 'running')
  const cur = running[0]
  const summary = showUpdate
    ? updateLabel
    : cur
      ? `${cur.title}${cur.total > 0 ? ` · ${pct(cur.done, cur.total)}%` : ' · 진행 중…'}`
      : `작업 ${rows.length}개 · 진행 중 없음`
  const anyActive = downloads.some((d) => downloadMode(d.code) === libraryMode && ACTIVE.has(d.phase))
  const anyPaused = downloads.some(
    (d) => downloadMode(d.code) === libraryMode && (d.phase === 'stopped' || d.phase === 'error') && d.spec
  )

  // Phase-aware sub label for download rows.
  const subLabel = (r: Row): string => {
    if (r.dl?.phase === 'converting') return r.total > 0 ? `webp 변환 ${r.done}/${r.total}` : 'webp 변환 중…'
    if (r.dl?.phase === 'stopped') return '일시정지됨'
    if (r.status === 'error') return `오류: ${r.error ?? '실패'}`
    if (r.status === 'done') return r.detail ?? '완료'
    return r.total > 0 ? `${r.done}/${r.total} (${pct(r.done, r.total)}%)` : r.detail ?? '진행 중…'
  }

  return (
    <div className="activity" ref={wrapRef}>
      {open && (
        <div className="activity-panel" style={{ width: Math.max(listWidth, 340) + 48 }}>
          <div className="activity-panel-head">
            <span>작업 목록 ({rows.length})</span>
            <div className="activity-head-actions">
              <button
                className="mini"
                title="전체 일시정지"
                onClick={() => stopAll(libraryMode)}
                disabled={!anyActive}
              >
                <PauseIcon />
              </button>
              <button
                className="mini"
                title="전체 시작"
                onClick={() => startAll(libraryMode)}
                disabled={!anyPaused}
              >
                <PlayIcon />
              </button>
              <button className="mini" onClick={clearDone} disabled={running.length === rows.length}>
                완료 지우기
              </button>
            </div>
          </div>
          <div className="activity-panel-list">
            {showUpdate && update && (
              <div className="activity-row update">
                <span className="activity-row-icon">⬆</span>
                <div className="activity-row-main">
                  <div className="activity-row-title">
                    {update.state === 'downloaded'
                      ? '업데이트 준비됨'
                      : update.state === 'downloading'
                        ? '업데이트 다운로드 중'
                        : '새 버전 발견'}
                    {update.version ? ` · v${update.version}` : ''}
                  </div>
                  <div className="activity-row-sub">
                    {update.state === 'downloaded'
                      ? '재시작하면 새 버전으로 설치됩니다.'
                      : update.state === 'downloading'
                        ? `${update.percent ?? 0}%`
                        : '자동으로 다운로드를 시작합니다…'}
                  </div>
                  {(update.state === 'downloading' || update.state === 'downloaded') && (
                    <div className="activity-bar-track">
                      <div
                        className="activity-bar-fill"
                        style={{ width: update.state === 'downloaded' ? '100%' : `${update.percent ?? 0}%` }}
                      />
                    </div>
                  )}
                </div>
                {update.state === 'downloaded' && (
                  <div className="activity-row-actions">
                    <button
                      className="mini"
                      onClick={(e) => {
                        e.stopPropagation()
                        installUpdate()
                      }}
                    >
                      지금 재시작
                    </button>
                  </div>
                )}
              </div>
            )}
            {rows.map((r) => (
              <div key={r.id} className={`activity-row ${r.status} ${r.dl?.phase === 'converting' ? 'converting' : ''}`}>
                <span className="activity-row-icon">
                  {r.dl?.phase === 'converting' ? <ConvertIcon /> : r.icon}
                </span>
                <div className="activity-row-main">
                  <div className="activity-row-title" title={r.title}>
                    {r.title}
                  </div>
                  <div className="activity-row-sub">{subLabel(r)}</div>
                  {(r.status === 'running' || r.status === 'done') && (
                    <div className="activity-bar-track">
                      <div
                        className={`activity-bar-fill ${r.total === 0 && r.status === 'running' ? 'indet' : ''}`}
                        style={{ width: r.status === 'done' ? '100%' : `${pct(r.done, r.total)}%` }}
                      />
                    </div>
                  )}
                </div>
                {r.dl ? (
                  <div className="activity-row-actions">
                    {r.dl.canStop && (
                      <button
                        className="mini icon"
                        title="일시정지"
                        onClick={(e) => {
                          e.stopPropagation()
                          stopDownload(r.dl!.code)
                        }}
                      >
                        <PauseIcon />
                      </button>
                    )}
                    {r.dl.canRetry && (
                      <button
                        className="mini icon"
                        title={r.dl.phase === 'error' ? '다시 시도' : '이어받기'}
                        onClick={(e) => {
                          e.stopPropagation()
                          retryDownload(r.dl!.code)
                        }}
                      >
                        <PlayIcon />
                      </button>
                    )}
                    <button
                      className="mini icon danger"
                      title="취소 · 목록에서 제거"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeDownload(r.dl!.code)
                      }}
                    >
                      <XIcon />
                    </button>
                  </div>
                ) : (
                  <span className="activity-row-status">
                    {r.status === 'running' ? '진행' : r.status === 'done' ? '완료' : '오류'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="activity-bar" onClick={() => toggle()}>
        <span className="activity-bar-summary">{summary}</span>
        {running.length > 0 && <span className="activity-bar-count">{running.length}개 진행</span>}
        <span className="activity-bar-btns" onClick={(e) => e.stopPropagation()}>
          {update?.state === 'downloaded' && (
            <button className="mini" title="업데이트 설치 후 재시작" onClick={() => installUpdate()}>
              지금 재시작
            </button>
          )}
          <button className="mini icon" title="전체 일시정지" onClick={() => stopAll(libraryMode)} disabled={!anyActive}>
            <PauseIcon />
          </button>
          <button className="mini icon" title="전체 시작" onClick={() => startAll(libraryMode)} disabled={!anyPaused}>
            <PlayIcon />
          </button>
        </span>
        <span className="activity-bar-caret">{open ? '▾' : '▴'}</span>
      </div>
    </div>
  )
}
