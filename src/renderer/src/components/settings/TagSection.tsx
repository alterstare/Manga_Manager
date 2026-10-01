// 태그·검색: favorite (highlighted) tags, online exclude tags, search history,
// favorite searches, and folder-name → genre tag rules (with optional move).
// Plus the 즐겨찾기 box (hitomi): favorites folder, lists, and file.
import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { GenreRule } from '../../../../shared/types'
import { useStore } from '../../store'
import { tagToken } from '../../util'
import SettingRow from '../SettingRow'
import Stepper from '../Stepper'
import Toggle from '../Toggle'
import TagPickInput from '../TagPickInput'
import TagSearchInput from '../TagSearchInput'
import { useSettings } from './context'
import { ChipList, FolderRow } from './parts'

// Last path segment, for compact folder buttons.
const shortPath = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

// Folder-name keyword → genre tag rules; a rule may also carry a folder that
// works with that genre get moved into.
function GenreRules({ tokens }: { tokens: string[] }): JSX.Element {
  const { draft, patch, pickDir, notify } = useSettings()
  const setWorks = useStore((s) => s.setWorks)
  const libraryMode = useStore((s) => s.libraryMode)
  const [moving, setMoving] = useState(false)

  const updateRule = (i: number, r: GenreRule): void => {
    const rules = [...draft.genreRules]
    rules[i] = r
    patch({ genreRules: rules })
  }
  const runMove = async (): Promise<void> => {
    setMoving(true)
    const { startJob, endJob } = useStore.getState()
    const jid = startJob('organize', libraryMode, '장르별 폴더 이동')
    try {
      const r = await window.api.organizeByGenre()
      setWorks(r.works)
      endJob(jid, { status: 'done', detail: `${r.moved}개 이동` })
      notify(`장르별 폴더 이동 완료 — ${r.moved}개.`)
    } catch (e: any) {
      endJob(jid, { status: 'error', error: String(e?.message ?? e) })
    } finally {
      setMoving(false)
    }
  }

  return (
    <div className="set-block">
      <SettingRow
        title="폴더명으로 자동 태그"
        desc="작품 저장 경로 내 폴더명에 키워드 포함시 자동으로 태그를 생성하는 규칙을 정합니다."
      >
        <button className="mini" onClick={() => patch({ genreRules: [...draft.genreRules, { genre: '', keywords: [] }] })}>
          + 규칙 추가
        </button>
      </SettingRow>
      {draft.genreRules.map((rule, i) => (
        <div className="row rule" key={i}>
          <TagPickInput
            value={rule.genre}
            onChange={(v) => updateRule(i, { ...rule, genre: v })}
            tokens={tokens}
            placeholder="장르명"
          />
          <input
            value={rule.keywords.join(', ')}
            placeholder="키워드, 쉼표, 구분"
            onChange={(e) => updateRule(i, { ...rule, keywords: e.target.value.split(',').map((s) => s.trim()) })}
          />
          <button
            className="mini"
            onClick={() => pickDir((d) => updateRule(i, { ...rule, moveDir: d }))}
            title={rule.moveDir ?? '이동 폴더 선택'}
          >
            {rule.moveDir ? shortPath(rule.moveDir) : '이동 폴더'}
          </button>
          {rule.moveDir && (
            <button className="mini danger" onClick={() => updateRule(i, { ...rule, moveDir: null })}>
              ×
            </button>
          )}
          <button className="mini danger" onClick={() => patch({ genreRules: draft.genreRules.filter((_, x) => x !== i) })}>
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
        <button className="btn" onClick={runMove} disabled={moving}>
          {moving ? '이동 중…' : '지금 이동'}
        </button>
      </div>
    </div>
  )
}

// 즐겨찾기 (hitomi): the favorites folder and whether hearting moves works
// into it, imported favorite lists (gallery codes), and the favorites file.
// The hearts themselves are one list shared by the library and online views.
function Favorites(): JSX.Element {
  const { draft, patch, applySaved, notify, pickDir } = useSettings()
  const setWorks = useStore((s) => s.setWorks)
  const setOnlineFavs = useStore((s) => s.setOnlineFavs)
  const [preloading, setPreloading] = useState(false)
  const lists = draft.onlineFavLists ?? []

  const preload = async (): Promise<void> => {
    setPreloading(true)
    const { startJob, updateJob, endJob } = useStore.getState()
    const jid = startJob('meta', 'hitomi', '즐겨찾기 목록 미리 불러오기')
    const off = window.api.onOnlineFavPreload(({ done, total }) => updateJob(jid, { done, total }))
    try {
      const r = await window.api.preloadOnlineFavLists()
      endJob(jid, { status: 'done', detail: `${r.cached}/${r.total}개` })
      notify(`미리 불러오기 완료 — ${r.cached}/${r.total}개 준비됨.`)
    } catch (e: any) {
      endJob(jid, { status: 'error', error: String(e?.message ?? e) })
    } finally {
      off()
      setPreloading(false)
    }
  }

  return (
    <>
      <FolderRow
        title="즐겨찾기 폴더"
        desc="즐겨찾기한 작품을 모아둘 폴더. 이 폴더에 직접 넣은 작품은 다음 스캔 때 즐겨찾기에 추가됩니다."
        path={draft.favoritesDir}
        onPick={() => pickDir((d) => patch({ favoritesDir: d }))}
        onClear={() => patch({ favoritesDir: null })}
        mode="hitomi"
      />
      <SettingRow
        title="즐겨찾기하면 폴더로 이동"
        desc="하트를 누르면 작품 폴더를 즐겨찾기 폴더로 옮기고, 해제하면 원래 위치로 되돌립니다. 끄면 폴더는 그대로 두고 하트만 바뀝니다."
      >
        <Toggle checked={draft.favoriteMoveToFolder !== false} onChange={(v) => patch({ favoriteMoveToFolder: v })} />
      </SettingRow>

      <div className="set-block">
        <SettingRow
          title="즐겨찾기 목록"
          desc="Pupil 호환(hitomi 번호 JSON) 파일을 이름 붙은 목록으로 추가합니다. 온라인에서는 목록 전체를, 라이브러리에서는 받은 작품을 ♥ 옆 ▾에서 골라 볼 수 있습니다."
        >
          <button
            className="mini"
            onClick={async () => {
              const r = await window.api.importOnlineFavList()
              if (!r.ok) return
              patch({ onlineFavLists: (await window.api.getSettings()).onlineFavLists })
              notify(`목록 “${r.name}” — ${r.total}개 추가.`)
            }}
          >
            + 파일 추가
          </button>
        </SettingRow>
        {lists.map((l) => (
          <div className="path-item" key={l.name}>
            <code>
              ★ {l.name} · {l.codes.length}개
            </code>
            <button
              className="mini danger"
              onClick={async () => {
                await window.api.removeOnlineFavList(l.name)
                patch({ onlineFavLists: lists.filter((x) => x.name !== l.name) })
              }}
            >
              제거
            </button>
          </div>
        ))}
        {lists.length > 0 && (
          <SettingRow title="목록 미리 불러오기" desc="모든 목록의 표지·정보를 미리 받아둡니다 (이후 즉시 표시).">
            <button className="btn" disabled={preloading} onClick={preload}>
              {preloading ? '불러오는 중…' : '전체 미리 불러오기'}
            </button>
          </SettingRow>
        )}
      </div>

      <SettingRow
        title="즐겨찾기 파일"
        desc="즐겨찾기(작품 번호·즐겨찾는 태그·평점)를 Pupil 호환 파일로 내보내거나 불러와 합치고, 여러 파일을 하나로 병합합니다."
      >
        <button
          className="mini"
          onClick={async () => {
            const r = await window.api.exportFavorites()
            if (r.ok) notify(`${r.count}개 즐겨찾기를 내보냈습니다.`)
          }}
        >
          내보내기
        </button>
        <button
          className="mini"
          onClick={async () => {
            const r = await window.api.importFavorites()
            if (!r.ok) return
            setWorks(await window.api.getWorks())
            setOnlineFavs(await window.api.getOnlineFavs())
            applySaved(await window.api.getSettings()) // favorite tags were merged in
            notify(`${r.total}개를 즐겨찾기에 합쳤습니다. (라이브러리에 있는 작품 ${r.matched}개)`)
          }}
        >
          불러오기 (병합)
        </button>
        <button
          className="mini"
          onClick={async () => {
            const r = await window.api.mergeFavorites()
            if (r.ok) notify(`${r.files}개 파일을 합쳐 ${r.count}개를 새 파일로 저장했습니다.`)
          }}
        >
          파일 병합
        </button>
      </SettingRow>
    </>
  )
}

export default function TagSection(): JSX.Element {
  const { draft, patch, isHitomi, works } = useSettings()
  const [tagInput, setTagInput] = useState('')
  const [excludeInput, setExcludeInput] = useState('')
  const [favSearchInput, setFavSearchInput] = useState('')
  // Every tag used in the library — autocomplete source for the inputs.
  const allTagTokens = useMemo(() => {
    const s = new Set<string>()
    for (const w of works) {
      w.tags.forEach((t) => s.add(t))
      w.manualTags.forEach((t) => s.add(t))
    }
    return [...s].sort()
  }, [works])
  const excludeTags = draft.onlineExcludeTags ?? []
  const favSearches = draft.favoriteSearches ?? []

  return (
    <>
      <section data-cat="fav">
        <h2>태그·검색</h2>
        <div className="set-block">
          <SettingRow title="즐겨찾는 태그" desc="여기 등록한 태그는 목록에서 강조됩니다. 태그 입력 후 Enter." />
          <TagPickInput
            value={tagInput}
            onChange={setTagInput}
            tokens={allTagTokens}
            className="field-input"
            placeholder="태그 입력 후 Enter"
            onEnter={() => {
              if (!tagInput.trim()) return
              patch({ favoriteTags: [...new Set([...draft.favoriteTags, tagInput.trim().toLowerCase()])] })
              setTagInput('')
            }}
          />
          <ChipList
            items={draft.favoriteTags}
            chipClass="tag fav-tag"
            onRemove={(t) => patch({ favoriteTags: draft.favoriteTags.filter((x) => x !== t) })}
          />
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
              if (!excludeInput.trim()) return
              const tok = tagToken(excludeInput.trim())
              if (!excludeTags.includes(tok)) patch({ onlineExcludeTags: [...excludeTags, tok] })
              setExcludeInput('')
            }}
          />
          <ChipList
            items={excludeTags}
            label={(t) => `-${t}`}
            onRemove={(t) => patch({ onlineExcludeTags: excludeTags.filter((x) => x !== t) })}
          />
        </div>
        <div className="set-block">
          <SettingRow title="검색 기록 사용" desc="온라인 검색창을 누르면 최근 검색어 목록을 보여줍니다.">
            <Toggle checked={draft.searchHistoryEnabled ?? true} onChange={(v) => patch({ searchHistoryEnabled: v })} />
          </SettingRow>
          <SettingRow title="최대 기록 수" desc="저장할 최근 검색어 개수.">
            <Stepper value={draft.searchHistoryMax ?? 20} onChange={(v) => patch({ searchHistoryMax: v })} min={1} step={5} />
          </SettingRow>
          <SettingRow title="검색 기록 전체 삭제" desc="저장된 모든 검색어를 지웁니다.">
            <button className="mini danger" onClick={() => patch({ searchHistory: [] })} disabled={!draft.searchHistory?.length}>
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
              if (!favSearches.includes(q)) patch({ favoriteSearches: [...favSearches, q] })
              setFavSearchInput('')
            }}
            placeholder="태그 입력 후 Enter (조합 예: female:big_breasts, tag:uncensored)"
          />
          <ChipList items={favSearches} onRemove={(f) => patch({ favoriteSearches: favSearches.filter((x) => x !== f) })} />
        </div>
        <GenreRules tokens={allTagTokens} />
      </section>

      {/* General-manga favorites are managed in-app (hearts on series/chapters). */}
      {isHitomi && (
        <section data-cat="fav">
          <h2>즐겨찾기</h2>
          <Favorites />
        </section>
      )}
    </>
  )
}
