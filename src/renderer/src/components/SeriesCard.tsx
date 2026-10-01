import { useMemo, useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import type { SeriesGroup, ChapterInfo } from '../util'
import { analyzeSeries, tagToken } from '../util'
import { useStore } from '../store'
import Thumb from './Thumb'
import { ArtistLinks } from './ArtistLinks'
import Stars from './Stars'
import FavGroup from './FavGroup'
import TagList from './TagList'
import { useSeriesCard } from './useSeriesCard'
import ConfirmModal from './ConfirmModal'

// Open a folder's parent in Explorer (so we don't descend into chapter 1).
function parentOf(p: string): string {
  return p.replace(/[\\/][^\\/]*$/, '')
}

// List row for a general-manga series: cover, title + favorite, meta
// (chapter count · language · artist, each clearable), series tags, and the
// action row (rating, folder, delete, "화 목록" chapter table). Behavior is
// shared with the grid tile via useSeriesCard.
export default function SeriesCard({ series }: { series: SeriesGroup }): JSX.Element {
  const addSearchToken = useStore((s) => s.addSearchToken)
  const openTab = useStore((s) => s.openTab)
  const removeWork = useStore((s) => s.removeWork)
  const favoriteTags = useStore((s) => s.settings.favoriteTags)
  const scheme = useStore((s) => s.settings.normalChapterScheme)
  const c = useSeriesCard(series)
  const { chapters, rep, artist, language } = c
  const [open, setOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const infos = useMemo(() => analyzeSeries(chapters, series.title, scheme), [chapters, series.title, scheme])

  const deleteSeries = async (): Promise<void> => {
    setConfirmDel(false)
    for (const ch of chapters) {
      await window.api.deleteWork(ch.id)
      removeWork(ch.id)
    }
  }

  return (
    <div className="work-card-wrap">
      <div className="work-card" {...c.cardEvents}>
        <Thumb workId={rep?.id ?? ''} />
        <div className="work-info">
          <div className="work-title-row">
            <span className="work-title selectable">{series.title}</span>
            {rep && (
              <FavGroup favorite={c.isFav} onToggle={c.toggleFav} work={rep} applyTo={chapters} />
            )}
          </div>

          <div className="work-meta">
            <span>전체 {chapters.length}화</span>
            {language && ' · '}
            {language && (
              <span className="lang removable">
                {language}
                <span className="tag-x" onClick={(e) => { e.stopPropagation(); c.clearField('language') }}>×</span>
              </span>
            )}
            {artist && ' · '}
            {artist && (
              <span className="removable">
                <ArtistLinks
                  artist={artist}
                  onPick={(a) => addSearchToken(tagToken(`artist:${a}`))}
                  onMenu={(a, e) => c.openTagMenu(e, tagToken(`artist:${a}`), a)}
                />
                <span className="tag-x" onClick={(e) => { e.stopPropagation(); c.clearField('artist') }}>×</span>
              </span>
            )}
          </div>

          <div className="work-tags">
            <TagList
              tags={c.seriesTags}
              favoriteTags={favoriteTags}
              manualTags={c.seriesTags}
              onTagClick={(t) => addSearchToken(tagToken(t))}
              onTagContext={(t, e) => c.openTagMenu(e, tagToken(t), t)}
              onRemove={c.removeSeriesTag}
              onAddClick={c.adding ? undefined : c.startAddTag}
            />
            {c.tagInput}
          </div>

          <div className="work-actions">
            <Stars rank={c.maxRank} onChange={c.rankAll} />
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

      {c.seriesMenu}
      {c.tagMenu}
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
