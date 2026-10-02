// Unified favorites — list builders shared by the favorites views.
//
// mergeFavorites: the home "즐겨찾기" view.
// A favorite is ONE state across local and online (see store.toggleUnifiedFav /
// toggleNormalUnifiedFav), so the view merges three kinds of entries:
//   local  — a downloaded doujin work (hearted locally and/or online)
//   series — a general-manga series (or a single favorited chapter) in the library
//   online — an online favorite that isn't downloaded (rendered as OnlineFavCard)
// Each carries `t` (when it was favorited) and `r` (rating) so all three sort
// together.
import type { Work, OnlineFav } from '../../shared/types'
import type { GallerySummary } from '../../shared/ipc'
import { CHAP_FAV_PREFIX, allTags, isTokiCode, titleKey, type SeriesGroup } from './util'
import { getFavSummary } from './favSummaries'

export type FavEntry =
  | { kind: 'local'; work: Work; t: number; r: number }
  | { kind: 'series'; series: SeriesGroup; t: number; r: number }
  | { kind: 'online'; fav: OnlineFav; t: number; r: number }

export function mergeFavorites(p: {
  normal: boolean // general-manga mode (series) vs doujin (works)
  works: Work[] // doujin: favorited local works
  series: SeriesGroup[] // general manga: favorited series / chapter entries
  onlineOnly: OnlineFav[] // online favorites not in the library
  onlineFavs: Record<string, OnlineFav>
  normalFavAt: Record<string, number> // general-manga favorite timestamps by key
  sort: 'rank' | 'recent'
}): FavEntry[] {
  const out: FavEntry[] = []
  if (!p.normal) {
    // A local work may also be an online favorite: take the online time (the
    // first heart) and the better of the two ratings.
    for (const w of p.works) {
      const of = w.code ? p.onlineFavs[w.code] : undefined
      out.push({ kind: 'local', work: w, t: of?.addedAt ?? w.favoritedAt ?? 0, r: Math.max(w.rank, of?.rank ?? 0) })
    }
  } else {
    // Local series ↔ online manga-site favorite are linked by normalized title.
    const byTitle = new Map<string, OnlineFav>()
    for (const f of Object.values(p.onlineFavs)) if (f.favorite && isTokiCode(f.code)) byTitle.set(titleKey(f.title), f)
    for (const sg of p.series) {
      // Single-chapter entries are keyed by the chapter's work id.
      const key = sg.key.startsWith(CHAP_FAV_PREFIX) ? sg.key.slice(CHAP_FAV_PREFIX.length) : sg.key
      const of = byTitle.get(titleKey(sg.title))
      const r = Math.max(0, ...sg.chapters.map((c) => c.rank), of?.rank ?? 0)
      out.push({ kind: 'series', series: sg, t: p.normalFavAt[key] ?? of?.addedAt ?? 0, r })
    }
  }
  for (const f of p.onlineOnly) out.push({ kind: 'online', fav: f, t: f.addedAt, r: f.rank })
  out.sort((a, b) => (p.sort === 'rank' ? b.r - a.r || b.t - a.t : b.t - a.t))
  return out
}

// Codes of doujin online favorites (numeric gallery ids) — the ones whose
// summaries (tags…) must be fetched for display.
export function hitomiFavCodes(onlineFavs: Record<string, OnlineFav>): string[] {
  return Object.values(onlineFavs)
    .filter((f) => f.favorite && /^\d+$/.test(f.code))
    .map((f) => f.code)
}

// Unified doujin favorites as gallery summaries for the online views (browse
// "즐겨찾기" and the reader's left list): online favorites + locally favorited
// coded works, deduped by code. Tags come from the local work when downloaded,
// else from the cached gallery summary. With `sort`, ordered by favorite time
// or rating; without, online favorites first, then local-only ones.
export function hitomiFavGalleries(
  onlineFavs: Record<string, OnlineFav>,
  works: Work[],
  sort?: 'rank' | 'recent'
): GallerySummary[] {
  const byCode = new Map<string, Work>()
  for (const w of works) if (w.code) byCode.set(w.code, w)
  const rows: { g: GallerySummary; t: number; r: number }[] = []
  const seen = new Set<string>()
  for (const f of Object.values(onlineFavs)) {
    if (!f.favorite || isTokiCode(f.code) || seen.has(f.code)) continue
    seen.add(f.code)
    const sum = getFavSummary(f.code)
    const local = byCode.get(f.code)
    rows.push({
      g: {
        code: f.code,
        title: f.title,
        artists: f.artist ? [f.artist] : sum?.artists ?? [],
        tags: local ? allTags(local) : sum?.tags ?? [],
        language: f.language ?? sum?.language ?? null,
        type: null,
        pageCount: f.pageCount,
        thumbUrl: f.thumbUrl
      },
      t: f.addedAt,
      r: Math.max(f.rank, local?.rank ?? 0)
    })
  }
  for (const w of works) {
    if (!w.favorite || !w.code || isTokiCode(w.code) || seen.has(w.code)) continue
    seen.add(w.code)
    rows.push({
      g: {
        code: w.code,
        title: w.title,
        artists: w.artist ? [w.artist] : [],
        tags: allTags(w),
        language: w.language,
        type: null,
        pageCount: w.pageCount,
        thumbUrl: null // OnlineThumb falls back to the local thumbnail
      },
      t: w.favoritedAt ?? 0,
      r: w.rank
    })
  }
  if (sort) rows.sort((x, y) => (sort === 'rank' ? y.r - x.r || y.t - x.t : y.t - x.t))
  return rows.map((x) => x.g)
}
