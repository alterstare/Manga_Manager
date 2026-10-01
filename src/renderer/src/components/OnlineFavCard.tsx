import type { JSX } from 'react'
import type { OnlineFav } from '../../../shared/types'
import { useStore } from '../store'
import { getOnlineImages } from '../images'
import OnlineThumb from './OnlineThumb'
import Stars from './Stars'
import TagList from './TagList'
import { useFavSummaries, getFavSummary } from '../favSummaries'
import { tagToken, isTokiCode } from '../util'
import { CheckIcon, PauseIcon, PlayIcon, DownloadIcon, SyncIcon, FavoriteIcon } from './icons'

// A favorite that isn't downloaded yet (hitomi numeric code or toki http url),
// shown inside the unified favorites grid alongside local work cards. Clicking
// opens it online; the download button pulls it into the library.
export default function OnlineFavCard({ fav, layout }: { fav: OnlineFav; layout: 'grid' | 'list' }): JSX.Element {
  const isToki = isTokiCode(fav.code)
  const openOnline = useStore((s) => s.openOnline)
  const openToki = useStore((s) => s.openToki)
  const startDownload = useStore((s) => s.startDownload)
  const stopDownload = useStore((s) => s.stopDownload)
  const retryDownload = useStore((s) => s.retryDownload)
  const toggleUnifiedFav = useStore((s) => s.toggleUnifiedFav)
  const toggleNormalUnifiedFav = useStore((s) => s.toggleNormalUnifiedFav)
  const setOnlineRank = useStore((s) => s.setOnlineRank)
  const setOnlineListFav = useStore((s) => s.setOnlineListFav)
  const d = useStore((s) => s.downloads.find((x) => x.code === fav.code))
  const favoriteTags = useStore((s) => s.settings.favoriteTags)
  const addSearchToken = useStore((s) => s.addSearchToken)
  // Stored favorites carry no tags → pull the cached gallery summary (hitomi only).
  useFavSummaries(isToki ? [] : [fav.code])
  const tags = (getFavSummary(fav.code)?.tags ?? []).filter((t) => !t.startsWith('language:'))

  const phase = d?.phase
  const active = phase === 'queued' || phase === 'fetching' || phase === 'downloading' || phase === 'enriching'
  const paused = phase === 'stopped'
  const err = phase === 'error'
  const done = phase === 'done'
  const pct = d?.total ? Math.round((d.done / d.total) * 100) : 0

  const open = (): void => {
    setOnlineListFav(true) // opened from a favorites view → reader list shows favorites
    const g = { code: fav.code, title: fav.title, artist: fav.artist }
    if (isToki) openToki({ ...g, kind: 'toki' })
    else openOnline(g)
  }
  const dl = (): void => {
    if (active) return void stopDownload(fav.code)
    if (paused || err) return void retryDownload(fav.code)
    if (isToki) void startDownload({ kind: 'toki', seriesUrl: fav.code, title: fav.title })
    else void startDownload({ kind: 'hitomi', input: fav.code, title: fav.title })
  }

  const unfav = (): void =>
    void (isToki ? toggleNormalUnifiedFav({ title: fav.title, url: fav.code, meta: fav }) : toggleUnifiedFav(fav.code, fav))
  const heartDl = (
    <span className="seg" onClick={(e) => e.stopPropagation()}>
      <span className="seg-heart on" title="즐겨찾기 해제" onClick={unfav}>
        <FavoriteIcon filled />
      </span>
      <span
        className={`seg-dl ${done ? 'ok' : ''} ${err ? 'err' : ''} ${paused ? 'paused' : ''}`}
        title={active ? `다운로드 중 ${pct}%` : paused ? '이어받기' : err ? '다시 시도' : '다운로드'}
        onClick={dl}
      >
        {active ? <PauseIcon /> : paused ? <PlayIcon /> : done ? <CheckIcon /> : err ? <SyncIcon /> : <DownloadIcon />}
      </span>
    </span>
  )

  // List layout: same row structure as the local WorkCard (90x120 thumb + info).
  if (layout === 'list') {
    return (
      <div className="work-card-wrap">
        <div className="work-card online-fav-row" onClick={open}>
          <OnlineThumb getImgs={() => getOnlineImages(fav.code)} thumbUrl={fav.thumbUrl} className="thumb">
            <span className="online-fav-badge">온라인</span>
          </OnlineThumb>
          <div className="work-info">
            <div className="work-title-row">
              <span className="work-title selectable">{fav.title}</span>
              {heartDl}
            </div>
            <div className="work-meta">
              {fav.pageCount ? `${fav.pageCount}p` : ''}
              {!isToki && `${fav.pageCount ? ' · ' : ''}[${fav.code}]`}
              {fav.language && ` · ${fav.language}`}
              {fav.artist && ` · ${fav.artist}`}
            </div>
            <div className="work-tags" onClick={(e) => e.stopPropagation()}>
              {tags.length > 0 && (
                <TagList tags={tags} favoriteTags={favoriteTags} onTagClick={(t) => addSearchToken(tagToken(t))} />
              )}
            </div>
            <div className="work-actions" onClick={(e) => e.stopPropagation()}>
              <Stars rank={fav.rank ?? 0} onChange={(r) => setOnlineRank(fav.code, r, fav)} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`gtile online-fav ${layout}${isToki ? ' series' : ''}`} onClick={open}>
      <div className="gtile-thumb">
        <OnlineThumb getImgs={() => getOnlineImages(fav.code)} thumbUrl={fav.thumbUrl} className="gtile-thumb-inner" />
        <span className="online-fav-badge">온라인</span>
      </div>
      <div className="gtile-foot" onClick={(e) => e.stopPropagation()}>
        <Stars rank={fav.rank ?? 0} onChange={(r) => setOnlineRank(fav.code, r, fav)} size={14} />
        <span style={{ marginLeft: 'auto' }}>{heartDl}</span>
      </div>
      <div className="gtile-title selectable">{fav.title}</div>
      <div className="gtile-meta">
        {fav.pageCount ? `${fav.pageCount}p` : ''}
        {fav.language && `${fav.pageCount ? ' · ' : ''}${fav.language}`}
        {isToki && fav.artist && `${fav.pageCount || fav.language ? ' · ' : ''}${fav.artist}`}
      </div>
      {!isToki && <div className="gtile-meta gtile-artist">{fav.artist ?? ''}</div>}
      {/* Always present (flex:1) so the card stretches like the local tiles. */}
      <div className="gtile-tags" onClick={(e) => e.stopPropagation()}>
        {tags.length > 0 && (
          <TagList
            tags={tags}
            favoriteTags={favoriteTags}
            onTagClick={(t) => addSearchToken(tagToken(t))}
            lines={isToki ? 2 : 5}
          />
        )}
      </div>
    </div>
  )
}
