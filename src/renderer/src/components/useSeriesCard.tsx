import { useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import type { Work } from '../../../shared/types'
import { useStore, lastReadKey } from '../store'
import { CHAP_FAV_PREFIX, isOnlineTitleFav, type SeriesGroup } from '../util'
import ContextMenu from './ContextMenu'
import { useTagMenu } from './useTagMenu'

// Stable empty fallback — never return a fresh array from a zustand selector
// (useSyncExternalStore would see a new reference every read → infinite loop).
const NO_TAGS: string[] = []

// Everything a general-manga series card (list SeriesCard / grid
// SeriesGridCard) does besides its layout. A series opens at its
// representative chapter (`rep`, chapter 1); favorite / rank / group / delete
// apply to the whole series.
//
// Favorites are in-app (no folder move) and unified with the online (toki)
// favorite of the same title. In the favorites view a single favorited chapter
// shows as a synthetic entry (key CHAP_FAV_PREFIX + work id) whose heart
// toggles just that chapter.
//
// Tags: a card shows the SERIES tags (settings.seriesTags). Entering
// "artist:…" / "language:…" instead sets that field on every chapter.
export function useSeriesCard(series: SeriesGroup): {
  chapters: Work[]
  rep: Work | undefined
  artist: string | null
  language: string | null
  maxRank: number
  cardEvents: {
    onClickCapture: (e: MouseEvent) => void
    onClick: () => void
    onMouseDown: (e: MouseEvent) => void
    onAuxClick: (e: MouseEvent) => void
    onContextMenu: (e: MouseEvent) => void
  }
  isFav: boolean
  toggleFav: (e: MouseEvent) => Promise<void>
  rankAll: (r: number) => Promise<void>
  clearField: (field: 'artist' | 'language') => Promise<void>
  seriesTags: string[]
  removeSeriesTag: (t: string) => Promise<void>
  adding: boolean
  startAddTag: () => void
  tagInput: JSX.Element | null
  // Context menu + the "new group" prompt it can open; render both once.
  seriesMenu: JSX.Element | null
  openTagMenu: (e: MouseEvent, query: string, raw: string) => void
  tagMenu: JSX.Element | null
} {
  const openTab = useStore((s) => s.openTab)
  const openTabBackground = useStore((s) => s.openTabBackground)
  const openGlance = useStore((s) => s.openGlance)
  const openSplit = useStore((s) => s.openSplit)
  const splitOpen = useStore((s) => !!s.tabs.find((t) => t.id === s.activeTabId)?.split)
  const upsertWork = useStore((s) => s.upsertWork)
  const createGroup = useStore((s) => s.createGroup)
  const allGroups = useStore((s) => s.settings.groups)
  const seriesTags = useStore((s) => s.settings.seriesTags?.[series.key] ?? NO_TAGS)
  const setSeriesTags = useStore((s) => s.setSeriesTags)
  const toggleNormalFav = useStore((s) => s.toggleNormalFav)
  const toggleNormalUnifiedFav = useStore((s) => s.toggleNormalUnifiedFav)
  const favSeries = useStore((s) => s.settings.normalFavSeries)
  const favChapters = useStore((s) => s.settings.normalFavChapters)
  const onlineTitleFav = useStore((s) => isOnlineTitleFav(s.onlineFavs, series.title))
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [adding, setAdding] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [newGrp, setNewGrp] = useState(false)
  const [grpName, setGrpName] = useState('')
  const { openTagMenu, tagMenu } = useTagMenu('online')

  const chapters = series.chapters
  const rep = chapters[0]
  // What a click opens: with 이어보기 on, the most recently read chapter; else
  // the first.
  const resumeOn = useStore((s) => s.settings.resumeReading !== false)
  const lastId = useStore((s) => (resumeOn ? lastReadKey(s.readProgress, chapters.map((c) => c.id)) : null))
  const openId = lastId ?? rep?.id
  const artist = chapters.find((c) => c.artist)?.artist ?? null
  const language = chapters.find((c) => c.language)?.language ?? null
  const maxRank = Math.max(0, ...chapters.map((c) => c.rank))

  const cardEvents = {
    // Capture phase: Alt+click anywhere (even over chips) → Glance; a text
    // selection (drag-to-copy) never opens anything.
    onClickCapture: (e: MouseEvent): void => {
      if (window.getSelection()?.toString()) return e.stopPropagation()
      if (e.altKey && openId) {
        e.preventDefault()
        e.stopPropagation()
        openGlance({ workId: openId })
      }
    },
    onClick: (): void => {
      if (openId) openTab(openId)
    },
    onMouseDown: (e: MouseEvent): void => {
      if (e.button === 1) e.preventDefault() // block middle-click autoscroll
    },
    onAuxClick: (e: MouseEvent): void => {
      if (e.button !== 1 || !openId) return
      e.preventDefault()
      openTabBackground(openId)
    },
    onContextMenu: (e: MouseEvent): void => {
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY })
    }
  }

  const isChapterEntry = series.key.startsWith(CHAP_FAV_PREFIX)
  const isFav = isChapterEntry
    ? (favChapters ?? []).includes(rep?.id ?? '')
    : (favSeries ?? []).includes(series.key) || onlineTitleFav
  const toggleFav = async (e: MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (isChapterEntry) {
      if (rep) await toggleNormalFav('chapter', rep.id, !isFav)
    } else {
      await toggleNormalUnifiedFav({ title: series.title, localKey: series.key })
    }
  }

  const rankAll = async (r: number): Promise<void> => {
    for (const c of chapters) upsertWork(await window.api.setRank(c.id, r))
  }

  // An empty "artist:" / "language:" manual tag clears that field (main side).
  const clearField = async (field: 'artist' | 'language'): Promise<void> => {
    for (const c of chapters) upsertWork(await window.api.addManualTag(c.id, `${field}:`))
  }

  const addSeriesTag = async (): Promise<void> => {
    const t = newTag.trim()
    setNewTag('')
    setAdding(false)
    if (!t) return
    if (/^(artist|language):/i.test(t)) {
      for (const c of chapters) upsertWork(await window.api.addManualTag(c.id, t))
    } else {
      await setSeriesTags(series.key, [...new Set([...seriesTags, t.toLowerCase()])])
    }
  }
  const removeSeriesTag = (t: string): Promise<void> =>
    setSeriesTags(
      series.key,
      seriesTags.filter((x) => x !== t)
    )
  const tagInput = adding ? (
    <input
      autoFocus
      className="tag-input"
      value={newTag}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setNewTag(e.target.value)}
      onBlur={addSeriesTag}
      onKeyDown={(e) => e.key === 'Enter' && addSeriesTag()}
      placeholder="시리즈 태그…"
    />
  ) : null

  // Groups (general-manga ones only): every chapter joins the chosen group.
  const normalGroups = allGroups.filter((g) => (g.mode ?? 'hitomi') === 'normal')
  const addToGroup = async (gid: string): Promise<void> => {
    try {
      for (const c of chapters) upsertWork(await window.api.setWorkGroups(c.id, [gid]))
    } catch (e: any) {
      alert(String(e?.message ?? e))
    }
  }
  const createAndAssign = async (): Promise<void> => {
    const name = grpName.trim()
    setGrpName('')
    setNewGrp(false)
    if (!name) return
    const id = await createGroup(name)
    if (id) await addToGroup(id)
  }

  const seriesMenu = (
    <>
      {menu && rep && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: '새 탭에서 열기', onClick: () => openTab(rep.id) },
            { label: '백그라운드에서 열기', onClick: () => openTabBackground(rep.id) },
            { label: splitOpen ? '오른쪽 뷰에서 열기' : '분할 뷰에서 열기', onClick: () => openSplit(rep.id) },
            ...normalGroups.map((g) => ({ label: `그룹 · ${g.name}`, onClick: () => addToGroup(g.id) })),
            { label: '＋ 새 그룹에 추가', onClick: () => setNewGrp(true) }
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {newGrp && (
        <div className="modal-overlay" onClick={() => setNewGrp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>새 그룹에 추가</h2>
            </div>
            <input
              autoFocus
              className="tag-input"
              style={{ margin: 12, width: 'calc(100% - 24px)' }}
              value={grpName}
              onChange={(e) => setGrpName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createAndAssign()}
              placeholder="새 그룹 이름"
            />
          </div>
        </div>
      )}
    </>
  )

  return {
    chapters,
    rep,
    artist,
    language,
    maxRank,
    cardEvents,
    isFav,
    toggleFav,
    rankAll,
    clearField,
    seriesTags,
    removeSeriesTag,
    adding,
    startAddTag: () => setAdding(true),
    tagInput,
    seriesMenu,
    openTagMenu,
    tagMenu
  }
}
