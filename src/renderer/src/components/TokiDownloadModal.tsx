import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useStore, useSeriesRoots } from '../store'
import { groupSeries, chapterNum } from '../util'
import type { TokiChapter } from '../../../shared/ipc'
import { ChapterPicker, DownloadStatus } from './DownloadParts'
import type { HitomiProgress } from '../../../shared/ipc'

// Normalize a title to a comparison key (drop spaces + punctuation, lowercase),
// matching the clustering used by the series-merge tool.
const keyOf = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '')

export interface TokiSeriesRef {
  url: string
  title: string
}

type Phase = 'menu' | 'select' | 'downloading' | 'done' | 'error'

// Download launcher for a general-manga online series. Offers: whole series /
// pick chapters / auto-continue from the newest chapter already in the library.
export default function TokiDownloadModal({
  series,
  onClose
}: {
  series: TokiSeriesRef
  onClose: () => void
}): JSX.Element {
  const works = useStore((s) => s.works)
  const startDownload = useStore((s) => s.startDownload)
  const roots = useSeriesRoots()

  const [phase, setPhase] = useState<Phase>('menu')
  const [chapters, setChapters] = useState<TokiChapter[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [prog, setProg] = useState<{ done: number; total: number; label: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Chapters are needed for the pick list, the auto-continue count, and the
  // series-total display — fetch once when the modal opens.
  useEffect(() => {
    let alive = true
    window.api
      .tokiChapters(series.url)
      .then((c) => alive && setChapters(c))
      .catch((e) => alive && setLoadErr(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [series.url])

  // Live download progress for this series (code === series url on the channel).
  useEffect(() => {
    return window.api.onHitomiProgress((p: HitomiProgress) => {
      if (p.code !== series.url) return
      if (p.phase === 'downloading' || p.phase === 'fetching')
        setProg({ done: p.done, total: p.total, label: p.title })
    })
  }, [series.url])

  // Highest chapter number already sitting in the local general-manga library
  // for this series (matched by normalized title). 0 = nothing downloaded yet.
  const existingMax = useMemo(() => {
    const normal = works.filter((w) => (w.library ?? 'hitomi') === 'normal')
    const target = keyOf(series.title)
    let max = 0
    for (const g of groupSeries(normal, roots)) {
      if (keyOf(g.title) !== target) continue
      for (const c of g.chapters) {
        const n = chapterNum(c.path.split(/[\\/]/).pop() ?? '') ?? chapterNum(c.title) ?? 0
        if (n > max) max = n
      }
    }
    return max
  }, [works, roots, series.title])

  const nextChapters = useMemo(
    () => (chapters ?? []).filter((c) => c.num > existingMax),
    [chapters, existingMax]
  )

  const run = async (which: 'all' | 'selected' | 'continue'): Promise<void> => {
    let urls: string[] | null = null
    if (which === 'selected') {
      urls = [...selected]
      if (!urls.length) return
    } else if (which === 'continue') {
      urls = nextChapters.map((c) => c.url)
      if (!urls.length) {
        setErr('이미 최신 화까지 받았습니다.')
        setPhase('error')
        return
      }
    }
    setPhase('downloading')
    setErr(null)
    setProg({ done: 0, total: urls ? urls.length : chapters?.length ?? 0, label: '' })
    try {
      const created = await startDownload(
        urls
          ? { kind: 'toki', seriesUrl: series.url, title: series.title, chapterUrls: urls }
          : { kind: 'toki', seriesUrl: series.url, title: series.title }
      )
      if (!created) {
        setPhase('menu') // stopped by user
        return
      }
      setPhase('done')
    } catch (e: any) {
      setErr(String(e?.message ?? e))
      setPhase('error')
    }
  }

  const total = chapters?.length ?? 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal dl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{series.title}</h2>
          <button className="modal-x" onClick={onClose}>
            ✕
          </button>
        </div>

        {loadErr && <div className="warn err">{loadErr}</div>}

        {phase === 'menu' && (
          <div className="dl-menu">
            <p className="hint">
              {chapters == null
                ? '화 목록 불러오는 중…'
                : `전체 ${total}화 · 라이브러리 보유 ${existingMax || 0}화까지 · 이어받기 ${nextChapters.length}화`}
            </p>
            <button className="btn primary block" disabled={!chapters} onClick={() => run('all')}>
              시리즈 전체 다운로드 {chapters ? `(${total}화)` : ''}
            </button>
            <button className="btn block" disabled={!chapters} onClick={() => setPhase('select')}>
              선택 화 다운로드
            </button>
            <button
              className="btn block"
              disabled={!chapters || nextChapters.length === 0}
              onClick={() => run('continue')}
            >
              자동으로 이어서 다운로드{' '}
              {chapters ? (nextChapters.length ? `(${nextChapters.length}화)` : '(없음)') : ''}
            </button>
          </div>
        )}

        {phase === 'select' && (
          <div className="dl-select">
            <ChapterPicker
              chapters={chapters ?? []}
              selected={selected}
              setSelected={setSelected}
              onCancel={() => setPhase('menu')}
              onConfirm={() => run('selected')}
              confirmLabel={`확인 (${selected.size}화 받기)`}
            />
          </div>
        )}

        <DownloadStatus
          phase={phase}
          prog={prog}
          err={err}
          note="닫아도 백그라운드로 계속됩니다. (다운로드 탭에서 진행 확인)"
          onClose={onClose}
          onBack={() => setPhase('menu')}
        />
      </div>
    </div>
  )
}
