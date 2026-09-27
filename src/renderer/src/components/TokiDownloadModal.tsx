import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { groupSeries, chapterNum } from '../util'
import type { TokiChapter } from '../../../shared/ipc'
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
  const normalRootsSetting = useStore((s) => s.settings.normalRoots)
  const normalFav = useStore((s) => s.settings.normalFavoritesDir)
  const normalDl = useStore((s) => s.settings.normalDownloadDir)

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
    const roots = [...(normalRootsSetting ?? []), normalFav, normalDl].filter(Boolean) as string[]
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
  }, [works, normalRootsSetting, normalFav, normalDl, series.title])

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
  const toggle = (url: string): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(url)) n.delete(url)
      else n.add(url)
      return n
    })
  const selectAll = (): void => setSelected(new Set((chapters ?? []).map((c) => c.url)))
  const selectNone = (): void => setSelected(new Set())
  const invert = (): void =>
    setSelected((s) => {
      const n = new Set<string>()
      for (const c of chapters ?? []) if (!s.has(c.url)) n.add(c.url)
      return n
    })

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
            <div className="dl-select-bar">
              <button className="mini" onClick={selectAll}>
                전체 선택
              </button>
              <button className="mini" onClick={selectNone}>
                전체 해제
              </button>
              <button className="mini" onClick={invert}>
                선택 반전
              </button>
              <span className="hint" style={{ margin: 0 }}>
                {selected.size}/{total} 선택
              </span>
            </div>
            <div className="dl-chapter-list">
              {(chapters ?? []).map((c) => (
                <label key={c.url} className={`dl-chapter ${selected.has(c.url) ? 'sel' : ''}`}>
                  <input type="checkbox" checked={selected.has(c.url)} onChange={() => toggle(c.url)} />
                  <span className="dl-chapter-title">{c.title}</span>
                </label>
              ))}
            </div>
            <div className="dl-select-foot">
              <button className="btn" onClick={() => setPhase('menu')}>
                취소
              </button>
              <button className="btn primary" disabled={!selected.size} onClick={() => run('selected')}>
                확인 ({selected.size}화 받기)
              </button>
            </div>
          </div>
        )}

        {phase === 'downloading' && (
          <div className="dl-progress-box">
            <div className="dl-bar">
              <div
                className="dl-bar-fill"
                style={{ width: prog?.total ? `${(prog.done / prog.total) * 100}%` : '10%' }}
              />
            </div>
            <p className="hint">
              다운로드 중… {prog ? `${prog.done}/${prog.total}` : ''} {prog?.label ?? ''}
            </p>
            <p className="hint">닫아도 백그라운드로 계속됩니다. (다운로드 탭에서 진행 확인)</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="dl-progress-box">
            <p className="dl-done-msg">✓ 다운로드 완료</p>
            <button className="btn primary" onClick={onClose}>
              닫기
            </button>
          </div>
        )}

        {phase === 'error' && (
          <div className="dl-progress-box">
            <div className="warn err">{err}</div>
            <button className="btn" onClick={() => setPhase('menu')}>
              돌아가기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
