// 관리: library-wide maintenance (scan, metadata, language organizing,
// thumbnails, chapter naming), work cleanup tools, settings reset / full data
// wipe, and the tab-mode option. Long tasks run as activity-bar jobs.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { Settings } from '../../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../../shared/types'
import { useStore } from '../../store'
import { groupSeries, analyzeSeries, effectiveChapterScheme, thumbTargetIds, seriesRoots, type SeriesGroup } from '../../util'
import { setExcluded } from '../../exclude'
import { clearTranslation } from '../../translate'
import { regenLocalThumb } from '../../thumbs'
import ConfirmModal from '../ConfirmModal'
import SettingRow from '../SettingRow'
import Stepper from '../Stepper'
import Toggle from '../Toggle'
import { useSettings } from './context'
import { RadioCards } from './parts'

type Prog = { done: number; total: number }

// Settings kept by "전체 초기화" (everything about folders and lists).
const KEEP_ON_RESET = [
  'libraryRoots',
  'favoritesDir',
  'downloadDir',
  'langDirs',
  'normalRoots',
  'flattenRoots',
  'flattenCollectThreshold',
  'manualCollections',
  'onlineFavLists',
  'normalDownloadDir',
  'textExportDir',
  'deletedDir'
] as const

export default function ManageSection(): JSX.Element {
  const { draft, patch, applySaved, isHitomi, works, notify } = useSettings()
  const goManage = useStore((s) => s.goManage)
  const scanLibraryJob = useStore((s) => s.scanLibraryJob)
  const scanning = useStore((s) => s.loading)
  const setWorks = useStore((s) => s.setWorks)
  const upsertWork = useStore((s) => s.upsertWork)
  const bumpThumbNonce = useStore((s) => s.bumpThumbNonce)
  const { startJob, updateJob, endJob } = useStore.getState()

  const [enriching, setEnriching] = useState(false)
  const [enrichProg, setEnrichProg] = useState<Prog | null>(null)
  const [organizeProg, setOrganizeProg] = useState<{ moved: number; current: string } | null>(null)
  const [classifyProg, setClassifyProg] = useState<(Prog & { moved: number }) | null>(null)
  const [regenProg, setRegenProg] = useState<Prog | null>(null)
  const [artistProg, setArtistProg] = useState<Prog | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  // Full data wipe: two-step confirm; optional work-folder deletion (default off).
  const [wipeStep, setWipeStep] = useState<0 | 1 | 2>(0)
  const [wipeFolders, setWipeFolders] = useState(false)

  // General-manga series, grouped the same way the library shows them.
  const normalSeries = (): SeriesGroup[] =>
    groupSeries(
      works.filter((w) => (w.library ?? 'hitomi') === 'normal'),
      seriesRoots(draft)
    )

  // ---- progress events from main → local state + the activity-bar job ----
  const enrichJobRef = useRef<string | null>(null)
  const organizeJobRef = useRef<string | null>(null)
  useEffect(
    () =>
      window.api.onHitomiProgress((p) => {
        if (p.phase === 'enriching') {
          setEnrichProg({ done: p.done, total: p.total })
          if (enrichJobRef.current) updateJob(enrichJobRef.current, { done: p.done, total: p.total })
        } else if (p.phase === 'done') {
          setEnrichProg(null)
          setEnriching(false)
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  useEffect(
    () =>
      window.api.onOrganizeProgress((p) => {
        setOrganizeProg(p.done ? null : { moved: p.moved, current: p.current })
        if (organizeJobRef.current)
          updateJob(organizeJobRef.current, { done: p.moved, detail: p.done ? undefined : p.current })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  useEffect(
    () =>
      window.api.onClassifyProgress((p) =>
        setClassifyProg(p.finished ? null : { done: p.done, total: p.total, moved: p.moved })
      ),
    []
  )

  // ---- hitomi ----

  // Fill artist/tags/language of every coded work from hitomi. Pressing again
  // while running cancels.
  const enrichAll = async (): Promise<void> => {
    if (enriching) {
      window.api.hitomiCancelEnrich()
      return
    }
    setEnriching(true)
    setEnrichProg({ done: 0, total: 0 })
    const jid = startJob('meta', 'hitomi', '메타 채우기 (작가·태그·언어)')
    enrichJobRef.current = jid
    try {
      await window.api.hitomiEnrichAll()
      setWorks(await window.api.getWorks())
      endJob(jid, { status: 'done' })
    } catch (e: any) {
      endJob(jid, { status: 'error', error: String(e?.message ?? e) })
    } finally {
      enrichJobRef.current = null
      setEnriching(false)
      setEnrichProg(null)
    }
  }

  // Move non-Korean works into their language folders.
  const organize = async (): Promise<void> => {
    setOrganizeProg({ moved: 0, current: '' })
    const jid = startJob('organize', 'hitomi', '언어별 폴더 정리')
    organizeJobRef.current = jid
    try {
      setWorks(await window.api.organizeLanguages())
      endJob(jid, { status: 'done' })
    } catch (e: any) {
      endJob(jid, { status: 'error', error: String(e?.message ?? e) })
    } finally {
      organizeJobRef.current = null
      setOrganizeProg(null)
    }
  }

  // Rebuild every hitomi thumbnail: the online cover when the work has a code,
  // else (or if that fails) the local first page.
  const regenThumbs = async (): Promise<void> => {
    const ids = thumbTargetIds(works, 'hitomi', seriesRoots(draft))
    if (!ids.length) {
      notify('히토미 작품이 없습니다.')
      return
    }
    setRegenProg({ done: 0, total: ids.length })
    const jid = startJob('thumb', 'hitomi', '썸네일 재생성')
    updateJob(jid, { total: ids.length })
    const byId = new Map(works.map((w) => [w.id, w]))
    let done = 0
    for (const id of ids) {
      const code = byId.get(id)?.code ?? null
      const ok = code
        ? await window.api
            .hitomiRegenCover(id, code)
            .then((r) => r.ok)
            .catch(() => false)
        : false
      if (!ok) await regenLocalThumb(id).catch(() => {})
      done++
      setRegenProg({ done, total: ids.length })
      updateJob(jid, { done })
    }
    setRegenProg(null)
    endJob(jid, { status: 'done', detail: `${done}개 썸네일 재생성` })
    bumpThumbNonce() // cards reload their thumbs
    notify(`썸네일 재생성 완료 — ${done}개.`)
  }

  // Move works whose code 404s on hitomi into the deleted-works folder.
  const classifyDeleted = async (): Promise<void> => {
    if (!draft.deletedDir) {
      notify('먼저 “삭제된 작품 폴더”를 지정하세요.')
      return
    }
    setClassifyProg({ done: 0, total: 0, moved: 0 })
    try {
      const r = await window.api.classifyDeleted()
      setWorks(r.works)
      notify(
        `삭제된 작품 분류 완료 — ${r.checked}개 확인, ${r.moved}개 이동` +
          (r.uncertain ? `, ${r.uncertain}개 확인 불가(네트워크)로 건너뜀` : '')
      )
    } catch (e: any) {
      notify(String(e?.message ?? e))
    } finally {
      setClassifyProg(null)
    }
  }

  // ---- general manga ----

  // One thumbnail per series: the online cover found by title, else the
  // representative chapter's first page.
  const fillThumbsNormal = async (): Promise<void> => {
    const series = normalSeries()
    if (!series.length) {
      notify('일반 만화 시리즈가 없습니다.')
      return
    }
    setRegenProg({ done: 0, total: series.length })
    const jid = startJob('thumb', 'normal', '썸네일 생성')
    updateJob(jid, { total: series.length })
    let ok = 0
    for (let i = 0; i < series.length; i++) {
      const rep = series[i].chapters[0]
      if (rep) {
        let done = await window.api
          .tokiRegenCover([rep.id], series[i].title)
          .then((r) => r.ok)
          .catch(() => false)
        if (!done) done = await regenLocalThumb(rep.id).then(() => true).catch(() => false)
        if (done) ok++
      }
      setRegenProg({ done: i + 1, total: series.length })
      updateJob(jid, { done: i + 1 })
    }
    setRegenProg(null)
    endJob(jid, { status: 'done', detail: `${ok}/${series.length}개 썸네일` })
    bumpThumbNonce()
    notify(`썸네일 생성 완료 — ${ok}/${series.length}개 시리즈.`)
  }

  // Fill the artist of series that have none from the first online search hit.
  const fillArtists = async (): Promise<void> => {
    const series = normalSeries().filter((s) => s.chapters.every((c) => !c.artist))
    if (!series.length) {
      notify('작가 이름이 없는 시리즈가 없습니다.')
      return
    }
    setArtistProg({ done: 0, total: series.length })
    const jid = startJob('meta', 'normal', '작가 이름 채우기')
    updateJob(jid, { total: series.length })
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
      updateJob(jid, { done: i + 1 })
    }
    setArtistProg(null)
    endJob(jid, { status: 'done', detail: `${ok}/${series.length}개 시리즈` })
    notify(`작가 채우기 완료 — ${ok}/${series.length}개 시리즈.`)
  }

  // Rename every chapter folder to "<n>화 <subtitle>" (or "<n>화"), using the
  // same chapter analysis the reader/home show; the series name stays only on
  // the parent folder.
  const renameChapters = async (): Promise<void> => {
    const items = normalSeries().flatMap((s) =>
      analyzeSeries(s.chapters, s.title, draft.normalChapterScheme).map((ci) => ({
        id: ci.work.id,
        name: ci.subtitle ? `${ci.label} ${ci.subtitle}` : ci.label
      }))
    )
    if (!items.length) {
      notify('일반 만화 작품이 없습니다.')
      return
    }
    const updated = await window.api.renameNormalChapters(items)
    updated.forEach(upsertWork)
    notify(`화 폴더 이름 정리 완료 — ${updated.length}개 폴더 변경.`)
  }

  // How chapter numbering is detected, previewed on the first series.
  const chapterPreview = useMemo(() => {
    const series = normalSeries()
    if (!series.length) return null
    const s = series[0]
    return {
      title: s.title,
      eff: effectiveChapterScheme(s.chapters, draft.normalChapterScheme),
      labels: analyzeSeries(s.chapters, s.title, draft.normalChapterScheme)
        .slice(0, 6)
        .map((i) => i.label),
      more: s.chapters.length > 6
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [works, draft.normalRoots, draft.normalChapterScheme])

  // ---- reset ----

  // Reset every setting to its default but keep folders and lists.
  const resetAll = async (): Promise<void> => {
    const keep = Object.fromEntries(KEEP_ON_RESET.map((k) => [k, draft[k]])) as Partial<Settings>
    const saved = await window.api.saveSettings({ ...DEFAULT_SETTINGS, ...keep })
    applySaved(saved)
    setExcluded(saved.excludedImageHashes)
    clearTranslation()
    setConfirmReset(false)
    notify('설정을 기본값으로 초기화했습니다. (폴더 설정은 유지)')
  }

  const scanRow = (
    <SettingRow title="라이브러리 스캔" desc="모든 폴더를 다시 읽어 라이브러리를 갱신하고 썸네일을 생성합니다.">
      <button className="btn primary" onClick={() => scanLibraryJob()} disabled={scanning}>
        {scanning ? '스캔 중…' : '스캔'}
      </button>
    </SettingRow>
  )

  return (
    <>
      <section data-cat="manage">
        <h2>라이브러리</h2>
        {isHitomi ? (
          <>
            <SettingRow
              title="라이브러리 스캔 후 자동으로 언어별 폴더 정리"
              desc="스캔 직후 한국어가 아닌 작품을 언어별 폴더로 자동 이동합니다."
            >
              <Toggle checked={draft.autoOrganizeOnScan} onChange={(v) => patch({ autoOrganizeOnScan: v })} />
            </SettingRow>
            {scanRow}
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
              <button className="btn" onClick={regenThumbs} disabled={regenProg !== null}>
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
              <RadioCards<Settings['normalChapterScheme']>
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
                  예: <b>{chapterPreview.title}</b> — 현재 <b>{chapterPreview.eff === 'token' ? '화 토큰' : '앞 번호'}</b>로
                  인식 → {chapterPreview.labels.join(', ')}
                  {chapterPreview.more ? ' …' : ''}
                </p>
              )}
            </div>
            <SettingRow title="시리즈 병합" desc="같은 제목인데 여러 폴더로 나뉜 시리즈를 후보를 보고 직접 골라 하나로 합칩니다.">
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
            {scanRow}
          </>
        )}
        <SettingRow title="전체 초기화" desc="모든 설정값을 기본값으로 되돌립니다. 폴더 설정과 작품 파일은 유지됩니다.">
          <button className="btn danger" onClick={() => setConfirmReset(true)}>
            초기화
          </button>
        </SettingRow>
        <SettingRow
          title="완전 초기화 (모든 데이터 삭제)"
          desc="설정·라이브러리·세션·즐겨찾기·쿠키 등 앱의 모든 데이터를 삭제하고 최초 실행 상태로 되돌립니다. 되돌릴 수 없습니다."
        >
          <button
            className="btn danger"
            onClick={() => {
              setWipeFolders(false)
              setWipeStep(1)
            }}
          >
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
                <Stepper value={draft.flattenCollectThreshold ?? 0} onChange={(v) => patch({ flattenCollectThreshold: v })} />
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
                <button
                  className="mini"
                  onClick={async () => {
                    const dir = await window.api.pickFolder()
                    if (dir) patch({ deletedDir: dir })
                  }}
                >
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
                <button className="btn primary" onClick={classifyDeleted} disabled={!!classifyProg || !draft.deletedDir}>
                  {classifyProg ? '확인 중…' : '갱신 (삭제 작품 분류)'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <SettingRow title="썸네일 생성" desc="제목으로 온라인에서 표지를 먼저 찾고, 없으면 대표 1화 첫 페이지로 만듭니다.">
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
          <SettingRow title="일반 만화 모드와 탭 통합" desc="히토미와 일반 만화의 탭을 한 줄로 함께 표시합니다. 끄면 모드별로 탭이 분리됩니다.">
            <Toggle checked={draft.unifyTabsAcrossModes} onChange={(v) => patch({ unifyTabsAcrossModes: v })} />
          </SettingRow>
        </section>
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
              설정·라이브러리·세션·즐겨찾기·쿠키 등 앱의 <b>모든 데이터</b>가 삭제되고 최초 실행 상태로 돌아갑니다.
              <label className="wipe-check">
                <input type="checkbox" checked={wipeFolders} onChange={(e) => setWipeFolders(e.target.checked)} />
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
    </>
  )
}
