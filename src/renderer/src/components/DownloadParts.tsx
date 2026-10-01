// Shared pieces of the general-manga download modals (TokiDownloadModal for the
// main online site, TokiBackupModal for backup sites).
import type { Dispatch, JSX, SetStateAction } from 'react'
import type { TokiChapter } from '../../../shared/ipc'

// Checkbox list of chapters with 전체 선택 / 전체 해제 / 선택 반전 and a
// cancel / confirm footer. `selected` holds chapter urls.
export function ChapterPicker({
  chapters,
  selected,
  setSelected,
  onCancel,
  onConfirm,
  confirmLabel
}: {
  chapters: TokiChapter[]
  selected: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  onCancel: () => void
  onConfirm: () => void
  confirmLabel: string
}): JSX.Element {
  const toggle = (url: string): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(url)) n.delete(url)
      else n.add(url)
      return n
    })
  const invert = (): void => setSelected((s) => new Set(chapters.filter((c) => !s.has(c.url)).map((c) => c.url)))
  return (
    <>
      <div className="dl-select-bar">
        <button className="mini" onClick={() => setSelected(new Set(chapters.map((c) => c.url)))}>
          전체 선택
        </button>
        <button className="mini" onClick={() => setSelected(new Set())}>
          전체 해제
        </button>
        <button className="mini" onClick={invert}>
          선택 반전
        </button>
        <span className="hint" style={{ margin: 0 }}>
          {selected.size}/{chapters.length} 선택
        </span>
      </div>
      <div className="dl-chapter-list">
        {chapters.map((c) => (
          <label key={c.url} className={`dl-chapter ${selected.has(c.url) ? 'sel' : ''}`}>
            <input type="checkbox" checked={selected.has(c.url)} onChange={() => toggle(c.url)} />
            <span className="dl-chapter-title">{c.title || c.url}</span>
          </label>
        ))}
      </div>
      <div className="dl-select-foot">
        <button className="btn" onClick={onCancel}>
          취소
        </button>
        <button className="btn primary" disabled={!selected.size} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </>
  )
}

export type DownloadProg = { done: number; total: number; label: string }

// Progress / done / error box shown after a download starts. Renders nothing
// for other phases.
export function DownloadStatus({
  phase,
  prog,
  err,
  note,
  onClose,
  onBack
}: {
  phase: string
  prog: DownloadProg | null
  err: string | null
  note: string // reassurance under the progress bar
  onClose: () => void
  onBack: () => void
}): JSX.Element | null {
  if (phase === 'downloading')
    return (
      <div className="dl-progress-box">
        <div className="dl-bar">
          <div className="dl-bar-fill" style={{ width: prog?.total ? `${(prog.done / prog.total) * 100}%` : '10%' }} />
        </div>
        <p className="hint">
          다운로드 중… {prog ? `${prog.done}/${prog.total}` : ''} {prog?.label ?? ''}
        </p>
        <p className="hint">{note}</p>
      </div>
    )
  if (phase === 'done')
    return (
      <div className="dl-progress-box">
        <p className="dl-done-msg">✓ 다운로드 완료</p>
        <button className="btn primary" onClick={onClose}>
          닫기
        </button>
      </div>
    )
  if (phase === 'error')
    return (
      <div className="dl-progress-box">
        <div className="warn err">{err}</div>
        <button className="btn" onClick={onBack}>
          돌아가기
        </button>
      </div>
    )
  return null
}
