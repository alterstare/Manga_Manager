import { useState } from 'react'
import type { JSX } from 'react'
import type { Work } from '../../../shared/types'
import { useStore } from '../store'
import { allTags, tagToken } from '../util'
import { invalidateThumb } from '../thumbs'
import Thumb from './Thumb'
import Stars from './Stars'
import TagList from './TagList'
import FavGroup from './FavGroup'
import ContextMenu from './ContextMenu'

// Grid tile for the home library (compact, image-forward).
export default function WorkGridCard({ work }: { work: Work }): JSX.Element {
  const openTab = useStore((s) => s.openTab)
  const openTabBackground = useStore((s) => s.openTabBackground)
  const openGlance = useStore((s) => s.openGlance)
  const openSplit = useStore((s) => s.openSplit)
  const startDownload = useStore((s) => s.startDownload)
  const searchOnline = useStore((s) => s.searchOnline)
  const addFavoriteTag = useStore((s) => s.addFavoriteTag)
  const splitOpen = useStore((s) => !!s.tabs.find((t) => t.id === s.activeTabId)?.split)
  const setFilter = useStore((s) => s.setFilter)
  const addSearchToken = useStore((s) => s.addSearchToken)
  const upsertWork = useStore((s) => s.upsertWork)
  const favoriteTags = useStore((s) => s.settings.favoriteTags)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [crossMenu, setCrossMenu] = useState<{ x: number; y: number; query: string; raw: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [newTag, setNewTag] = useState('')

  const toggleFav = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const updated = await window.api.setFavorite(work.id, !work.favorite)
    invalidateThumb(work.id)
    upsertWork(updated)
  }

  const addTag = async (): Promise<void> => {
    const t = newTag.trim()
    if (t) upsertWork(await window.api.addManualTag(work.id, t))
    setNewTag('')
    setAdding(false)
  }
  const removeTag = async (tag: string): Promise<void> => {
    upsertWork(await window.api.removeManualTag(work.id, tag))
  }

  return (
    <div
      className="gtile"
      // Capture phase: Alt+click anywhere on the card (incl. the artist/tag area,
      // whose children stopPropagation) opens Glance before the child handlers run.
      onClickCapture={(e) => {
        // Dragging to select/copy text (e.g. the title) must not open a tab.
        if (window.getSelection()?.toString()) return e.stopPropagation()
        if (e.altKey) {
          e.preventDefault()
          e.stopPropagation()
          openGlance({ workId: work.id })
        }
      }}
      onClick={() => openTab(work.id)}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault() // block middle-click autoscroll
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          openTabBackground(work.id)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <div className="gtile-thumb">
        <Thumb workId={work.id} />
      </div>
      <div className="gtile-foot" onClick={(e) => e.stopPropagation()}>
        <Stars rank={work.rank} onChange={async (r) => upsertWork(await window.api.setRank(work.id, r))} />
        <FavGroup favorite={work.favorite} onToggle={toggleFav} work={work} />
      </div>
      <div className="gtile-title selectable">{work.title}</div>
      <div className="gtile-meta">
        {work.pageCount}p
        {work.code && (
          <>
            {' · '}
            <span
              className="code copyable"
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard?.writeText(work.code!)
              }}
            >
              [{work.code}]
            </span>
          </>
        )}
        {work.language && ` · ${work.language}`}
      </div>
      {work.artist && (
        <div className="gtile-meta gtile-artist">
          <span
            className="artist-link"
            onClick={(e) => {
              e.stopPropagation()
              setFilter({ kind: 'artist', value: work.artist! })
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setCrossMenu({ x: e.clientX, y: e.clientY, query: tagToken(`artist:${work.artist}`), raw: work.artist! })
            }}
          >
            {work.artist}
          </span>
        </div>
      )}
      <div className="gtile-tags">
        <TagList
          tags={allTags(work)}
          favoriteTags={favoriteTags}
          manualTags={work.manualTags}
          onTagClick={(t) => addSearchToken(tagToken(t))}
          onTagContext={(t, e) => setCrossMenu({ x: e.clientX, y: e.clientY, query: tagToken(t), raw: t })}
          onRemove={removeTag}
          onAddClick={adding ? undefined : () => setAdding(true)}
          singleLine={false}
          max={6}
        />
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: '새 탭에서 열기', onClick: () => openTab(work.id) },
            { label: '백그라운드에서 열기', onClick: () => openTabBackground(work.id) },
            { label: splitOpen ? '오른쪽 뷰에서 열기' : '분할 뷰에서 열기', onClick: () => openSplit(work.id) },
            ...(work.code && (work.library ?? 'hitomi') === 'hitomi'
              ? [{ label: '다시 다운로드', onClick: () => startDownload({ kind: 'hitomi' as const, input: work.code! }) }]
              : [])
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
