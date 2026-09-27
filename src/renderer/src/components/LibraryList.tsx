import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { selectWorks, allTags, matchesSearch, analyzeSeries, seriesOf, tagToken, artistFolderOf } from '../util'
import type { SortMode, Work } from '../../../shared/types'
import Thumb from './Thumb'
import Stars from './Stars'
import FavGroup from './FavGroup'
import { ChapterRow } from './SeriesCard'
import ContextMenu from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import ConfirmModal from './ConfirmModal'
import Pager from './Pager'

const PAGE_SIZE = 40 // hitomi list is paginated (like the online list) to keep the
// DOM small — an unvirtualized full library made the pane-resize reflow stutter.

// Compact, always-visible work list shown on the left while reading. Supports
// favorite + rank inline, and group assignment via the right-click menu.
export default function LibraryList(): JSX.Element {
  const works = useStore((s) => s.works)
  const filter = useStore((s) => s.filter)
  const globalSort = useStore((s) => s.sort)
  const seed = useStore((s) => s.randomSeed)
  const ignoreBrackets = useStore((s) => s.settings.ignoreBracketTagsInSort)
  const groups = useStore((s) => s.settings.groups)
  const normalRootsSetting = useStore((s) => s.settings.normalRoots)
  const normalFav = useStore((s) => s.settings.normalFavoritesDir)
  const scheme = useStore((s) => s.settings.normalChapterScheme)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const openTab = useStore((s) => s.openTab)
  const replaceTabWork = useStore((s) => s.replaceTabWork)
  const openTabBackground = useStore((s) => s.openTabBackground)
  const openSplit = useStore((s) => s.openSplit)
  const upsertWork = useStore((s) => s.upsertWork)
  const createGroup = useStore((s) => s.createGroup)
  const setReadingQueue = useStore((s) => s.setReadingQueue)

  const [input, setInput] = useState('')
  const [applied, setApplied] = useState('')
  const [sort] = useState<SortMode>(globalSort)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [moveTo, setMoveTo] = useState<{ workId: string; gid: string; name: string } | null>(null)

  const activeWorkId = tabs.find((t) => t.id === activeTabId)?.workId
  const activeWork = works.find((w) => w.id === activeWorkId)
  const normalRoots = useMemo(
    () => [...(normalRootsSetting ?? []), normalFav].filter(Boolean) as string[],
    [normalRootsSetting, normalFav]
  )
  const isNormalActive = !!activeWork && (activeWork.library ?? 'hitomi') === 'normal'
  const flattenRoots = useStore((s) => s.settings.flattenRoots)
  // If the active hitomi work sits under an "artist folder" (flattenRoots), the
  // left list is locked to just that folder's works (that artist), and continuous
  // reading flows across them automatically.
  const activeArtistFolder = useMemo(
    () =>
      activeWork && (activeWork.library ?? 'hitomi') !== 'normal'
        ? artistFolderOf(activeWork.path, flattenRoots ?? [])
        : null,
    [activeWork, flattenRoots]
  )

  // For general-manga works the left list shows the current series' chapters (in
  // chapter order); a search just filters within the series. Otherwise it's the
  // usual full-library list with the chosen sort/filter.
  // The active general-manga work's series (chapters), computed once.
  const activeGroup = useMemo(
    () => (isNormalActive && activeWork ? seriesOf(activeWork, works, normalRoots) : null),
    [isNormalActive, activeWork, works, normalRoots]
  )

  const list = useMemo(() => {
    if (activeGroup) {
      return applied.trim() ? activeGroup.chapters.filter((w) => matchesSearch(w, applied)) : activeGroup.chapters
    }
    // Hitomi list must not include general-manga works (separate libraries).
    const hitomiWorks = works.filter((w) => (w.library ?? 'hitomi') !== 'normal')
    // Under an artist folder → lock the list to that folder's works (that artist),
    // regardless of the search/filter box.
    if (activeArtistFolder) {
      const inFolder = hitomiWorks.filter(
        (w) => artistFolderOf(w.path, flattenRoots ?? []) === activeArtistFolder
      )
      return selectWorks(inFolder, '', { kind: 'all' }, sort, seed, ignoreBrackets)
    }
    return selectWorks(hitomiWorks, applied, filter, sort, seed, ignoreBrackets)
  }, [activeGroup, activeArtistFolder, flattenRoots, works, applied, filter, sort, seed, ignoreBrackets])

  // Publish the current list order as the reading queue so the reader can flow
  // from one work into the next. General manga flows across a series' chapters;
  // an artist folder flows across that artist's works; a plain hitomi list flows
  // ONLY when it's an artist search — a normal browse shouldn't spill over.
  useEffect(() => {
    const artistSearch = /(^|[\s,])-?artist:/i.test(applied)
    const enable = activeGroup || activeArtistFolder ? true : artistSearch
    setReadingQueue(enable ? list.map((w) => w.id) : [])
  }, [list, applied, activeGroup, activeArtistFolder, setReadingQueue])

  // Chapter labels/subtitles for the general-manga left list.
  const infos = useMemo(
    () => (activeGroup ? analyzeSeries(list, activeGroup.title, scheme) : []),
    [activeGroup, list, scheme]
  )

  // Paginate the (unvirtualized) hitomi list so only PAGE_SIZE rows are in the
  // DOM at once — same idea as the online list. The general-manga series list is
  // already short, so it isn't paged.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [applied, filter, sort, seed, activeGroup])
  const lastPage = activeGroup ? -1 : Math.max(0, Math.ceil(list.length / PAGE_SIZE) - 1)
  const pageItems = activeGroup ? list : list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const goPage = (p: number): void => {
    setPage(p)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }
  const apply = (): void => setApplied(input.trim())
  const addToken = (tok: string): void =>
    setInput((cur) => (cur.trim() ? cur.trim() + ' ' + tok : tok))

  const toggleFav = async (w: Work): Promise<void> =>
    upsertWork(await window.api.setFavorite(w.id, !w.favorite))
  const setRank = async (w: Work, r: number): Promise<void> =>
    upsertWork(await window.api.setRank(w.id, r))
  const applyGroup = async (id: string, ids: string[]): Promise<void> =>
    upsertWork(await window.api.setWorkGroups(id, ids))

  // Single-group semantics: switching groups asks first (folder moves).
  const pickGroup = (w: Work, gid: string, name: string): void => {
    const cur = (w.groups ?? [])[0]
    if (gid === cur) return
    if (!cur) applyGroup(w.id, [gid])
    else setMoveTo({ workId: w.id, gid, name })
  }

  const menuItems = (id: string): MenuItem[] => {
    const w = works.find((x) => x.id === id)
    const splitOpen = !!tabs.find((t) => t.id === activeTabId)?.split
    const items: MenuItem[] = [
      { label: '새 탭에서 열기', onClick: () => openTab(id) },
      { label: '백그라운드에서 열기', onClick: () => openTabBackground(id) },
      { label: splitOpen ? '오른쪽 뷰에서 열기' : '분할 뷰에서 열기', onClick: () => openSplit(id) }
    ]
    if (w) {
      const wMode = w.library ?? 'hitomi'
      const sub: MenuItem[] = groups
        .filter((g) => (g.mode ?? 'hitomi') === wMode)
        .map((g) => ({
        label: (w.groups ?? [])[0] === g.id ? `✓ ${g.name}` : g.name,
        onClick: () => pickGroup(w, g.id, g.name)
      }))
      sub.push({
        label: '＋ 새 그룹',
        onClick: async () => {
          const gid = await createGroup('새 그룹')
          if (gid) applyGroup(w.id, [gid])
        }
      })
      items.push({ label: '그룹에 추가', children: sub })
      if ((w.groups ?? []).length) items.push({ label: '그룹에서 제거', onClick: () => applyGroup(w.id, []) })
    }
    items.push({ label: '현재 탭에서 열기', onClick: () => (activeTabId ? replaceTabWork(activeTabId, 'left', id) : openTab(id)) })
    return items
  }

  return (
    <div className="lib-list">
      {isNormalActive && (
        <div className="lib-list-head">
          <span className="lib-series-label">📖 시리즈 · {list.length}화</span>
        </div>
      )}
      <div className="lib-search-row">
        <input
          className="search sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          placeholder="검색 후 Enter (태그/작가 클릭 시 추가)"
        />
        <button className="mini search-btn" onClick={apply} title="검색">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {applied && (
        <div className="applied-row">
          <span className="applied-q">“{applied}”</span>
          <span
            className="mini"
            onClick={() => {
              setInput('')
              setApplied('')
            }}
          >
            초기화
          </span>
        </div>
      )}
      <div className={`lib-list-scroll ${isNormalActive ? 'compact' : ''}`} ref={scrollRef}>
        {isNormalActive
          ? infos.map((ci) => (
              <ChapterRow
                key={ci.work.id}
                info={ci}
                active={ci.work.id === activeWorkId}
                // Chapter navigation swaps the work IN the current tab (like the
                // online reader), instead of spawning a new tab per chapter.
                onOpen={() =>
                  activeTabId
                    ? replaceTabWork(activeTabId, 'left', ci.work.id)
                    : openTab(ci.work.id)
                }
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, id: ci.work.id })
                }}
              />
            ))
          : pageItems.map((w) => (
              <div
                key={w.id}
                className={`lib-item ${w.id === activeWorkId ? 'active' : ''}`}
                // Left-click swaps the work IN the current tab; use the right-
                // click menu ("새 탭에서 열기") to spawn a new tab instead.
                onClick={() => (activeTabId ? replaceTabWork(activeTabId, 'left', w.id) : openTab(w.id))}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, id: w.id })
                }}
                title={w.title}
              >
                <div className="lib-thumb">
                  <Thumb workId={w.id} />
                </div>
                <div className="lib-item-info">
                  <div className="lib-item-title">{w.title}</div>
                  <div className="lib-item-meta">{w.pageCount}p</div>
                  <div className="lib-chips">
                    {w.artist && (
                      <span
                        className="chip-mini artist"
                        onClick={(e) => {
                          e.stopPropagation()
                          addToken(`artist:${w.artist}`)
                        }}
                      >
                        {w.artist}
                      </span>
                    )}
                    {allTags(w)
                      .slice(0, 5)
                      .map((t) => (
                        <span
                          key={t}
                          className="chip-mini"
                          onClick={(e) => {
                            e.stopPropagation()
                            addToken(tagToken(t))
                          }}
                        >
                          {t}
                        </span>
                      ))}
                  </div>
                  <div className="lib-foot">
                    <Stars rank={w.rank} onChange={(r) => setRank(w, r)} size={14} />
                    <FavGroup
                      favorite={w.favorite}
                      onToggle={(e) => {
                        e.stopPropagation()
                        toggleFav(w)
                      }}
                      work={w}
                    />
                  </div>
                </div>
              </div>
            ))}
        {!isNormalActive && lastPage > 0 && (
          <Pager page={page} lastPage={lastPage} onPage={goPage} small />
        )}
        <div className="result-count">{list.length}개</div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} />
      )}
      {moveTo && (
        <ConfirmModal
          icon="⇄"
          title="그룹을 옮기시겠습니까?"
          desc={
            <>
              이 작품을 <b>{moveTo.name}</b> 그룹으로 옮깁니다. 폴더도 함께 이동합니다.
            </>
          }
          confirmLabel="옮김"
          cancelLabel="유지"
          onConfirm={() => {
            applyGroup(moveTo.workId, [moveTo.gid])
            setMoveTo(null)
          }}
          onCancel={() => setMoveTo(null)}
        />
      )}
    </div>
  )
}
