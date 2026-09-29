import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { Settings as SettingsT, GenreRule, SortMode } from '../../../shared/types'
import { DEFAULT_SETTINGS, SPLIT_SETTING_KEYS } from '../../../shared/types'
import { fillNamePattern, SAMPLE_FIELDS } from '../../../shared/pattern'
import { SORT_LABELS, groupSeries, analyzeSeries, effectiveChapterScheme, thumbTargetIds, tagToken } from '../util'
import { dHashFromImage, setExcluded } from '../exclude'
import { clearTranslation } from '../translate'
import { regenLocalThumb } from '../thumbs'
import Dropdown from './Dropdown'
import ConfirmModal from './ConfirmModal'
import Stepper from './Stepper'
import Toggle from './Toggle'
import SettingRow from './SettingRow'
import TagPickInput from './TagPickInput'
import TagSearchInput from './TagSearchInput'

// Base URL + a default vision model for each preset OpenAI-compatible provider.
const LLM_PRESETS: Record<string, { llmBaseUrl: string; llmModel: string } | null> = {
  groq: {
    llmBaseUrl: 'https://api.groq.com/openai/v1',
    llmModel: 'meta-llama/llama-4-scout-17b-16e-instruct'
  },
  openrouter: {
    llmBaseUrl: 'https://openrouter.ai/api/v1',
    llmModel: 'meta-llama/llama-4-maverick:free'
  },
  mistral: { llmBaseUrl: 'https://api.mistral.ai/v1', llmModel: 'pixtral-12b-2409' },
  custom: null
}

// Mutually-exclusive choice rendered as description cards (screenshot 225544):
// one card per option with a title, optional badge and a per-option description.
function RadioCards<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (v: T) => void
  options: { val: T; label: string; desc?: string; badge?: string }[]
}): JSX.Element {
  return (
    <div className="rcards">
      {options.map((o) => (
        <button
          key={o.val}
          type="button"
          className={`rcard ${value === o.val ? 'on' : ''}`}
          onClick={() => onChange(o.val)}
        >
          <span className="rcard-dot" />
          <span className="rcard-body">
            <span className="rcard-title">
              {o.label}
              {o.badge && <span className="rcard-badge">{o.badge}</span>}
            </span>
            {o.desc && <span className="rcard-desc">{o.desc}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

// Settings are grouped into 6 top categories (대분류). Each shows one or more
// boxes (중분류); a box carries a matching data-cat so CSS hides other categories.
type Cat = 'folder' | 'fav' | 'style' | 'translate' | 'network' | 'manage'
const CATS: { id: Cat; label: string; modes: ('hitomi' | 'normal')[] }[] = [
  { id: 'folder', label: '폴더·저장', modes: ['hitomi', 'normal'] },
  { id: 'fav', label: '태그·검색', modes: ['hitomi', 'normal'] },
  { id: 'style', label: '스타일·정렬', modes: ['hitomi', 'normal'] },
  { id: 'translate', label: '번역', modes: ['hitomi', 'normal'] },
  { id: 'network', label: '네트워크·다운로드', modes: ['hitomi', 'normal'] },
  { id: 'manage', label: '관리', modes: ['hitomi', 'normal'] }
]

export default function Settings(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const libraryMode = useStore((s) => s.libraryMode)
  const works = useStore((s) => s.works)
  const goHome = useStore((s) => s.goHome)
  const goManage = useStore((s) => s.goManage)
  const scanLibraryJob = useStore((s) => s.scanLibraryJob)
  const scanning = useStore((s) => s.loading)
  const setWorks = useStore((s) => s.setWorks)
  const setOnlineFavs = useStore((s) => s.setOnlineFavs)
  const bumpThumbNonce = useStore((s) => s.bumpThumbNonce)
  const upsertWork = useStore((s) => s.upsertWork)
  const setSettingsDirty = useStore((s) => s.setSettingsDirty)
  const pendingNav = useStore((s) => s.pendingNav)
  const clearPendingNav = useStore((s) => s.clearPendingNav)
  const [regenProg, setRegenProg] = useState<{ done: number; total: number } | null>(null)
  const [artistProg, setArtistProg] = useState<{ done: number; total: number } | null>(null)
  const [preloading, setPreloading] = useState(false)
  const [draft, setDraft] = useState<SettingsT>(settings)
  const [tagInput, setTagInput] = useState('')
  const [excludeInput, setExcludeInput] = useState('')
  const [favSearchInput, setFavSearchInput] = useState('')
  const [pinging, setPinging] = useState(false)
  const [ping, setPing] = useState<{ dohIp: string | null; ltnOk: boolean; error: string | null } | null>(null)
  const [rescanning, setRescanning] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Transient floating confirmation ("저장되었습니다") shown after a manual save.
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])
  // Theme is previewed live while editing; on leaving (cancel) restore the saved
  // theme so an unsaved change doesn't stick.
  useEffect(() => {
    return () => document.documentElement.setAttribute('data-theme', settings.theme ?? 'light')
  }, [settings.theme])
  const [confirmReset, setConfirmReset] = useState(false)
  // Full data wipe: two-step confirm; optional work-folder deletion (default off).
  const [wipeStep, setWipeStep] = useState<0 | 1 | 2>(0)
  const [wipeFolders, setWipeFolders] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [enrichProg, setEnrichProg] = useState<{ done: number; total: number } | null>(null)
  const [organizeProg, setOrganizeProg] = useState<{ moved: number; current: string } | null>(null)
  const [classifyProg, setClassifyProg] = useState<{ done: number; total: number; moved: number } | null>(null)
  const [cat, setCat] = useState<Cat>('folder')
  const visibleCats = CATS.filter((c) => c.modes.includes(libraryMode))
  // If the active category isn't available in the current mode, fall back.
  useEffect(() => {
    if (!visibleCats.some((c) => c.id === cat)) setCat('folder')
  }, [libraryMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Active activity-bar job ids for the event-driven tasks (progress arrives via
  // IPC listeners, so the job is updated there).
  const enrichJobRef = useRef<string | null>(null)
  const organizeJobRef = useRef<string | null>(null)
  useEffect(
    () =>
      window.api.onHitomiProgress((p) => {
        if (p.phase === 'enriching') {
          setEnrichProg({ done: p.done, total: p.total })
          if (enrichJobRef.current)
            useStore.getState().updateJob(enrichJobRef.current, { done: p.done, total: p.total })
        } else if (p.phase === 'done') {
          setEnrichProg(null)
          setEnriching(false)
        }
      }),
    []
  )
  useEffect(
    () =>
      window.api.onOrganizeProgress((p) => {
        setOrganizeProg(p.done ? null : { moved: p.moved, current: p.current })
        if (organizeJobRef.current)
          useStore.getState().updateJob(organizeJobRef.current, {
            done: p.moved,
            detail: p.done ? undefined : p.current
          })
      }),
    []
  )
  useEffect(
    () =>
      window.api.onClassifyProgress((p) =>
        setClassifyProg(p.finished ? null : { done: p.done, total: p.total, moved: p.moved })
      ),
    []
  )

  const enrichAll = async (): Promise<void> => {
    if (enriching) {
      window.api.hitomiCancelEnrich()
      return
    }
    setEnriching(true)
    setEnrichProg({ done: 0, total: 0 })
    const jid = useStore.getState().startJob('meta', 'hitomi', '메타 채우기 (작가·태그·언어)')
    enrichJobRef.current = jid
    try {
      await window.api.hitomiEnrichAll()
      setWorks(await window.api.getWorks())
      useStore.getState().endJob(jid, { status: 'done' })
    } catch (e: any) {
      useStore.getState().endJob(jid, { status: 'error', error: String(e?.message ?? e) })
    } finally {
      enrichJobRef.current = null
      setEnriching(false)
      setEnrichProg(null)
    }
  }
  const organize = async (): Promise<void> => {
    setOrganizeProg({ moved: 0, current: '' })
    const jid = useStore.getState().startJob('organize', 'hitomi', '언어별 폴더 정리')
    organizeJobRef.current = jid
    try {
      setWorks(await window.api.organizeLanguages())
      useStore.getState().endJob(jid, { status: 'done' })
    } catch (e: any) {
      useStore.getState().endJob(jid, { status: 'error', error: String(e?.message ?? e) })
    } finally {
      organizeJobRef.current = null
      setOrganizeProg(null)
    }
  }

  // Reset all settings to defaults but keep the folder configuration intact.
  const resetAll = async (): Promise<void> => {
    const reset: SettingsT = {
      ...DEFAULT_SETTINGS,
      libraryRoots: draft.libraryRoots,
      favoritesDir: draft.favoritesDir,
      downloadDir: draft.downloadDir,
      langDirs: draft.langDirs,
      normalRoots: draft.normalRoots,
      flattenRoots: draft.flattenRoots,
      flattenCollectThreshold: draft.flattenCollectThreshold,
      manualCollections: draft.manualCollections,
      favLists: draft.favLists,
      onlineFavLists: draft.onlineFavLists,
      normalFavoritesDir: draft.normalFavoritesDir,
      normalDownloadDir: draft.normalDownloadDir,
      textExportDir: draft.textExportDir,
      deletedDir: draft.deletedDir
    }
    const saved = await window.api.saveSettings(reset)
    setSettings(saved)
    setDraft(saved)
    setExcluded(saved.excludedImageHashes)
    clearTranslation()
    setConfirmReset(false)
    setNotice('설정을 기본값으로 초기화했습니다. (폴더 설정은 유지)')
  }

  // Rescan one folder: picks up works moved here by hand and re-derives their
  // favorite / group membership from the folder location (feature 8).
  const rescan = async (path: string, mode: 'hitomi' | 'normal'): Promise<void> => {
    setRescanning(path)
    try {
      // Runs as a global job (sets works internally) → progress in the activity bar.
      await useStore.getState().scanFolderJob(path, mode)
      setNotice('폴더 갱신 완료 — 하단 작업 바에서 결과 확인.')
    } finally {
      setRescanning(null)
    }
  }

  // Thumbnail regen straight from each work's own first local page — no online
  // lookup. Hitomi and general-manga run this independently over their own
  // library; a thumb-nonce bump makes the UI reload the results.
  const normalRoots = (): string[] =>
    [...(draft.normalRoots ?? []), draft.normalFavoritesDir, draft.normalDownloadDir].filter(
      Boolean
    ) as string[]

  const regenThumbs = async (mode: 'hitomi' | 'normal'): Promise<void> => {
    // General manga: one thumbnail per SERIES (rep chapter), not per chapter.
    const ids = thumbTargetIds(works, mode, normalRoots())
    if (!ids.length) {
      setNotice(mode === 'normal' ? '일반 만화 작품이 없습니다.' : '히토미 작품이 없습니다.')
      return
    }
    setRegenProg({ done: 0, total: ids.length })
    const jid = useStore.getState().startJob('thumb', mode, '썸네일 재생성')
    useStore.getState().updateJob(jid, { total: ids.length })
    let done = 0
    const byId = new Map(works.map((w) => [w.id, w]))
    for (const id of ids) {
      // Hitomi with a code: try the online cover first, fall back to first page.
      const code = mode === 'hitomi' ? byId.get(id)?.code ?? null : null
      let ok = false
      if (code) {
        ok = await window.api
          .hitomiRegenCover(id, code)
          .then((r) => r.ok)
          .catch(() => false)
      }
      if (!ok) await regenLocalThumb(id).catch(() => {})
      done++
      setRegenProg({ done, total: ids.length })
      useStore.getState().updateJob(jid, { done })
    }
    setRegenProg(null)
    useStore.getState().endJob(jid, { status: 'done', detail: `${done}개 썸네일 재생성` })
    bumpThumbNonce()
    setNotice(`썸네일 재생성 완료 — ${done}개.`)
  }

  // General-manga thumbnails: for each series, search the online source by title
  // for a matching cover; if none is found, fall back to the rep chapter's first
  // page. One unified action (no local/online split).
  const fillThumbsNormal = async (): Promise<void> => {
    const series = groupSeries(
      works.filter((w) => (w.library ?? 'hitomi') === 'normal'),
      normalRoots()
    )
    if (!series.length) {
      setNotice('일반 만화 시리즈가 없습니다.')
      return
    }
    setRegenProg({ done: 0, total: series.length })
    const jid = useStore.getState().startJob('thumb', 'normal', '썸네일 생성')
    useStore.getState().updateJob(jid, { total: series.length })
    let ok = 0
    for (let i = 0; i < series.length; i++) {
      const rep = series[i].chapters[0]
      if (rep) {
        // Try the online cover first, fall back to the local first page.
        let done = await window.api
          .tokiRegenCover([rep.id], series[i].title)
          .then((r) => r.ok)
          .catch(() => false)
        if (!done) done = await regenLocalThumb(rep.id).then(() => true).catch(() => false)
        if (done) ok++
      }
      setRegenProg({ done: i + 1, total: series.length })
      useStore.getState().updateJob(jid, { done: i + 1 })
    }
    setRegenProg(null)
    useStore.getState().endJob(jid, { status: 'done', detail: `${ok}/${series.length}개 썸네일` })
    bumpThumbNonce()
    setNotice(`썸네일 생성 완료 — ${ok}/${series.length}개 시리즈.`)
  }

  // Fill the artist field on general-manga series that have none, by searching
  // the online source for each title and taking the first result's author.
  const fillArtists = async (): Promise<void> => {
    const roots = [...(draft.normalRoots ?? []), draft.normalFavoritesDir, draft.normalDownloadDir].filter(
      Boolean
    ) as string[]
    const series = groupSeries(
      works.filter((w) => (w.library ?? 'hitomi') === 'normal'),
      roots
    ).filter((s) => s.chapters.every((c) => !c.artist))
    if (!series.length) {
      setNotice('작가 이름이 없는 시리즈가 없습니다.')
      return
    }
    setArtistProg({ done: 0, total: series.length })
    const jid = useStore.getState().startJob('meta', 'normal', '작가 이름 채우기')
    useStore.getState().updateJob(jid, { total: series.length })
    let ok = 0
    for (let i = 0; i < series.length; i++) {
      const s = series[i]
      try {
        const updated = await window.api.tokiFillArtist(s.chapters.map((c) => c.id), s.title)
        if (updated.length) {
          ok++
          updated.forEach(upsertWork)
        }
      } catch {
        /* skip this series */
      }
      setArtistProg({ done: i + 1, total: series.length })
      useStore.getState().updateJob(jid, { done: i + 1 })
    }
    setArtistProg(null)
    useStore.getState().endJob(jid, { status: 'done', detail: `${ok}/${series.length}개 시리즈` })
    setNotice(`작가 채우기 완료 — ${ok}/${series.length}개 시리즈.`)
  }

  // Rename every general-manga chapter folder to "<n>화 <subtitle>" (or "<n>화").
  // The series name is only kept on the parent folder. Uses the same analysis the
  // reader/home use, so names match what's shown in the app.
  const renameChapters = async (): Promise<void> => {
    const series = groupSeries(
      works.filter((w) => (w.library ?? 'hitomi') === 'normal'),
      normalRoots()
    )
    const items: { id: string; name: string }[] = []
    for (const s of series) {
      for (const ci of analyzeSeries(s.chapters, s.title, draft.normalChapterScheme)) {
        items.push({ id: ci.work.id, name: ci.subtitle ? `${ci.label} ${ci.subtitle}` : ci.label })
      }
    }
    if (!items.length) {
      setNotice('일반 만화 작품이 없습니다.')
      return
    }
    const updated = await window.api.renameNormalChapters(items)
    updated.forEach(upsertWork)
    setNotice(`화 폴더 이름 정리 완료 — ${updated.length}개 폴더 변경.`)
  }

  const runPing = async (): Promise<void> => {
    setPinging(true)
    try {
      setPing(await window.api.hitomiPing())
    } finally {
      setPinging(false)
    }
  }

  const patch = (p: Partial<SettingsT>): void => setDraft((d) => ({ ...d, ...p }))

  // Track unsaved edits so leaving Settings can prompt to save (store guard).
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  useEffect(() => {
    setSettingsDirty(dirty)
    return () => setSettingsDirty(false)
  }, [dirty, setSettingsDirty])

  // Persist the draft without navigating (used by the leave-confirm modal too).
  // Split keys are written into this mode's per-mode overlay so the other mode
  // keeps its own values (setSettings then re-applies the overlay for this mode).
  const persist = async (): Promise<SettingsT> => {
    const overlay = Object.fromEntries(
      SPLIT_SETTING_KEYS.map((k) => [k, draft[k]])
    ) as Partial<SettingsT>
    const raw: SettingsT = {
      ...draft,
      perMode: { ...(draft.perMode ?? {}), [libraryMode]: overlay }
    }
    const saved = await window.api.saveSettings(raw)
    setSettings(saved)
    // Re-sync the draft to the stored effective settings (same overlay applied),
    // so the dirty check settles instead of flagging the perMode difference.
    setDraft(useStore.getState().settings)
    setExcluded(saved.excludedImageHashes)
    clearTranslation() // engine/translator may have changed → drop cached pages
    setSettingsDirty(false)
    return saved
  }
  const save = async (): Promise<void> => {
    await persist()
    setToast('저장되었습니다')
  }

  // A navigation was attempted with unsaved edits: resolve the leave-confirm modal.
  const leaveSave = async (): Promise<void> => {
    const nav = pendingNav
    await persist()
    clearPendingNav()
    nav?.()
  }
  const leaveDiscard = (): void => {
    const nav = pendingNav
    setDraft(settings)
    setSettingsDirty(false)
    clearPendingNav()
    nav?.()
  }

  const addExcludeSample = async (): Promise<void> => {
    const url = await window.api.pickImage()
    if (!url) return
    const img = new Image()
    img.onload = async () => {
      const hash = await dHashFromImage(img)
      if (!draft.excludedImageHashes.includes(hash))
        patch({ excludedImageHashes: [...draft.excludedImageHashes, hash] })
    }
    img.src = url
  }

  const addRoot = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) patch({ libraryRoots: [...new Set([...draft.libraryRoots, dir])] })
  }
  const pickFav = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) patch({ favoritesDir: dir })
  }
  const pickDownload = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) patch({ downloadDir: dir })
  }
  const addNormalRoot = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) patch({ normalRoots: [...new Set([...draft.normalRoots, dir])] })
  }
  const addFlattenRoot = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) patch({ flattenRoots: [...new Set([...(draft.flattenRoots ?? []), dir])] })
  }
  const pickNormalFav = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) patch({ normalFavoritesDir: dir })
  }
  const pickNormalDownload = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) patch({ normalDownloadDir: dir })
  }
  const pickTextExport = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) patch({ textExportDir: dir })
  }
  const pickDeleted = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) patch({ deletedDir: dir })
  }
  const classifyDeleted = async (): Promise<void> => {
    if (!draft.deletedDir) {
      setNotice('먼저 “삭제된 작품 폴더”를 지정하세요.')
      return
    }
    setClassifyProg({ done: 0, total: 0, moved: 0 })
    try {
      const r = await window.api.classifyDeleted()
      setWorks(r.works)
      setNotice(
        `삭제된 작품 분류 완료 — ${r.checked}개 확인, ${r.moved}개 이동` +
          (r.uncertain ? `, ${r.uncertain}개 확인 불가(네트워크)로 건너뜀` : '')
      )
    } catch (e: any) {
      setNotice(String(e?.message ?? e))
    } finally {
      setClassifyProg(null)
    }
  }

  // Preview how chapter numbering is detected for the first general-manga series.
  const chapterPreview = useMemo(() => {
    const roots = [...(draft.normalRoots ?? []), draft.normalFavoritesDir].filter(Boolean) as string[]
    const series = groupSeries(
      works.filter((w) => (w.library ?? 'hitomi') === 'normal'),
      roots
    )
    if (!series.length) return null
    const s = series[0]
    const eff = effectiveChapterScheme(s.chapters, draft.normalChapterScheme)
    const labels = analyzeSeries(s.chapters, s.title, draft.normalChapterScheme)
      .slice(0, 6)
      .map((i) => i.label)
    return { title: s.title, eff, labels, more: s.chapters.length > 6 }
  }, [works, draft.normalRoots, draft.normalFavoritesDir, draft.normalChapterScheme])

  const updateRule = (i: number, r: GenreRule): void => {
    const rules = [...draft.genreRules]
    rules[i] = r
    patch({ genreRules: rules })
  }
  // Every tag currently used in the library — autocomplete source for genre names.
  const allTagTokens = useMemo(() => {
    const s = new Set<string>()
    for (const w of works) {
      w.tags.forEach((t) => s.add(t))
      w.manualTags.forEach((t) => s.add(t))
    }
    return [...s].sort()
  }, [works])
  const shortPath = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
  const pickRuleDir = async (i: number): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) updateRule(i, { ...draft.genreRules[i], moveDir: dir })
  }
  const [genreMoving, setGenreMoving] = useState(false)
  const runGenreMove = async (): Promise<void> => {
    setGenreMoving(true)
    const { startJob, endJob } = useStore.getState()
    const jid = startJob('organize', libraryMode, '장르별 폴더 이동')
    try {
      const r = await window.api.organizeByGenre()
      setWorks(r.works)
      endJob(jid, { status: 'done', detail: `${r.moved}개 이동` })
      setNotice(`장르별 폴더 이동 완료 — ${r.moved}개.`)
    } catch (e: any) {
      endJob(jid, { status: 'error', error: String(e?.message ?? e) })
    } finally {
      setGenreMoving(false)
    }
  }

  // ---- folder render helpers (keep the box rows uniform) --------------------
  // A list of library roots: an add row plus one path chip per folder.
  const rootList = (
    label: string,
    desc: string,
    roots: string[],
    onAdd: () => void,
    onRemove: (r: string) => void,
    mode: 'hitomi' | 'normal',
    addLabel = '+ 폴더 추가'
  ): JSX.Element => (
    <div className="set-block">
      <SettingRow title={label} desc={desc}>
        <button className="mini" onClick={onAdd}>
          {addLabel}
        </button>
      </SettingRow>
      {roots.map((r) => (
        <div className="path-item" key={r}>
          <code>{r}</code>
          <button className="mini" onClick={() => window.api.openFolder(r)}>
            열기
          </button>
          <button className="mini" disabled={rescanning === r} onClick={() => rescan(r, mode)}>
            {rescanning === r ? '갱신 중…' : '갱신'}
          </button>
          <button className="mini danger" onClick={() => onRemove(r)}>
            제거
          </button>
        </div>
      ))}
      {roots.length === 0 && <div className="path-item empty">등록된 폴더 없음</div>}
    </div>
  )

  // A single optional folder: label/desc row with a 선택 button, then the path.
  const folderRow = (
    label: string,
    desc: string,
    path: string | null | undefined,
    onPick: () => void,
    onClear: (() => void) | null,
    mode: 'hitomi' | 'normal' | null
  ): JSX.Element => (
    <div className="set-block">
      <SettingRow title={label} desc={desc}>
        <button className="mini" onClick={onPick}>
          선택
        </button>
      </SettingRow>
      {path ? (
        <div className="path-item">
          <code>{path}</code>
          <button className="mini" onClick={() => window.api.openFolder(path)}>
            열기
          </button>
          {mode && (
            <button className="mini" disabled={rescanning === path} onClick={() => rescan(path, mode)}>
              {rescanning === path ? '갱신 중…' : '갱신'}
            </button>
          )}
          {onClear && (
            <button className="mini danger" onClick={onClear}>
              해제
            </button>
          )}
        </div>
      ) : (
        <div className="path-item empty">(미지정)</div>
      )}
    </div>
  )

  const isHitomi = libraryMode === 'hitomi'

  return (
    <div className="settings">
      <div className="settings-inner" data-show={cat}>
        <h1>설정 · {isHitomi ? '히토미' : '일반 만화'}</h1>
        <p className="hint">
          이 화면은 현재 <b>{isHitomi ? '히토미' : '일반 만화'}</b> 모드 설정입니다. 모드는 ☰ 메뉴에서
          전환할 수 있습니다.
        </p>

        <div className="settings-tabs">
          {visibleCats.map((c) => (
            <button
              key={c.id}
              className={`settings-tab ${cat === c.id ? 'active' : ''}`}
              onClick={() => setCat(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* ================= 폴더 ================= */}
        <section data-cat="folder">
          <h2>폴더</h2>
          {isHitomi ? (
            <>
              {rootList(
                '라이브러리 폴더',
                '만화가 들어 있는 폴더들. 각 하위 폴더가 한 작품으로 인식됩니다.',
                draft.libraryRoots,
                addRoot,
                (r) => patch({ libraryRoots: draft.libraryRoots.filter((x) => x !== r) }),
                'hitomi'
              )}
              <div className="set-block">
                <SettingRow
                  title="폴더명 패턴"
                  desc="지원되는 변수는 [-id-, -title-, -artist-, -group-, -language-] 입니다. 체크된 형식으로 다운로드합니다."
                >
                  <button
                    className="mini"
                    onClick={() =>
                      patch({ hitomiNamePatterns: [...(draft.hitomiNamePatterns ?? []), ''] })
                    }
                  >
                    + 형식 추가
                  </button>
                </SettingRow>
                {(draft.hitomiNamePatterns ?? []).map((p, i) => (
                  <div className="pat-row" key={i}>
                    <div className="pat-line">
                      <button
                        type="button"
                        className={`pat-check ${draft.hitomiDownloadPatternIdx === i ? 'on' : ''}`}
                        title="다운로드에 사용할 형식"
                        onClick={() => patch({ hitomiDownloadPatternIdx: i })}
                      />
                      <input
                        type="text"
                        className="field-input"
                        value={p}
                        placeholder="-artist- [-id-] -title-"
                        onChange={(e) => {
                          const arr = [...(draft.hitomiNamePatterns ?? [])]
                          arr[i] = e.target.value
                          patch({ hitomiNamePatterns: arr })
                        }}
                      />
                      <button
                        className="mini danger"
                        onClick={() => {
                          const arr = (draft.hitomiNamePatterns ?? []).filter((_, x) => x !== i)
                          const idx = draft.hitomiDownloadPatternIdx
                          patch({
                            hitomiNamePatterns: arr,
                            hitomiDownloadPatternIdx:
                              idx > i ? idx - 1 : idx >= arr.length ? Math.max(0, arr.length - 1) : idx
                          })
                        }}
                      >
                        삭제
                      </button>
                    </div>
                    {p.trim() && (
                      <div className="pat-example">
                        예시: <span>{fillNamePattern(p, SAMPLE_FIELDS)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {rootList(
                '작가 폴더',
                '지정 폴더 바로 아래의 폴더 이름을 그 아래 모든 작품의 작가명으로 넣습니다 (지정 폴더 / 작가 폴더 / 작품 폴더 / 이미지).',
                draft.flattenRoots ?? [],
                addFlattenRoot,
                (r) => patch({ flattenRoots: (draft.flattenRoots ?? []).filter((x) => x !== r) }),
                'hitomi',
                '+ 위치 추가'
              )}
              {folderRow(
                '다운로드 폴더',
                '받은 작품을 저장할 폴더. 비우면 라이브러리 폴더에 저장합니다.',
                draft.downloadDir,
                pickDownload,
                () => patch({ downloadDir: null }),
                'hitomi'
              )}
              {folderRow(
                '즐겨찾기 폴더',
                '이 폴더 안의 작품은 위치 기준으로 즐겨찾기·그룹으로 인식됩니다.',
                draft.favoritesDir,
                pickFav,
                null,
                'hitomi'
              )}
              <div className="set-block">
                <div className="set-sub">언어별 폴더</div>
                {(['english', 'japanese', 'other'] as const).map((k) => (
                  <div className="path-item" key={k}>
                    <span className="path-label">
                      {k === 'english' ? '영어' : k === 'japanese' ? '일본어' : '기타'}
                    </span>
                    <code>{draft.langDirs[k] ?? '(미지정)'}</code>
                    {draft.langDirs[k] && (
                      <>
                        <button className="mini" onClick={() => window.api.openFolder(draft.langDirs[k]!)}>
                          열기
                        </button>
                        <button
                          className="mini"
                          disabled={rescanning === draft.langDirs[k]}
                          onClick={() => rescan(draft.langDirs[k]!, 'hitomi')}
                        >
                          {rescanning === draft.langDirs[k] ? '갱신 중…' : '갱신'}
                        </button>
                        <button
                          className="mini danger"
                          onClick={() => patch({ langDirs: { ...draft.langDirs, [k]: null } })}
                        >
                          해제
                        </button>
                      </>
                    )}
                    <button
                      className="mini"
                      onClick={async () => {
                        const dir = await window.api.pickFolder()
                        if (dir) patch({ langDirs: { ...draft.langDirs, [k]: dir } })
                      }}
                    >
                      선택
                    </button>
                  </div>
                ))}
              </div>
              {folderRow(
                '번역 내보내기 폴더',
                '작품 “내보내기”로 저장한 텍스트·이미지 번역이 이 폴더에 저장됩니다.',
                draft.textExportDir,
                pickTextExport,
                () => patch({ textExportDir: null }),
                null
              )}
            </>
          ) : (
            <>
              {rootList(
                '일반 만화 폴더',
                '일반 만화가 들어 있는 폴더들. 보통 작품마다 여러 화 폴더로 나뉩니다.',
                draft.normalRoots,
                addNormalRoot,
                (r) => patch({ normalRoots: draft.normalRoots.filter((x) => x !== r) }),
                'normal'
              )}
              {folderRow(
                '다운로드 폴더',
                '온라인에서 받은 일반 만화를 저장할 폴더.',
                draft.normalDownloadDir,
                pickNormalDownload,
                () => patch({ normalDownloadDir: null }),
                'normal'
              )}
              {folderRow(
                '즐겨찾기 폴더',
                '이 폴더 안의 일반 만화는 위치 기준으로 즐겨찾기로 인식됩니다.',
                draft.normalFavoritesDir,
                pickNormalFav,
                () => patch({ normalFavoritesDir: null }),
                'normal'
              )}
              {folderRow(
                '번역 내보내기 폴더',
                '작품 “내보내기”로 저장한 텍스트·이미지 번역이 이 폴더에 저장됩니다.',
                draft.textExportDir,
                pickTextExport,
                () => patch({ textExportDir: null }),
                null
              )}
            </>
          )}
        </section>

        {/* ================= 태그·검색 ================= */}
        <section data-cat="fav">
          <h2>태그·검색</h2>
          <div className="set-block">
            <SettingRow
              title="즐겨찾는 태그"
              desc="여기 등록한 태그는 목록에서 강조됩니다. 태그 입력 후 Enter."
            />
            <TagPickInput
              value={tagInput}
              onChange={setTagInput}
              tokens={allTagTokens}
              className="field-input"
              placeholder="태그 입력 후 Enter"
              onEnter={() => {
                if (tagInput.trim()) {
                  patch({ favoriteTags: [...new Set([...draft.favoriteTags, tagInput.trim().toLowerCase()])] })
                  setTagInput('')
                }
              }}
            />
            {draft.favoriteTags.length > 0 && (
              <div className="taglist">
                {draft.favoriteTags.map((t) => (
                  <span key={t} className="tag fav-tag">
                    {t}
                    <span
                      className="tag-x"
                      onClick={() => patch({ favoriteTags: draft.favoriteTags.filter((x) => x !== t) })}
                    >
                      ×
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="set-block">
            <SettingRow
              title="검색 제외 태그"
              desc="여기 등록한 태그는 온라인 검색 시 자동으로 제외됩니다. 검색창에는 표시되지 않습니다. 태그 입력 후 Enter. (예: female:netorare)"
            />
            <TagPickInput
              value={excludeInput}
              onChange={setExcludeInput}
              tokens={allTagTokens}
              className="field-input"
              placeholder="태그 입력 후 Enter (예: female:netorare)"
              onEnter={() => {
                if (excludeInput.trim()) {
                  const tok = tagToken(excludeInput.trim())
                  if (!(draft.onlineExcludeTags ?? []).includes(tok))
                    patch({ onlineExcludeTags: [...(draft.onlineExcludeTags ?? []), tok] })
                  setExcludeInput('')
                }
              }}
            />
            {(draft.onlineExcludeTags ?? []).length > 0 && (
              <div className="taglist">
                {(draft.onlineExcludeTags ?? []).map((t) => (
                  <span key={t} className="tag">
                    -{t}
                    <span
                      className="tag-x"
                      onClick={() =>
                        patch({
                          onlineExcludeTags: (draft.onlineExcludeTags ?? []).filter((x) => x !== t)
                        })
                      }
                    >
                      ×
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="set-block">
            <SettingRow
              title="검색 기록 사용"
              desc="온라인 검색창을 누르면 최근 검색어 목록을 보여줍니다."
            >
              <Toggle
                checked={draft.searchHistoryEnabled ?? true}
                onChange={(v) => patch({ searchHistoryEnabled: v })}
              />
            </SettingRow>
            <SettingRow title="최대 기록 수" desc="저장할 최근 검색어 개수.">
              <Stepper
                value={draft.searchHistoryMax ?? 20}
                onChange={(v) => patch({ searchHistoryMax: v })}
                min={1}
                step={5}
              />
            </SettingRow>
            <SettingRow title="검색 기록 전체 삭제" desc="저장된 모든 검색어를 지웁니다.">
              <button
                className="mini danger"
                onClick={() => patch({ searchHistory: [] })}
                disabled={!(draft.searchHistory?.length)}
              >
                전체 삭제
              </button>
            </SettingRow>
          </div>
          <div className="set-block">
            <SettingRow
              title="즐겨찾는 검색 (태그·조합)"
              desc="자주 쓰는 태그나 태그 조합을 저장합니다. 온라인 검색창을 누르면 목록에서 골라 검색할 수 있습니다. 태그를 여러 개 넣으면 하나의 조합으로 저장됩니다. 입력 후 Enter."
            />
            <TagSearchInput
              value={favSearchInput}
              onChange={setFavSearchInput}
              tokens={allTagTokens}
              fetchTokens={(q) => window.api.hitomiSuggest(q)}
              onEnter={() => {
                const q = favSearchInput.trim()
                if (!q) return
                if (!(draft.favoriteSearches ?? []).includes(q))
                  patch({ favoriteSearches: [...(draft.favoriteSearches ?? []), q] })
                setFavSearchInput('')
              }}
              placeholder="태그 입력 후 Enter (조합 예: female:big_breasts, tag:uncensored)"
            />
            {(draft.favoriteSearches ?? []).length > 0 && (
              <div className="taglist">
                {(draft.favoriteSearches ?? []).map((f) => (
                  <span key={f} className="tag">
                    {f}
                    <span
                      className="tag-x"
                      onClick={() =>
                        patch({
                          favoriteSearches: (draft.favoriteSearches ?? []).filter((x) => x !== f)
                        })
                      }
                    >
                      ×
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="set-block">
            <SettingRow
              title="폴더명으로 자동 태그"
              desc="작품 저장 경로 내 폴더명에 키워드 포함시 자동으로 태그를 생성하는 규칙을 정합니다."
            >
              <button
                className="mini"
                onClick={() => patch({ genreRules: [...draft.genreRules, { genre: '', keywords: [] }] })}
              >
                + 규칙 추가
              </button>
            </SettingRow>
            {draft.genreRules.map((rule, i) => (
              <div className="row rule" key={i}>
                <TagPickInput
                  value={rule.genre}
                  onChange={(v) => updateRule(i, { ...rule, genre: v })}
                  tokens={allTagTokens}
                  placeholder="장르명"
                />
                <input
                  value={rule.keywords.join(', ')}
                  placeholder="키워드, 쉼표, 구분"
                  onChange={(e) =>
                    updateRule(i, { ...rule, keywords: e.target.value.split(',').map((s) => s.trim()) })
                  }
                />
                <button
                  className="mini"
                  onClick={() => pickRuleDir(i)}
                  title={rule.moveDir ?? '이동 폴더 선택'}
                >
                  {rule.moveDir ? shortPath(rule.moveDir) : '이동 폴더'}
                </button>
                {rule.moveDir && (
                  <button
                    className="mini danger"
                    onClick={() => updateRule(i, { ...rule, moveDir: null })}
                  >
                    ×
                  </button>
                )}
                <button
                  className="mini danger"
                  onClick={() => patch({ genreRules: draft.genreRules.filter((_, x) => x !== i) })}
                >
                  삭제
                </button>
              </div>
            ))}
            <SettingRow
              title="규칙별 폴더로 자동 이동"
              desc="위 규칙의 장르 태그를 가진 작품을 각 규칙의 이동 폴더로 옮깁니다. (라이브러리 스캔 후 자동 실행)"
            >
              <Toggle checked={draft.autoMoveByGenre} onChange={(v) => patch({ autoMoveByGenre: v })} />
            </SettingRow>
            <div className="row row-right">
              <button className="btn" onClick={runGenreMove} disabled={genreMoving}>
                {genreMoving ? '이동 중…' : '지금 이동'}
              </button>
            </div>
          </div>
        </section>

        {isHitomi && (
          <section data-cat="fav">
            <h2>즐겨찾기</h2>
            {folderRow(
              '즐겨찾기 폴더',
              '이 폴더 안의 작품은 위치 기준으로 즐겨찾기로 인식됩니다.',
              draft.favoritesDir,
              pickFav,
              null,
              'hitomi'
            )}
            <div className="set-block">
              <SettingRow
                title="로컬 즐겨찾기 파일"
                desc="Pupil 호환(hitomi 번호 JSON) 파일을 목록으로 추가합니다. 홈의 ♥ 옆 ▾에서 목록별로 볼 수 있습니다."
              >
                <button
                  className="mini"
                  onClick={async () => {
                    const r = await window.api.importFavoriteList()
                    if (r.ok) {
                      setWorks(await window.api.getWorks())
                      const fresh = await window.api.getSettings()
                      patch({ favLists: fresh.favLists })
                      setNotice(`“${r.name}” 목록 — ${r.matched}/${r.total}개를 즐겨찾기로 불러왔습니다.`)
                    }
                  }}
                >
                  + 파일 추가
                </button>
              </SettingRow>
              {(draft.favLists ?? []).map((n) => (
                <div className="path-item" key={n}>
                  <code>★ {n}</code>
                  <button
                    className="mini danger"
                    onClick={async () => {
                      await window.api.removeFavoriteList(n)
                      setWorks(await window.api.getWorks())
                      patch({ favLists: (draft.favLists ?? []).filter((x) => x !== n) })
                    }}
                  >
                    제거
                  </button>
                </div>
              ))}
            </div>
            <div className="set-block">
              <SettingRow
                title="온라인 즐겨찾기 파일"
                desc="라이브러리에 없는 작품도 포함되는 온라인 목록. 온라인 둘러보기의 ♥ 옆 ▾에서 볼 수 있습니다."
              >
                <button
                  className="mini"
                  onClick={async () => {
                    const r = await window.api.importOnlineFavList()
                    if (r.ok) {
                      const fresh = await window.api.getSettings()
                      patch({ onlineFavLists: fresh.onlineFavLists })
                      setNotice(`온라인 목록 “${r.name}” — ${r.total}개 코드 추가.`)
                    }
                  }}
                >
                  + 파일 추가
                </button>
              </SettingRow>
              {(draft.onlineFavLists ?? []).map((l) => (
                <div className="path-item" key={l.name}>
                  <code>
                    ★ {l.name} · {l.codes.length}개
                  </code>
                  <button
                    className="mini danger"
                    onClick={async () => {
                      await window.api.removeOnlineFavList(l.name)
                      patch({
                        onlineFavLists: (draft.onlineFavLists ?? []).filter((x) => x.name !== l.name)
                      })
                    }}
                  >
                    제거
                  </button>
                </div>
              ))}
            </div>
            <SettingRow
              title="온라인 즐겨찾기 미리 불러오기"
              desc="모든 온라인 목록의 표지·정보를 미리 받아둡니다 (이후 즉시 표시)."
            >
              <button
                className="btn primary"
                disabled={preloading}
                onClick={async () => {
                  setPreloading(true)
                  const { startJob, updateJob, endJob } = useStore.getState()
                  const jid = startJob('meta', 'hitomi', '온라인 즐겨찾기 미리 로딩')
                  const off = window.api.onOnlineFavPreload(({ done, total }) =>
                    updateJob(jid, { done, total })
                  )
                  try {
                    const r = await window.api.preloadOnlineFavLists()
                    endJob(jid, { status: 'done', detail: `${r.cached}/${r.total}개` })
                    setNotice(`미리 로딩 완료 — ${r.cached}/${r.total}개 준비됨.`)
                  } catch (e: any) {
                    endJob(jid, { status: 'error', error: String(e?.message ?? e) })
                  } finally {
                    off()
                    setPreloading(false)
                  }
                }}
              >
                {preloading ? '미리 로딩 중…' : '전체 미리 로딩'}
              </button>
            </SettingRow>
            <div className="set-block">
              <div className="set-blocktitle">즐겨찾기 파일 관리</div>
              <SettingRow title="로컬" desc="라이브러리 기준 즐겨찾기 파일을 내보내거나 불러오고, 여러 파일을 하나로 병합합니다.">
                <button
                  className="mini"
                  onClick={async () => {
                    const r = await window.api.exportFavorites()
                    if (r.ok) setNotice(`${r.count}개 즐겨찾기를 내보냈습니다.`)
                  }}
                >
                  내보내기
                </button>
                <button
                  className="mini"
                  onClick={async () => {
                    const r = await window.api.importFavorites()
                    if (r.ok) {
                      setWorks(await window.api.getWorks())
                      const fresh = await window.api.getSettings()
                      setSettings(fresh)
                      setDraft(fresh)
                      setNotice(`${r.total}개 중 ${r.matched}개를 라이브러리에서 찾아 즐겨찾기에 병합했습니다.`)
                    }
                  }}
                >
                  불러오기
                </button>
                <button
                  className="mini"
                  onClick={async () => {
                    const r = await window.api.mergeFavorites()
                    if (r.ok) setNotice(`${r.files}개 파일을 합쳐 ${r.count}개를 새 파일로 저장했습니다.`)
                  }}
                >
                  파일 병합
                </button>
              </SettingRow>
              <SettingRow title="온라인" desc="온라인 코드 기준 즐겨찾기 파일을 내보내거나 불러오고, 여러 파일을 하나로 병합합니다.">
                <button
                  className="mini"
                  onClick={async () => {
                    const r = await window.api.exportOnlineFavs()
                    if (r.ok) setNotice(`${r.count}개 온라인 즐겨찾기를 내보냈습니다.`)
                  }}
                >
                  내보내기
                </button>
                <button
                  className="mini"
                  onClick={async () => {
                    const r = await window.api.importOnlineFavs()
                    if (r.ok) {
                      setOnlineFavs(await window.api.getOnlineFavs())
                      setNotice(`${r.count}개 온라인 즐겨찾기를 병합했습니다.`)
                    }
                  }}
                >
                  불러오기
                </button>
                <button
                  className="mini"
                  onClick={async () => {
                    const r = await window.api.mergeOnlineFavs()
                    if (r.ok) setNotice(`${r.files}개 파일을 합쳐 ${r.count}개를 새 파일로 저장했습니다.`)
                  }}
                >
                  파일 병합
                </button>
              </SettingRow>
            </div>
          </section>
        )}

        {!isHitomi && (
          <section data-cat="fav">
            <h2>즐겨찾기</h2>
            {folderRow(
              '즐겨찾기 폴더',
              '이 폴더 안의 일반 만화는 위치 기준으로 즐겨찾기로 인식됩니다.',
              draft.normalFavoritesDir,
              pickNormalFav,
              () => patch({ normalFavoritesDir: null }),
              'normal'
            )}
          </section>
        )}

        {/* ================= 스타일·정렬 ================= */}
        <section data-cat="style">
          <h2>라이브러리 스타일</h2>
          <SettingRow title="다크 테마" desc="켜면 어두운 화면 테마, 끄면 밝은 테마를 사용합니다.">
            <Toggle
              checked={(draft.theme ?? 'light') === 'dark'}
              onChange={(on) => {
                const t = on ? 'dark' : 'light'
                patch({ theme: t })
                document.documentElement.setAttribute('data-theme', t)
              }}
            />
          </SettingRow>
          <SettingRow
            title="마우스 오버 미리보기"
            desc="썸네일에 마우스를 올리면 크게 미리보고 휠로 페이지를 넘깁니다."
          >
            <Toggle checked={draft.thumbHoverPreview !== false} onChange={(v) => patch({ thumbHoverPreview: v })} />
          </SettingRow>
          <SettingRow title="여백 너비" desc="목록이 표시되는 최대 폭. 좌우 여백을 조절합니다.">
            <Stepper value={draft.marginWidth} onChange={(v) => patch({ marginWidth: v })} min={400} step={20} />
            <span>px</span>
          </SettingRow>
        </section>

        <section data-cat="style">
          <h2>뷰어 스타일</h2>
          <SettingRow title="스크롤 넘김에서 페이지 간격" desc="스크롤 감상 시 페이지 사이에 간격을 둡니다.">
            <Toggle checked={draft.readerPageGap} onChange={(v) => patch({ readerPageGap: v })} />
          </SettingRow>
          <SettingRow title="클릭 넘김에서 휠 스크롤로 페이지 넘기기" desc="클릭 넘김 모드에서 휠 스크롤로도 페이지를 넘깁니다.">
            <Toggle checked={draft.pagedWheelFlip} onChange={(v) => patch({ pagedWheelFlip: v })} />
          </SettingRow>
          <SettingRow title="두 쪽 보기에서 오른쪽을 다음 페이지로" desc="끄면 왼쪽이 다음(만화식) 페이지가 됩니다.">
            <Toggle
              checked={draft.spreadNextSide === 'right'}
              onChange={(v) => patch({ spreadNextSide: v ? 'right' : 'left' })}
            />
          </SettingRow>
          <SettingRow title="왼쪽을 클릭해서 페이지 넘기기" desc="끄면 오른쪽을 클릭해 다음 페이지로 넘깁니다.">
            <Toggle
              checked={draft.pagedFlipSide === 'left'}
              onChange={(v) => patch({ pagedFlipSide: v ? 'left' : 'right' })}
            />
          </SettingRow>
          <SettingRow title="페이지 제외" desc="각 작품의 앞쪽 N장을 썸네일·뷰어에서 건너뜁니다 (표지·광고 스킵).">
            <Stepper
              value={draft.excludeLeadingPages}
              onChange={(v) => patch({ excludeLeadingPages: v })}
              min={0}
            />
            <span>장</span>
          </SettingRow>
          <div className="set-block">
            <SettingRow
              title="제외 이미지 추가"
              desc="샘플 이미지를 등록하면 비슷한 페이지가 목록·뷰어에서 자동 제외됩니다."
            >
              <button className="mini" onClick={addExcludeSample}>
                + 이미지 추가
              </button>
            </SettingRow>
            {draft.excludedImageHashes.map((h) => (
              <div className="path-item" key={h}>
                <code>{h}</code>
                <button
                  className="mini danger"
                  onClick={() =>
                    patch({ excludedImageHashes: draft.excludedImageHashes.filter((x) => x !== h) })
                  }
                >
                  제거
                </button>
              </div>
            ))}
          </div>
        </section>

        <section data-cat="style">
          <h2>정렬</h2>
          <SettingRow title="제목순 정렬에서 괄호 무시" desc="() / [] 로 묶인 태그를 무시하고 실제 제목으로 정렬합니다.">
            <Toggle
              checked={draft.ignoreBracketTagsInSort}
              onChange={(v) => patch({ ignoreBracketTagsInSort: v })}
            />
          </SettingRow>
          <SettingRow title="페이지당 작품 수" desc="홈·온라인·즐겨찾기 목록에 한 페이지에 보여줄 작품 수.">
            <Stepper value={draft.pageSize} onChange={(v) => patch({ pageSize: Math.max(1, v) })} min={1} />
            <span>개</span>
          </SettingRow>
          <SettingRow title="기본 정렬" desc="라이브러리를 열 때 사용할 기본 정렬 방식.">
            <Dropdown<SortMode>
              className="field"
              value={draft.defaultSort}
              onChange={(v) => patch({ defaultSort: v })}
              options={(Object.keys(SORT_LABELS) as SortMode[]).map((m) => [m, SORT_LABELS[m]])}
            />
          </SettingRow>
        </section>

        {/* ================= 번역 ================= */}
        <section data-cat="translate">
          <h2>번역</h2>
          <p className="hint">
            한국어가 아닌 작품을 볼 때 뷰어 하단 “🌐 번역”으로 현재 페이지 말풍선 원문을 지우고 그 자리에
            한국어를 덧씌웁니다. 보고 있는 페이지만 번역하며 결과는 캐시됩니다.
          </p>
          {folderRow(
            '번역 내보내기 폴더',
            '작품 “내보내기”로 저장한 텍스트·이미지 번역이 이 폴더에 저장됩니다.',
            draft.textExportDir,
            pickTextExport,
            () => patch({ textExportDir: null }),
            null
          )}

          <SettingRow title="번역 엔진" desc="글자 인식·번역을 처리할 엔진.">
            <Dropdown<SettingsT['translateEngine']>
              className="field"
              value={draft.translateEngine}
              onChange={(v) => patch({ translateEngine: v })}
              options={[
                ['llm', 'Vision LLM (무료)'],
                ['gemini', 'Gemini Flash (유료)'],
                ['papago', 'Papago (유료)'],
                ['free', '기본 (무료 · Tesseract)']
              ]}
            />
          </SettingRow>

          {draft.translateEngine === 'llm' && (
            <div className="set-block">
              <p className="hint" style={{ marginTop: 8 }}>
                OpenAI 호환 비전 API로 인식+번역+위치를 한 번에. 대부분 카드 없이 무료 한도가 있습니다.
                제공자를 고르면 주소/모델이 자동 채워지며, 키만 발급해 넣으면 됩니다.
              </p>
              <SettingRow title="제공자">
                <Dropdown<SettingsT['llmProvider']>
                  className="field prov-field"
                  value={draft.llmProvider}
                  onChange={(p) => {
                    const preset = LLM_PRESETS[p]
                    patch({ llmProvider: p, ...(preset ?? {}) })
                  }}
                  options={[
                    ['groq', 'Groq'],
                    ['openrouter', 'OpenRouter'],
                    ['mistral', 'Mistral'],
                    ['custom', '커스텀']
                  ]}
                />
              </SettingRow>
              <SettingRow title="Base URL" />
              <input
                type="text"
                className="field-input"
                value={draft.llmBaseUrl}
                onChange={(e) => patch({ llmBaseUrl: e.target.value.trim() })}
              />
              <SettingRow title="모델" />
              <input
                type="text"
                className="field-input"
                value={draft.llmModel}
                onChange={(e) => patch({ llmModel: e.target.value.trim() })}
              />
              <SettingRow title="API 키" />
              <input
                type="password"
                className="field-input"
                value={draft.llmApiKey}
                onChange={(e) => patch({ llmApiKey: e.target.value.trim() })}
              />
              <p className="hint">
                키 발급: Groq=console.groq.com · OpenRouter=openrouter.ai/keys · Mistral=console.mistral.ai.
                모델은 비전(이미지) 지원 모델이어야 합니다.
              </p>
            </div>
          )}

          {draft.translateEngine === 'gemini' && (
            <div className="set-block">
              <p className="hint" style={{ marginTop: 8 }}>
                Gemini가 글자 인식+번역+위치를 한 번에 처리합니다. Google AI Studio에서 무료 API 키를
                발급(aistudio.google.com → Get API key)해 입력하세요. (이미지가 Google로 전송)
              </p>
              <SettingRow title="Gemini API 키" />
              <input
                type="password"
                className="field-input"
                value={draft.geminiApiKey}
                onChange={(e) => patch({ geminiApiKey: e.target.value.trim() })}
              />
              <SettingRow title="모델" />
              <input
                type="text"
                className="field-input"
                value={draft.geminiModel}
                onChange={(e) => patch({ geminiModel: e.target.value.trim() })}
              />
              <p className="hint">
                기본 <code>gemini-2.0-flash</code>. 더 정확한 최신 모델이 있으면 바꿔도 됩니다.
              </p>
            </div>
          )}

          {draft.translateEngine === 'papago' && (
            <div className="set-block">
              <p className="hint" style={{ marginTop: 8 }}>
                네이버 클라우드 Papago Image Translation(Text) 하나로 글자 인식+번역. NCP에서 해당 API를
                켜고 Client ID/Secret을 입력하세요. (이미지가 Papago로 전송, 사용량 과금)
              </p>
              <SettingRow title="Papago Client ID" />
              <input
                type="text"
                className="field-input"
                value={draft.papagoClientId}
                onChange={(e) => patch({ papagoClientId: e.target.value.trim() })}
              />
              <SettingRow title="Papago Client Secret" />
              <input
                type="password"
                className="field-input"
                value={draft.papagoClientSecret}
                onChange={(e) => patch({ papagoClientSecret: e.target.value.trim() })}
              />
              <SettingRow title="이미지 번역 엔드포인트" />
              <input
                type="text"
                className="field-input"
                value={draft.papagoImageEndpoint}
                onChange={(e) => patch({ papagoImageEndpoint: e.target.value.trim() })}
              />
              <p className="hint">※ 콘솔의 API Gateway 호출 URL과 다르면 위 주소를 맞춰주세요.</p>
            </div>
          )}

          {draft.translateEngine === 'free' && (
            <div className="set-block">
              <p className="hint" style={{ marginTop: 8 }}>
                글자 인식은 기기에서 Tesseract로 무료 처리(페이지당 0원). 번역만 아래 무료 번역기를 씁니다.
                인식 정확도는 파파고보다 낮을 수 있고, 첫 페이지는 인식 엔진 로딩으로 조금 느립니다.
              </p>
              <SettingRow title="무료 번역기">
                <Dropdown<SettingsT['freeTranslator']>
                  className="field"
                  value={draft.freeTranslator}
                  onChange={(v) => patch({ freeTranslator: v })}
                  options={[
                    ['google', 'Google 비공식 (키 없음 · 불안정할 수 있음)'],
                    ['deepl', 'DeepL Free (키 필요 · 월 50만자 무료 · 품질↑)']
                  ]}
                />
              </SettingRow>
              {draft.freeTranslator === 'deepl' && (
                <>
                  <SettingRow title="DeepL API 키" />
                  <input
                    type="password"
                    className="field-input"
                    value={draft.deeplApiKey}
                    onChange={(e) => patch({ deeplApiKey: e.target.value.trim() })}
                  />
                  <p className="hint">
                    DeepL 계정 → API(Free) 키 발급 후 입력. 엔드포인트는 api-free.deepl.com을 씁니다.
                  </p>
                </>
              )}
            </div>
          )}
        </section>

        {/* ================= 네트워크·다운로드 ================= */}
        <section data-cat="network">
          <h2>네트워크</h2>
          <SettingRow
            title="네트워크 연결 테스트"
            desc="DNS/SNI 차단 여부를 확인합니다. 앱은 자체 DoH(1.1.1.1)로 IP를 직접 구해 우회합니다."
          >
            <button className="btn" onClick={runPing} disabled={pinging}>
              {pinging ? '테스트 중…' : '연결 테스트'}
            </button>
          </SettingRow>
          {ping && (
            <p className="hint">
              DoH IP: <b>{ping.dohIp ?? '실패(DoH 차단)'}</b> · ltn.hitomi.la:{' '}
              <b style={{ color: ping.ltnOk ? 'var(--accent)' : 'var(--danger)' }}>
                {ping.ltnOk ? 'OK' : '실패'}
              </b>
              {ping.error && ` (${ping.error})`}
            </p>
          )}
          <div className="set-block">
            <SettingRow
              title="프록시"
              desc="로컬 프록시/VPN 포트를 쓰면 입력. 비우면 시스템 설정을 사용합니다."
            />
            <input
              type="text"
              className="field-input"
              value={draft.proxyServer}
              placeholder="예: socks5://127.0.0.1:1080  또는  http://127.0.0.1:8080"
              onChange={(e) => patch({ proxyServer: e.target.value.trim() })}
            />
          </div>
          {isHitomi ? (
            <div className="set-block">
              <SettingRow
                title="온라인 주소 입력"
                desc="히토미 사이트 주소. 이 주소를 입력해야 온라인 접속(둘러보기·검색·다운로드)이 됩니다."
              />
              <input
                type="text"
                className="field-input"
                value={draft.hitomiBaseUrl}
                onChange={(e) => patch({ hitomiBaseUrl: e.target.value.trim() })}
                placeholder="온라인 주소를 입력하세요"
              />
            </div>
          ) : (
            <div className="set-block">
              <SettingRow
                title="온라인 주소 입력"
                desc="만화 사이트 온라인 주소. 도메인이 자주 바뀌므로 접속이 안 되면 최신 주소로 바꾸세요."
              />
              <input
                type="text"
                className="field-input"
                value={draft.tokiBaseUrl}
                onChange={(e) => patch({ tokiBaseUrl: e.target.value })}
                placeholder="온라인 주소를 입력하세요"
              />
            </div>
          )}
        </section>

        <section data-cat="network">
          <h2>다운로드</h2>
          {isHitomi
            ? folderRow(
                '다운로드 폴더',
                '받은 작품을 저장할 폴더. 비우면 라이브러리 폴더에 저장합니다.',
                draft.downloadDir,
                pickDownload,
                () => patch({ downloadDir: null }),
                'hitomi'
              )
            : folderRow(
                '다운로드 폴더',
                '온라인에서 받은 일반 만화를 저장할 폴더.',
                draft.normalDownloadDir,
                pickNormalDownload,
                () => patch({ normalDownloadDir: null }),
                'normal'
              )}
          {isHitomi && (
            <SettingRow
              title="스캔 후 메타 자동 채우기"
              desc="라이브러리 스캔 후 코드가 있는 작품의 작가·태그·언어를 자동으로 채웁니다."
            >
              <Toggle checked={draft.autoEnrichOnScan} onChange={(v) => patch({ autoEnrichOnScan: v })} />
            </SettingRow>
          )}
          {isHitomi && (
            <SettingRow
              title="이미지 형식"
              desc="AVIF는 용량이 작고, WebP는 호환성이 높습니다. 없는 형식은 자동으로 다른 형식으로 받습니다."
            >
              <Dropdown<'avif' | 'webp'>
                className="field dl-opt"
                value={draft.downloadImageFormat}
                onChange={(v) => patch({ downloadImageFormat: v })}
                options={[
                  ['avif', 'AVIF (용량 작음)'],
                  ['webp', 'WebP (호환성 높음)']
                ]}
              />
            </SettingRow>
          )}
          <SettingRow
            title="동시 다운로드"
            desc="온라인에서 한 번에 받을 수 있는 최대 작품 수. 초과분은 차례로 대기합니다."
          >
            <Dropdown<string>
              className="field dl-opt"
              value={String(draft.maxConcurrentDownloads ?? 2)}
              onChange={(v) => patch({ maxConcurrentDownloads: Number(v) })}
              options={[
                ['1', '1'],
                ['2', '2'],
                ['3', '3'],
                ['4', '4'],
                ['5', '5'],
                ['0', '무제한']
              ]}
            />
          </SettingRow>
        </section>

        {/* ================= 관리 ================= */}
        <section data-cat="manage">
          <h2>라이브러리</h2>
          {isHitomi ? (
            <>
              <SettingRow
                title="라이브러리 스캔 후 자동으로 언어별 폴더 정리"
                desc="스캔 직후 한국어가 아닌 작품을 언어별 폴더로 자동 이동합니다."
              >
                <Toggle
                  checked={draft.autoOrganizeOnScan}
                  onChange={(v) => patch({ autoOrganizeOnScan: v })}
                />
              </SettingRow>
              <SettingRow title="라이브러리 스캔" desc="모든 폴더를 다시 읽어 라이브러리를 갱신하고 썸네일을 생성합니다.">
                <button className="btn primary" onClick={() => scanLibraryJob()} disabled={scanning}>
                  {scanning ? '스캔 중…' : '스캔'}
                </button>
              </SettingRow>
              <SettingRow title="전체 메타 채우기" desc="코드가 있는 작품의 작가·태그·언어를 hitomi에서 일괄로 채웁니다.">
                <button className={`btn ${enriching ? 'danger' : ''}`} onClick={enrichAll}>
                  {enriching ? '■ 중지' : '실행'}
                </button>
              </SettingRow>
              <SettingRow title="언어 정리" desc="한국어가 아닌 작품을 언어별 폴더로 이동합니다.">
                <button className="btn" onClick={organize} disabled={organizeProg !== null}>
                  {organizeProg ? '정리 중…' : '실행'}
                </button>
              </SettingRow>
              <SettingRow
                title="썸네일 재생성"
                desc="히토미 작품은 온라인 표지로, 검색 안 되거나 코드가 없는 작품은 첫 페이지로 만듭니다."
              >
                <button className="btn" onClick={() => regenThumbs('hitomi')} disabled={regenProg !== null}>
                  {regenProg ? `재생성 중… ${regenProg.done}/${regenProg.total}` : '실행'}
                </button>
              </SettingRow>
              {enrichProg && (
                <p className="hint">
                  메타 채우는 중… {enrichProg.done}/{enrichProg.total}
                </p>
              )}
              {organizeProg && (
                <p className="hint">
                  언어 정리 중… {organizeProg.moved}개 이동 · {organizeProg.current}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="set-block">
                <SettingRow title="화수 인식 방식" desc="폴더명에서 몇 화인지 읽는 방법을 고릅니다." />
                <RadioCards<SettingsT['normalChapterScheme']>
                  value={draft.normalChapterScheme}
                  onChange={(v) => patch({ normalChapterScheme: v })}
                  options={[
                    { val: 'auto', label: '자동', desc: '시리즈마다 판단 (모든 화에 N화 토큰이 있으면 토큰, 아니면 폴더 앞 순번).' },
                    { val: 'token', label: '화 토큰', desc: '폴더명의 N화 / N-M화 토큰으로 인식.' },
                    { val: 'index', label: '앞 번호', desc: '폴더 정렬 순번으로 인식.' }
                  ]}
                />
                {chapterPreview && (
                  <p className="hint" style={{ marginTop: 8 }}>
                    예: <b>{chapterPreview.title}</b> — 현재{' '}
                    <b>{chapterPreview.eff === 'token' ? '화 토큰' : '앞 번호'}</b>로 인식 →{' '}
                    {chapterPreview.labels.join(', ')}
                    {chapterPreview.more ? ' …' : ''}
                  </p>
                )}
              </div>
              <SettingRow
                title="시리즈 병합"
                desc="같은 제목인데 여러 폴더로 나뉜 시리즈를 후보를 보고 직접 골라 하나로 합칩니다."
              >
                <button className="btn" onClick={() => goManage('merge')}>
                  병합 도구 열기
                </button>
              </SettingRow>
              <SettingRow
                title="화 폴더 이름 정리"
                desc="각 화 폴더명을 “n화 제목” (제목 없으면 “n화”)으로 바꿉니다. 시리즈 제목은 상위 폴더에만 남습니다."
              >
                <button className="btn" onClick={renameChapters}>
                  실행
                </button>
              </SettingRow>
              <SettingRow title="라이브러리 스캔" desc="모든 폴더를 다시 읽어 라이브러리를 갱신하고 썸네일을 생성합니다.">
                <button className="btn primary" onClick={() => scanLibraryJob()} disabled={scanning}>
                  {scanning ? '스캔 중…' : '스캔'}
                </button>
              </SettingRow>
            </>
          )}
          <SettingRow
            title="전체 초기화"
            desc="모든 설정값을 기본값으로 되돌립니다. 폴더 설정과 작품 파일은 유지됩니다."
          >
            <button className="btn danger" onClick={() => setConfirmReset(true)}>
              초기화
            </button>
          </SettingRow>
          <SettingRow
            title="완전 초기화 (모든 데이터 삭제)"
            desc="설정·라이브러리·세션·즐겨찾기·쿠키 등 앱의 모든 데이터를 삭제하고 최초 실행 상태로 되돌립니다. 되돌릴 수 없습니다."
          >
            <button className="btn danger" onClick={() => { setWipeFolders(false); setWipeStep(1) }}>
              완전 초기화
            </button>
          </SettingRow>
        </section>

        <section data-cat="manage">
          <h2>작품</h2>
          {isHitomi ? (
            <>
              <div className="set-block">
                <SettingRow
                  title="작가 폴더 자동 병합"
                  desc="작가 폴더 아래에서 이 페이지 수 이하인 작은 화 폴더들을 자동으로 “작가 collection”으로 묶습니다. 0이면 끕니다."
                >
                  <Stepper
                    value={draft.flattenCollectThreshold ?? 0}
                    onChange={(v) => patch({ flattenCollectThreshold: v })}
                  />
                  <span>이하</span>
                </SettingRow>
                <div className="row row-right">
                  <button className="btn" onClick={() => goManage('collections')}>
                    작가 컬렉션 관리…
                  </button>
                </div>
              </div>
              <SettingRow title="중복 작품 정리" desc="중복으로 받은 작품을 직접 확인하고 정리합니다.">
                <button className="btn" onClick={() => goManage('duplicates')}>
                  열기
                </button>
              </SettingRow>
              <SettingRow title="한국어 번역본 정리" desc="이미 받은 한국어 번역본 쌍을 찾아 정리합니다.">
                <button className="btn" onClick={() => goManage('translations')}>
                  열기
                </button>
              </SettingRow>
              <div className="set-block">
                <SettingRow
                  title="히토미에서 삭제된 작품 분류"
                  desc="코드가 있는 작품 중 히토미에서 더 이상 검색되지 않는 작품을 지정 폴더로 모읍니다. (확인 불가는 건너뜀)"
                >
                  <button className="mini" onClick={pickDeleted}>
                    폴더 선택
                  </button>
                </SettingRow>
                {draft.deletedDir && (
                  <div className="path-item">
                    <code>{draft.deletedDir}</code>
                    <button className="mini danger" onClick={() => patch({ deletedDir: null })}>
                      해제
                    </button>
                  </div>
                )}
                <div className="row row-right">
                  {classifyProg && (
                    <span className="hint" style={{ margin: 0 }}>
                      {classifyProg.done}/{classifyProg.total} 확인 · {classifyProg.moved}개 이동
                    </span>
                  )}
                  <button
                    className="btn primary"
                    onClick={classifyDeleted}
                    disabled={!!classifyProg || !draft.deletedDir}
                  >
                    {classifyProg ? '확인 중…' : '갱신 (삭제 작품 분류)'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <SettingRow
                title="썸네일 생성"
                desc="제목으로 온라인에서 표지를 먼저 찾고, 없으면 대표 1화 첫 페이지로 만듭니다."
              >
                <button className="btn" onClick={fillThumbsNormal} disabled={regenProg !== null}>
                  {regenProg ? `처리 중… ${regenProg.done}/${regenProg.total}` : '실행'}
                </button>
              </SettingRow>
              <SettingRow
                title="작가 이름 채우기"
                desc="작가 이름이 없는 시리즈를, 제목이 일치하는 온라인 결과의 작가 이름으로 채웁니다."
              >
                <button className="btn" onClick={fillArtists} disabled={artistProg !== null}>
                  {artistProg ? `채우는 중… ${artistProg.done}/${artistProg.total}` : '실행'}
                </button>
              </SettingRow>
            </>
          )}
        </section>

        {isHitomi && (
          <section data-cat="manage">
            <h2>모드</h2>
            <SettingRow
              title="일반 만화 모드와 탭 통합"
              desc="히토미와 일반 만화의 탭을 한 줄로 함께 표시합니다. 끄면 모드별로 탭이 분리됩니다."
            >
              <Toggle
                checked={draft.unifyTabsAcrossModes}
                onChange={(v) => patch({ unifyTabsAcrossModes: v })}
              />
            </SettingRow>
          </section>
        )}

        <div className="settings-actions">
          <button className="btn" onClick={goHome}>
            취소
          </button>
          <button className="btn primary" onClick={save}>
            저장
          </button>
        </div>
      </div>

      {toast && <div className="settings-toast">✓ {toast}</div>}
      {notice && (
        <ConfirmModal
          icon="✓"
          title="완료"
          desc={notice}
          confirmLabel="확인"
          hideCancel
          onConfirm={() => setNotice(null)}
          onCancel={() => setNotice(null)}
        />
      )}
      {pendingNav && (
        <ConfirmModal
          icon="💾"
          title="저장하지 않은 변경이 있습니다"
          desc="설정을 저장하고 나갈까요?"
          confirmLabel="저장"
          altLabel="저장 안 함"
          cancelLabel="닫기"
          onConfirm={leaveSave}
          onAlt={leaveDiscard}
          onCancel={clearPendingNav}
        />
      )}
      {confirmReset && (
        <ConfirmModal
          icon="↺"
          danger
          title="설정을 전체 초기화할까요?"
          desc="모든 설정값이 기본값으로 돌아갑니다. 폴더 설정과 작품 파일은 유지됩니다."
          confirmLabel="초기화"
          onConfirm={resetAll}
          onCancel={() => setConfirmReset(false)}
        />
      )}
      {wipeStep === 1 && (
        <ConfirmModal
          icon="⚠"
          danger
          title="모든 데이터를 삭제할까요? (1/2)"
          desc={
            <>
              설정·라이브러리·세션·즐겨찾기·쿠키 등 앱의 <b>모든 데이터</b>가 삭제되고 최초 실행 상태로
              돌아갑니다.
              <label className="wipe-check">
                <input
                  type="checkbox"
                  checked={wipeFolders}
                  onChange={(e) => setWipeFolders(e.target.checked)}
                />
                작품 저장 폴더까지 디스크에서 삭제 (다운로드한 만화 파일 전부 영구 삭제)
              </label>
            </>
          }
          confirmLabel="계속"
          cancelLabel="취소"
          onConfirm={() => setWipeStep(2)}
          onCancel={() => setWipeStep(0)}
        />
      )}
      {wipeStep === 2 && (
        <ConfirmModal
          icon="🗑"
          danger
          title="마지막 확인 (2/2)"
          desc={
            <>
              정말 실행하면 <b>되돌릴 수 없습니다.</b>
              {wipeFolders ? (
                <>
                  {' '}
                  <b>작품 폴더의 파일까지 영구 삭제</b>되며, 앱이 재시작됩니다.
                </>
              ) : (
                <> 앱 데이터가 삭제되고 재시작됩니다. (작품 파일은 유지)</>
              )}
            </>
          }
          confirmLabel={wipeFolders ? '전부 삭제하고 재시작' : '초기화하고 재시작'}
          cancelLabel="취소"
          onConfirm={() => {
            setWipeStep(0)
            window.api.resetApp(wipeFolders)
          }}
          onCancel={() => setWipeStep(0)}
        />
      )}
    </div>
  )
}
