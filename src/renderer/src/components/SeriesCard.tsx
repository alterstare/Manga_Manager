import { useMemo, useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import type { SeriesGroup, ChapterInfo } from '../util'
import { analyzeSeries, CHAP_FAV_PREFIX, tagToken } from '../util'
import { useStore } from '../store'
import Thumb from './Thumb'
import Stars from './Stars'
import FavGroup from './FavGroup'
import TagList from './TagList'
import ContextMenu from './ContextMenu'
import ConfirmModal from './ConfirmModal'

// Open a folder's parent in Explorer (so we don't descend into chapter 1).
function parentOf(p: string): string {
  return p.replace(/[\\/][^\\/]*$/, '')
}

// Stable empty fallback — never return a fresh array from a zustand selector
// (useSyncExternalStore would see a new reference every read → infinite loop).
const NO_TAGS: string[] = []

// Home entry for one general-manga series. Series-level favorite/rank/group and
// series tags are separate from each chapter's. "화 목록" lists chapters with
// their own label + subtitle + tags.
export default function SeriesCard({ series }: { series: SeriesGroup }): JSX.Element {
  const openTab = useStore((s) => s.openTab)
  const openTabBackground = useStore((s) => s.openTabBackground)
  const openGlance = useStore((s) => s.openGlance)
  const openSplit = useStore((s) => s.openSplit)
  const splitOpen = useStore((s) => !!s.tabs.find((t) => t.id === s.activeTabId)?.split)
  const createGroup = useStore((s) => s.createGroup)
  const allGroups = useStore((s) => s.settings.groups)
  const upsertWork = useStore((s) => s.upsertWork)
  const removeWork = useStore((s) => s.removeWork)
  const favoriteTags = useStore((s) => s.settings.favoriteTags)
  const scheme = useStore((s) => s.settings.normalChapterScheme)
  const seriesTagsMap = useStore((s) => s.settings.seriesTags)
  const seriesTags = seriesTagsMap?.[series.key] ?? NO_TAGS
  const setSeriesTags = useStore((s) => s.setSeriesTags)
  const toggleNormalFav = useStore((s) => s.toggleNormalFav)
  const favSeries = useStore((s) => s.settings.normalFavSeries)
  const favChapters = useStore((s) => s.settings.normalFavChapters)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [crossMenu, setCrossMenu] = useState<{ x: number; y: number; query: string; raw: string } | null>(null)
  const searchOnline = useStore((s) => s.searchOnline)
  const addFavoriteTag = useStore((s) => s.addFavoriteTag)
  const [newGrp, setNewGrp] = useState(false)
  const [grpName, setGrpName] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)

  const chapters = series.chapters
  const rep = chapters[0]
  // In-app favorite (no folder move). A synthetic chapter entry (fav view) toggles
  // just that chapter; a real series card toggles the whole SERIES by key.
  const isChapterEntry = series.key.startsWith(CHAP_FAV_PREFIX)
  const isFav = isChapterEntry
    ? (favChapters ?? []).includes(rep?.id ?? '')
    : (favSeries ?? []).includes(series.key)
  const maxRank = Math.max(0, ...chapters.map((c) => c.rank))
  const artist = chapters.find((c) => c.artist)?.artist ?? null
  const language = chapters.find((c) => c.language)?.language ?? null
  const infos = useMemo(() => analyzeSeries(chapters, series.title, scheme), [chapters, series.title, scheme])

  const favAll = async (): Promise<void> => {
    if (isChapterEntry) {
      if (rep) await toggleNormalFav('chapter', rep.id, !isFav)
    } else {
      await toggleNormalFav('series', series.key, !isFav)
    }
  }
  const rankAll = async (r: number): Promise<void> => {
    for (const c of chapters) upsertWork(await window.api.setRank(c.id, r))
  }
  // Clear a field (artist/language) on every chapter that has it.
  const clearField = async (field: 'artist' | 'language'): Promise<void> => {
    for (const c of chapters) upsertWork(await window.api.addManualTag(c.id, `${field}:`))
  }
  // Series tag: artist:/language: prefixes apply to chapters; others are series tags.
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
  const removeSeriesTag = async (t: string): Promise<void> =>
    setSeriesTags(series.key, seriesTags.filter((x) => x !== t))

  // General-manga groups only. Add every chapter of the series to one group.
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

  const deleteSeries = async (): Promise<void> => {
    setConfirmDel(false)
    for (const c of chapters) {
      await window.api.deleteWork(c.id)
      removeWork(c.id)
    }
  }

  return (
    <div className="work-card-wrap">
      <div
        className="work-card"
        onClickCapture={(e) => {
          // Dragging to select/copy text must not open a tab.
          if (window.getSelection()?.toString()) return e.stopPropagation()
          if (e.altKey && rep) {
            e.preventDefault()
            e.stopPropagation()
            openGlance({ workId: rep.id })
          }
        }}
        onClick={() => rep && openTab(rep.id)}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault() // block middle-click autoscroll
        }}
        onAuxClick={(e) => {
          if (e.button === 1 && rep) {
            e.preventDefault()
            openTabBackground(rep.id)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <Thumb workId={rep?.id ?? ''} />
        <div className="work-info">
          <div className="work-title-row">
            <span className="work-title selectable">{series.title}</span>
            {rep && (
              <FavGroup
                favorite={isFav}
                onToggle={(e) => {
                  e.stopPropagation()
                  favAll()
                }}
                work={rep}
                applyTo={chapters}
              />
            )}
          </div>

          <div className="work-meta">
            <span>전체 {chapters.length}화</span>
            {language && (
              <span className="lang removable">
                {language}
                <span className="tag-x" onClick={(e) => { e.stopPropagation(); clearField('language') }}>×</span>
              </span>
            )}
            {artist && (
              <span
                className="artist-link removable"
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setCrossMenu({ x: e.clientX, y: e.clientY, query: tagToken(`artist:${artist}`), raw: artist })
                }}
              >
                {artist}
                <span className="tag-x" onClick={(e) => { e.stopPropagation(); clearField('artist') }}>×</span>
              </span>
            )}
          </div>

          <div className="work-tags">
            <TagList tags={seriesTags} favoriteTags={favoriteTags} manualTags={seriesTags} onTagContext={(t, e) => setCrossMenu({ x: e.clientX, y: e.clientY, query: tagToken(t), raw: t })} onRemove={removeSeriesTag} onAddClick={adding ? undefined : () => setAdding(true)} />
            {adding && (
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
            )}
          </div>

          <div className="work-actions">
            <Stars rank={maxRank} onChange={rankAll} />
            <button
              className="mini"
              onClick={(e) => {
                e.stopPropagation()
                if (rep) window.api.openFolder(parentOf(rep.path))
              }}
            >
              폴더 열기
            </button>
            <button
              className="mini danger"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDel(true)
              }}
            >
              삭제
            </button>
            <button
              className={`mini ch-toggle ${open ? 'on' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setOpen((o) => !o)
              }}
            >
              화 목록 {open ? '▴' : '▾'}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="chapter-table">
          {infos.map((ci) => (
            <ChapterRow key={ci.work.id} info={ci} onOpen={() => openTab(ci.work.id)} />
          ))}
        </div>
      )}

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
      {crossMenu && (
        <ContextMenu
          x={crossMenu.x}
          y={crossMenu.y}
          items={[
            { label: '온라인에서 검색', onClick: () => searchOnline(crossMenu.query) },
            { label: '즐겨찾는 태그로 추가', onClick: () => addFavoriteTag(crossMenu.raw) }
          ]}
          onClose={() => setCrossMenu(null)}
        />
      )}
      {confirmDel && (
        <ConfirmModal
          danger
          icon="🗑"
          title="시리즈를 삭제할까요?"
          desc={
            <>
              <b>{series.title}</b> 시리즈 {chapters.length}화를 모두 영구 삭제합니다. 되돌릴 수 없습니다.
            </>
          }
          confirmLabel="삭제"
          cancelLabel="취소"
          onConfirm={deleteSeries}
          onCancel={() => setConfirmDel(false)}
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
    </div>
  )
}

// One chapter: label (+ subtitle) on top, its own tags + add below.
export function ChapterRow({
  info,
  onOpen,
  active,
  onContextMenu
}: {
  info: ChapterInfo
  onOpen: () => void
  active?: boolean
  onContextMenu?: (e: MouseEvent) => void
}): JSX.Element {
  const work = info.work
  const upsertWork = useStore((s) => s.upsertWork)
  const favoriteTags = useStore((s) => s.settings.favoriteTags)
  const toggleNormalFav = useStore((s) => s.toggleNormalFav)
  const favChapters = useStore((s) => s.settings.normalFavChapters)
  const isFav = (favChapters ?? []).includes(work.id)
  const [adding, setAdding] = useState(false)
  const [tag, setTag] = useState('')

  const addTag = async (): Promise<void> => {
    const t = tag.trim()
    if (t) upsertWork(await window.api.addManualTag(work.id, t))
    setTag('')
    setAdding(false)
  }
  const removeTag = async (t: string): Promise<void> =>
    upsertWork(await window.api.removeManualTag(work.id, t))
  const setRank = async (r: number): Promise<void> => upsertWork(await window.api.setRank(work.id, r))

  return (
    <div
      className={`chapter-row ${active ? 'active' : ''}`}
      onClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <div className="chapter-line">
        <span className="ch-label">{info.label}</span>
        {info.subtitle && <span className="ch-subtitle">- {info.subtitle}</span>}
        <span className="ch-pages">{work.pageCount}p</span>
        <span className="ch-spacer" />
        <Stars rank={work.rank} onChange={setRank} size={13} />
        <FavGroup
          favorite={isFav}
          onToggle={(e) => {
            e.stopPropagation()
            toggleNormalFav('chapter', work.id, !isFav)
          }}
          work={work}
        />
      </div>
      {/* No blanket stopPropagation here — empty space in this row must still open
          the chapter. Only the interactive tag controls swallow the click. */}
      <div className="chapter-tags">
        <TagList tags={work.manualTags} favoriteTags={favoriteTags} manualTags={work.manualTags} onRemove={removeTag} onAddClick={adding ? undefined : () => setAdding(true)} />
        {adding && (
          <input
            autoFocus
            className="tag-input sm"
            value={tag}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setTag(e.target.value)}
            onBlur={addTag}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
            placeholder="태그…"
          />
        )}
      </div>
    </div>
  )
}
