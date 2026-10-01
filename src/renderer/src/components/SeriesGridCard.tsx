import { useState } from 'react'
import type { JSX } from 'react'
import type { SeriesGroup } from '../util'
import { useStore } from '../store'
import { allTags, tagToken, CHAP_FAV_PREFIX, titleKey } from '../util'
import Thumb from './Thumb'
import { ArtistLinks } from './ArtistLinks'
import Stars from './Stars'
import TagList from './TagList'
import FavGroup from './FavGroup'
import ContextMenu from './ContextMenu'

// Compact grid tile for a general-manga series (mirrors WorkGridCard). Shows the
// representative chapter's cover; favorite/rank apply to the whole series.
export default function SeriesGridCard({ series }: { series: SeriesGroup }): JSX.Element {
  const openTab = useStore((s) => s.openTab)
  const openTabBackground = useStore((s) => s.openTabBackground)
  const openGlance = useStore((s) => s.openGlance)
  const openSplit = useStore((s) => s.openSplit)
  const splitOpen = useStore((s) => !!s.tabs.find((t) => t.id === s.activeTabId)?.split)
  const upsertWork = useStore((s) => s.upsertWork)
  const addSearchToken = useStore((s) => s.addSearchToken)
  const favoriteTags = useStore((s) => s.settings.favoriteTags)
  const toggleNormalFav = useStore((s) => s.toggleNormalFav)
  const favSeries = useStore((s) => s.settings.normalFavSeries)
  const toggleNormalUnifiedFav = useStore((s) => s.toggleNormalUnifiedFav)
  // Same series favorited online (toki) → counts as favorited here too.
  const onlineTitleFav = useStore((s) => {
    const k = titleKey(series.title)
    return !!k && Object.values(s.onlineFavs).some((f) => f.favorite && /^https?:/.test(f.code) && titleKey(f.title) === k)
  })
  const favChapters = useStore((s) => s.settings.normalFavChapters)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [crossMenu, setCrossMenu] = useState<{ x: number; y: number; query: string; raw: string } | null>(null)
  const searchOnline = useStore((s) => s.searchOnline)
  const addFavoriteTag = useStore((s) => s.addFavoriteTag)
  const [adding, setAdding] = useState(false)
  const [newTag, setNewTag] = useState('')

  const chapters = series.chapters
  const rep = chapters[0]
  const maxRank = Math.max(0, ...chapters.map((c) => c.rank))
  const artist = chapters.find((c) => c.artist)?.artist ?? null

  // In-app favorites: a normal series card favorites the whole SERIES (by key);
  // a synthetic chapter entry (fav view) favorites just that chapter (by work id).
  const isChapterEntry = series.key.startsWith(CHAP_FAV_PREFIX)
  const isFav = isChapterEntry
    ? (favChapters ?? []).includes(rep?.id ?? '')
    : (favSeries ?? []).includes(series.key) || onlineTitleFav
  const favAll = async (e: React.MouseEvent): Promise<void> => {
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
  const addTag = async (): Promise<void> => {
    const t = newTag.trim()
    if (t && rep) upsertWork(await window.api.addManualTag(rep.id, t))
    setNewTag('')
    setAdding(false)
  }
  const removeTag = async (tag: string): Promise<void> => {
    if (rep) upsertWork(await window.api.removeManualTag(rep.id, tag))
  }

  return (
    <div
      className="gtile series"
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
      <div className="gtile-thumb">
        <Thumb workId={rep?.id ?? ''} />
      </div>
      <div className="gtile-foot" onClick={(e) => e.stopPropagation()}>
        <Stars rank={maxRank} onChange={rankAll} />
        {rep && (
          <FavGroup favorite={isFav} onToggle={favAll} work={rep} applyTo={chapters} />
        )}
      </div>
      <div className="gtile-title selectable">{series.title}</div>
      <div className="gtile-meta">
        전체 {chapters.length}화{artist && ' · '}
        {artist && (
          <ArtistLinks
            artist={artist}
            onPick={(a) => addSearchToken(tagToken(`artist:${a}`))}
            onMenu={(a, e) => setCrossMenu({ x: e.clientX, y: e.clientY, query: tagToken(`artist:${a}`), raw: a })}
          />
        )}
      </div>
      <div className="gtile-tags">
        {rep && (
          <TagList
            tags={allTags(rep)}
            favoriteTags={favoriteTags}
            manualTags={rep.manualTags}
            onTagClick={(t) => addSearchToken(tagToken(t))}
            onTagContext={(t, e) => setCrossMenu({ x: e.clientX, y: e.clientY, query: tagToken(t), raw: t })}
            onRemove={removeTag}
            onAddClick={adding ? undefined : () => setAdding(true)}
            singleLine={false}
            lines={2}
          />
        )}
        {adding && (
          <input
            autoFocus
            className="tag-input"
            value={newTag}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setNewTag(e.target.value)}
            onBlur={addTag}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
            placeholder="태그…"
          />
        )}
      </div>
      {menu && rep && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: '새 탭에서 열기', onClick: () => openTab(rep.id) },
            { label: '백그라운드에서 열기', onClick: () => openTabBackground(rep.id) },
            { label: splitOpen ? '오른쪽 뷰에서 열기' : '분할 뷰에서 열기', onClick: () => openSplit(rep.id) }
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
    </div>
  )
}
