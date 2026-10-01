import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { Work } from '../../../shared/types'
import { useStore, useSeriesRoots } from '../store'
import { findDuplicateGroups, findTranslationPairs, pickKeeper } from '../dups'
import { groupSeries } from '../util'
import type { SeriesGroup } from '../util'
import { getCover, invalidate } from '../images'
import { hashAndSize } from '../exclude'
import Thumb from './Thumb'
import ConfirmModal from './ConfirmModal'
import Stepper from './Stepper'

export default function Manage(): JSX.Element {
  const mode = useStore((s) => s.manageMode)
  const goManage = useStore((s) => s.goManage)
  const goHome = useStore((s) => s.goHome)

  return (
    <div className="manage">
      <div className="manage-head">
        <button className="btn" onClick={goHome}>
          ← 홈
        </button>
        <div className="manage-tabs">
          <button
            className={`chip ${mode === 'duplicates' ? 'active' : ''}`}
            onClick={() => goManage('duplicates')}
          >
            중복 작품
          </button>
          <button
            className={`chip ${mode === 'translations' ? 'active' : ''}`}
            onClick={() => goManage('translations')}
          >
            번역본 정리
          </button>
          <button
            className={`chip ${mode === 'merge' ? 'active' : ''}`}
            onClick={() => goManage('merge')}
          >
            시리즈 병합
          </button>
          <button
            className={`chip ${mode === 'collections' ? 'active' : ''}`}
            onClick={() => goManage('collections')}
          >
            작가 컬렉션
          </button>
        </div>
      </div>
      {mode === 'duplicates' ? (
        <Duplicates />
      ) : mode === 'translations' ? (
        <Translations />
      ) : mode === 'collections' ? (
        <Collections />
      ) : (
        <MergeSeries />
      )}
    </div>
  )
}

// General-manga: surface same-titled series split across multiple folders and
// let the user fuse each into one series folder. Detection clusters the current
// series groups by normalized title; a cluster of 2+ folders is a candidate.
function MergeSeries(): JSX.Element {
  const works = useStore((s) => s.works)
  const upsertWork = useStore((s) => s.upsertWork)
  const openTab = useStore((s) => s.openTab)
  const roots = useSeriesRoots()
  const [busy, setBusy] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const normal = works.filter((w) => (w.library ?? 'hitomi') === 'normal')
    const buckets = new Map<string, SeriesGroup[]>()
    for (const s of groupSeries(normal, roots)) {
      const key = s.title.toLowerCase().replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '')
      if (!key) continue
      const arr = buckets.get(key) ?? []
      arr.push(s)
      buckets.set(key, arr)
    }
    return [...buckets.values()].filter((v) => v.length >= 2)
  }, [works, roots])

  const titleOf = (groups: SeriesGroup[]): string =>
    [...groups.map((g) => g.title)].sort((a, b) => b.length - a.length)[0]

  const merge = async (groups: SeriesGroup[]): Promise<void> => {
    const title = titleOf(groups)
    const ids = groups.flatMap((g) => g.chapters.map((c) => c.id))
    setBusy(title)
    try {
      const updated = await window.api.mergeSeries(title, ids)
      for (const w of updated) upsertWork(w)
    } catch (e: any) {
      alert(String(e?.message ?? e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="manage-body">
      <p className="hint">
        같은 제목인데 여러 폴더로 나뉜 일반 만화 시리즈를 찾습니다. “하나로 병합”하면 각 화 폴더가
        하나의 시리즈 폴더(루트/제목) 아래로 이동합니다.
      </p>
      <div className="manage-actions">
        <span className="hint" style={{ margin: 0 }}>
          병합 후보 {candidates.length}개
        </span>
      </div>
      {candidates.length === 0 && <div className="empty">나뉘어 있는 동일 시리즈가 없습니다.</div>}
      {candidates.map((groups, i) => {
        const title = titleOf(groups)
        const total = groups.reduce((n, g) => n + g.chapters.length, 0)
        return (
          <div className="dup-group" key={i}>
            <div className="dup-group-head">
              {title} · {groups.length}개 폴더 · 총 {total}화
              <button
                className="mini primary"
                style={{ marginLeft: 8 }}
                disabled={busy !== null}
                onClick={() => merge(groups)}
              >
                {busy === title ? '병합 중…' : '하나로 병합'}
              </button>
            </div>
            <div className="dup-row">
              {groups.map((g) => (
                <ManageCard
                  key={g.key}
                  work={g.chapters[0]}
                  badge={`${g.chapters.length}화`}
                  open={() => openTab(g.chapters[0].id)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Compute + persist the cover dHash (and size) for works missing it.
async function scanCoverHashes(
  works: Work[],
  upsertWork: (w: Work) => void,
  onProg: (done: number, total: number) => void
): Promise<void> {
  const targets = works.filter((w) => !w.coverHash)
  for (let i = 0; i < targets.length; i++) {
    try {
      const cover = await getCover(targets[i].id)
      if (cover) {
        const r = await hashAndSize(cover)
        if (r) upsertWork(await window.api.setCoverHash(targets[i].id, r.hash, r.w, r.h))
      }
    } catch {
      /* skip unreadable cover */
    }
    onProg(i + 1, targets.length)
  }
}

function Duplicates(): JSX.Element {
  const allWorks = useStore((s) => s.works)
  const libraryMode = useStore((s) => s.libraryMode)
  // Only dedupe within the current library mode — hitomi and general manga are
  // separate collections and must not appear mixed here.
  const works = useMemo(
    () => allWorks.filter((w) => (w.library ?? 'hitomi') === libraryMode),
    [allWorks, libraryMode]
  )
  const upsertWork = useStore((s) => s.upsertWork)
  const removeWork = useStore((s) => s.removeWork)
  const openTab = useStore((s) => s.openTab)
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [scanned, setScanned] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)

  const groups = useMemo(() => findDuplicateGroups(works), [works])
  const missing = useMemo(() => works.filter((w) => !w.coverHash).length, [works])

  // Pre-select every non-keeper for deletion whenever the groups change.
  useEffect(() => {
    const s = new Set<string>()
    for (const g of groups) {
      const keep = pickKeeper(g).id
      for (const w of g) if (w.id !== keep) s.add(w.id)
    }
    setSelected(s)
  }, [groups])

  const scanHashes = async (): Promise<void> => {
    setProg({ done: 0, total: works.filter((w) => !w.coverHash).length })
    await scanCoverHashes(works, upsertWork, (done, total) => setProg({ done, total }))
    setProg(null)
    setScanned(true)
  }

  const toggle = (id: string): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const deleteSelected = async (): Promise<void> => {
    const ids = [...selected]
    setConfirmBulk(false)
    if (!ids.length) return
    for (const id of ids) {
      await window.api.deleteWork(id)
      invalidate(id)
      removeWork(id)
    }
    setSelected(new Set())
  }

  return (
    <div className="manage-body">
      <p className="hint">
        같은 표지(첫 장) 또는 같은 제목인 작품을 중복으로 묶습니다. 페이지수는 참고용. 표지 비교는
        먼저 “표지 해시 생성”이 필요합니다(작품당 첫 장 1회 계산, 캐시됨).
      </p>
      <div className="manage-actions">
        <button className="btn primary" onClick={scanHashes} disabled={prog !== null}>
          {prog ? `표지 해시 생성… ${prog.done}/${prog.total}` : `표지 해시 생성${missing ? ` (${missing}개 남음)` : ' (완료)'}`}
        </button>
        <button className="btn danger" onClick={() => setConfirmBulk(true)} disabled={!selected.size}>
          선택 {selected.size}개 삭제
        </button>
        <span className="hint" style={{ margin: 0 }}>
          중복 그룹 {groups.length}개
        </span>
      </div>

      {groups.length === 0 && (scanned || missing === 0) && (
        <div className="empty">중복으로 보이는 작품이 없습니다.</div>
      )}

      {groups.map((g, gi) => {
        const keep = pickKeeper(g).id
        return (
          <div className="dup-group" key={gi}>
            <div className="dup-group-head">
              그룹 {gi + 1} · {g.length}개 · 보존: {g.find((w) => w.id === keep)?.title}
            </div>
            <div className="dup-row">
              {g.map((w) => (
                <ManageCard
                  key={w.id}
                  work={w}
                  open={() => openTab(w.id)}
                  badge={w.id === keep ? '보존 추천' : undefined}
                  checked={selected.has(w.id)}
                  onCheck={() => toggle(w.id)}
                />
              ))}
            </div>
          </div>
        )
      })}

      {confirmBulk && (
        <ConfirmModal
          danger
          icon="🗑"
          title="선택한 작품을 삭제할까요?"
          desc={<>선택한 {selected.size}개 작품 폴더를 영구 삭제합니다. 되돌릴 수 없습니다.</>}
          confirmLabel="삭제"
          cancelLabel="취소"
          onConfirm={deleteSelected}
          onCancel={() => setConfirmBulk(false)}
        />
      )}
    </div>
  )
}

function Translations(): JSX.Element {
  const allWorks = useStore((s) => s.works)
  const libraryMode = useStore((s) => s.libraryMode)
  const works = useMemo(
    () => allWorks.filter((w) => (w.library ?? 'hitomi') === libraryMode),
    [allWorks, libraryMode]
  )
  const removeWork = useStore((s) => s.removeWork)
  const upsertWork = useStore((s) => s.upsertWork)
  const openTab = useStore((s) => s.openTab)
  const pairs = useMemo(() => findTranslationPairs(works), [works])
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [pendingDel, setPendingDel] = useState<{ id: string; title: string } | null>(null)
  const missing = useMemo(() => works.filter((w) => !w.coverHash).length, [works])

  const del = (id: string, title: string): void => setPendingDel({ id, title })
  const confirmDel = async (): Promise<void> => {
    if (!pendingDel) return
    const { id } = pendingDel
    setPendingDel(null)
    await window.api.deleteWork(id)
    invalidate(id)
    removeWork(id)
  }
  const scan = async (): Promise<void> => {
    setProg({ done: 0, total: missing })
    await scanCoverHashes(works, upsertWork, (done, total) => setProg({ done, total }))
    setProg(null)
  }

  return (
    <div className="manage-body">
      <p className="hint">
        라이브러리 안에서 (한국어가 아닌 작품 ↔ 같은 작품의 한국어 번역본)으로 보이는 쌍을 찾습니다.
        작가 동일(작가 미상 작품 제외) + 제목 유사도 또는 같은 표지 기준. 표지 비교를 쓰려면 아래
        “표지 해시 생성”을 먼저 실행하세요.
      </p>
      <div className="manage-actions">
        <button className="btn primary" onClick={scan} disabled={prog !== null}>
          {prog ? `표지 해시 생성… ${prog.done}/${prog.total}` : `표지 해시 생성${missing ? ` (${missing}개 남음)` : ' (완료)'}`}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          번역본 쌍 {pairs.length}개
        </span>
      </div>
      {pairs.length === 0 && <div className="empty">매칭되는 한국어 번역본 쌍이 없습니다.</div>}
      {pairs.map((p, i) => (
        <div className="dup-group" key={i}>
          <div className="dup-group-head">
            {p.source.language ?? '기타'} 원본 ↔ 한국어 번역본 {p.matches.length}개
          </div>
          <div className="dup-row">
            <ManageCard work={p.source} badge="원본" open={() => openTab(p.source.id)} onDelete={() => del(p.source.id, p.source.title)} />
            <span className="trans-arrow">→</span>
            {p.matches.map((k) => (
              <ManageCard key={k.id} work={k} badge="한국어" open={() => openTab(k.id)} onDelete={() => del(k.id, k.title)} />
            ))}
          </div>
        </div>
      ))}

      {pendingDel && (
        <ConfirmModal
          danger
          icon="🗑"
          title="작품을 삭제할까요?"
          desc={<><b>{pendingDel.title}</b> 폴더를 영구 삭제합니다. 되돌릴 수 없습니다.</>}
          confirmLabel="삭제"
          cancelLabel="취소"
          onConfirm={confirmDel}
          onCancel={() => setPendingDel(null)}
        />
      )}
    </div>
  )
}

// Path helpers (renderer-side; Windows paths). normKey compares case-insensitively.
function normKey(p: string): string {
  return p.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()
}
function splitSegs(p: string): string[] {
  return p.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').split('\\')
}
// The immediate child of a flatten root that contains `path` ("artist folder"),
// or null. Keeps original casing for display; matches roots case-insensitively.
function artistFolderOf(
  path: string,
  roots: string[]
): { key: string; dir: string; name: string } | null {
  const ps = splitSegs(path)
  for (const r of roots) {
    const rs = splitSegs(r)
    if (ps.length <= rs.length) continue
    let ok = true
    for (let i = 0; i < rs.length; i++)
      if (ps[i].toLowerCase() !== rs[i].toLowerCase()) {
        ok = false
        break
      }
    if (!ok) continue
    const name = ps[rs.length]
    const dir = [...rs, name].join('\\')
    return { key: dir.toLowerCase(), dir, name }
  }
  return null
}

// Manual collection manager: consolidate small "artist folder" chapters into one
// "<artist> collection" work. Mirrors the duplicate-cleanup UX — you eyeball
// thumbnails + page counts, then merge. Merges persist in settings and survive
// rescans (see settings.manualCollections / scanner.applyCollections).
function Collections(): JSX.Element {
  const allWorks = useStore((s) => s.works)
  const libraryMode = useStore((s) => s.libraryMode)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setWorks = useStore((s) => s.setWorks)
  const openTab = useStore((s) => s.openTab)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // opened artist folders
  const [thr, setThr] = useState<Record<string, number>>({}) // per-artist merge threshold
  const toggleOpen = (dir: string): void =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(dir)) n.delete(dir)
      else n.add(dir)
      return n
    })

  const works = useMemo(
    () => allWorks.filter((w) => (w.library ?? 'hitomi') === libraryMode),
    [allWorks, libraryMode]
  )
  const roots = settings.flattenRoots ?? []

  const collections = useMemo(() => works.filter((w) => w.sources?.length), [works])

  // Candidate groups: non-collection works under an artist folder.
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; dir: string; works: Work[] }>()
    for (const w of works) {
      if (w.sources?.length) continue
      const af = artistFolderOf(w.path, roots)
      if (!af) continue
      const g = m.get(af.key) ?? { name: af.name, dir: af.dir, works: [] }
      g.works.push(w)
      m.set(af.key, g)
    }
    return [...m.values()]
      .filter((g) => g.works.length >= 2)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [works, roots])

  const manualMatch = (w: Work): number => {
    const src = new Set((w.sources ?? []).map(normKey))
    return (settings.manualCollections ?? []).findIndex(
      (c) => c.dirs.length > 0 && c.dirs.every((d) => src.has(normKey(d)))
    )
  }

  const toggle = (id: string): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const rescan = async (): Promise<void> => {
    setBusy(true)
    try {
      setWorks(await window.api.scanLibrary())
    } finally {
      setBusy(false)
    }
  }

  const doMerge = async (name: string, dirs: string[]): Promise<void> => {
    if (dirs.length < 2) {
      alert('병합하려면 폴더가 2개 이상 필요합니다.')
      return
    }
    const s = {
      ...settings,
      manualCollections: [
        ...(settings.manualCollections ?? []),
        { title: `${name} collection`, artist: name, library: libraryMode, dirs }
      ]
    }
    await window.api.saveSettings(s)
    setSettings(s)
    setSelected(new Set())
    await rescan()
  }

  // Merge the selected folders (>=2 selected), else every folder in the group.
  const mergeGroup = (g: { name: string; works: Work[] }): Promise<void> => {
    const picked = g.works.filter((w) => selected.has(w.id))
    const chosen = picked.length >= 2 ? picked : g.works
    return doMerge(g.name, chosen.map((w) => w.path))
  }

  // Merge only the group's folders with pageCount <= n (per-artist threshold).
  const mergeByThreshold = (g: { name: string; works: Work[] }, n: number): Promise<void> =>
    doMerge(
      g.name,
      g.works.filter((w) => w.pageCount <= n).map((w) => w.path)
    )

  // Selection helpers scoped to one group.
  const invertSel = (g: { works: Work[] }): void =>
    setSelected((s) => {
      const n = new Set(s)
      for (const w of g.works) {
        if (n.has(w.id)) n.delete(w.id)
        else n.add(w.id)
      }
      return n
    })
  const clearSel = (g: { works: Work[] }): void =>
    setSelected((s) => {
      const n = new Set(s)
      for (const w of g.works) n.delete(w.id)
      return n
    })

  const unmerge = async (w: Work): Promise<void> => {
    const idx = manualMatch(w)
    if (idx < 0) return
    const s = {
      ...settings,
      manualCollections: (settings.manualCollections ?? []).filter((_, i) => i !== idx)
    }
    await window.api.saveSettings(s)
    setSettings(s)
    await rescan()
  }

  return (
    <div className="manage-body">
      <p className="hint">
        “작가 폴더” 아래의 작은 화 폴더들을 하나의 <b>‘작가 collection’</b>으로 병합합니다. 자동
        병합은 설정의 페이지 기준값({settings.flattenCollectThreshold ?? 0}p 이하)으로 동작하고, 여기서는
        직접 폴더를 골라 합칠 수 있습니다. 실제 파일은 옮기지 않고 보기에서만 묶습니다.
      </p>
      {roots.length === 0 && (
        <div className="empty">설정 → 히토미 → “작가 폴더”에서 폴더를 먼저 지정하세요.</div>
      )}

      {collections.length > 0 && (
        <div className="dup-group">
          <div className="dup-group-head">현재 컬렉션 {collections.length}개</div>
          <div className="dup-row">
            {collections.map((w) => {
              const manual = manualMatch(w) >= 0
              return (
                <ManageCard
                  key={w.id}
                  work={w}
                  open={() => openTab(w.id)}
                  badge={manual ? '수동' : '자동'}
                  onDelete={manual ? () => unmerge(w) : undefined}
                  deleteLabel="해제"
                />
              )
            })}
          </div>
        </div>
      )}

      {groups.map((g) => {
        const selCount = g.works.filter((w) => selected.has(w.id)).length
        const isOpen = expanded.has(g.dir)
        const n = thr[g.dir] ?? settings.flattenCollectThreshold ?? 1
        const nCount = g.works.filter((w) => w.pageCount <= n).length
        return (
          <div className="dup-group" key={g.dir}>
            <div
              className="dup-group-head coll-head"
              onClick={() => toggleOpen(g.dir)}
              role="button"
            >
              <span className="coll-caret">{isOpen ? '▾' : '▸'}</span>
              {g.name} · {g.works.length}개 폴더
              {isOpen && (
                <span className="coll-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="mini primary" disabled={busy} onClick={() => mergeGroup(g)}>
                    {busy ? '처리 중…' : selCount >= 2 ? `선택 ${selCount}개 병합` : '전체 병합'}
                  </button>
                  <span className="coll-thr">
                    <Stepper value={n} onChange={(v) => setThr((m) => ({ ...m, [g.dir]: v }))} />
                    페이지 이하
                    <button
                      className="mini"
                      disabled={busy || nCount < 2}
                      onClick={() => mergeByThreshold(g, n)}
                    >
                      병합{nCount ? ` (${nCount})` : ''}
                    </button>
                  </span>
                  {selCount > 0 && (
                    <button className="mini" onClick={() => clearSel(g)}>
                      선택 해제
                    </button>
                  )}
                  <button className="mini" onClick={() => invertSel(g)}>
                    선택 반전
                  </button>
                </span>
              )}
            </div>
            {isOpen && (
              <div className="dup-row">
                {g.works.map((w) => (
                  <ManageCard
                    key={w.id}
                    work={w}
                    open={() => openTab(w.id)}
                    checked={selected.has(w.id)}
                    onCheck={() => toggle(w.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
      {roots.length > 0 && groups.length === 0 && collections.length === 0 && (
        <div className="empty">병합할 작가 폴더가 없습니다.</div>
      )}
    </div>
  )
}

function ManageCard({
  work,
  open,
  badge,
  checked,
  onCheck,
  onDelete,
  deleteLabel
}: {
  work: Work
  open: () => void
  badge?: string
  checked?: boolean
  onCheck?: () => void
  onDelete?: () => void
  deleteLabel?: string
}): JSX.Element {
  return (
    <div className={`manage-card ${checked ? 'sel' : ''}`}>
      {onCheck && (
        <input className="manage-check" type="checkbox" checked={!!checked} onChange={onCheck} />
      )}
      <div className="manage-thumb" onClick={open}>
        <Thumb workId={work.id} />
      </div>
      {badge && <span className="manage-badge">{badge}</span>}
      <div className="manage-card-title">
        {work.title}
      </div>
      <div className="manage-card-meta">
        {work.pageCount}p{work.code && ` · [${work.code}]`}
        {work.language && ` · ${work.language}`}
        {work.artist && ` · ${work.artist}`}
      </div>
      <div className="manage-card-actions">
        <button className="mini" onClick={open}>
          열기
        </button>
        <button className="mini" onClick={() => window.api.openInExplorer(work.id)}>
          폴더
        </button>
        {onDelete && (
          <button className="mini danger" onClick={onDelete}>
            {deleteLabel ?? '삭제'}
          </button>
        )}
      </div>
    </div>
  )
}
