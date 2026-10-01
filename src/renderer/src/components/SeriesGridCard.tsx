import type { JSX } from 'react'
import { useStore } from '../store'
import { tagToken, type SeriesGroup } from '../util'
import Thumb from './Thumb'
import { ArtistLinks } from './ArtistLinks'
import Stars from './Stars'
import TagList from './TagList'
import FavGroup from './FavGroup'
import { useSeriesCard } from './useSeriesCard'

// Grid tile for a general-manga series (the .series variant of .gtile: count +
// artist share one line, 2 tag rows — general manga rarely has tags). Shows
// the representative chapter's cover. Behavior is shared with the list card
// via useSeriesCard.
export default function SeriesGridCard({ series }: { series: SeriesGroup }): JSX.Element {
  const addSearchToken = useStore((s) => s.addSearchToken)
  const favoriteTags = useStore((s) => s.settings.favoriteTags)
  const c = useSeriesCard(series)

  return (
    <div className="gtile series" {...c.cardEvents}>
      <div className="gtile-thumb">
        <Thumb workId={c.rep?.id ?? ''} />
      </div>
      <div className="gtile-foot" onClick={(e) => e.stopPropagation()}>
        <Stars rank={c.maxRank} onChange={c.rankAll} />
        {c.rep && <FavGroup favorite={c.isFav} onToggle={c.toggleFav} work={c.rep} applyTo={c.chapters} />}
      </div>
      <div className="gtile-title selectable">{series.title}</div>
      <div className="gtile-meta">
        전체 {c.chapters.length}화{c.artist && ' · '}
        {c.artist && (
          <ArtistLinks
            artist={c.artist}
            onPick={(a) => addSearchToken(tagToken(`artist:${a}`))}
            onMenu={(a, e) => c.openTagMenu(e, tagToken(`artist:${a}`), a)}
          />
        )}
      </div>
      <div className="gtile-tags">
        <TagList
          tags={c.seriesTags}
          favoriteTags={favoriteTags}
          manualTags={c.seriesTags}
          onTagClick={(t) => addSearchToken(tagToken(t))}
          onTagContext={(t, e) => c.openTagMenu(e, tagToken(t), t)}
          onRemove={c.removeSeriesTag}
          onAddClick={c.adding ? undefined : c.startAddTag}
          lines={2}
        />
        {c.tagInput}
      </div>
      {c.seriesMenu}
      {c.tagMenu}
    </div>
  )
}
