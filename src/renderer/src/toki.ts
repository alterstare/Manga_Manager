import type { TokiChapter } from '../../shared/ipc'

// Cache the sibling-chapter list per series so the reader's left list and its
// prev/next buttons share one (slow, queued) scrape instead of fetching twice.
const cache = new Map<string, Promise<TokiChapter[]>>()

export function getTokiChapters(seriesUrl: string): Promise<TokiChapter[]> {
  let p = cache.get(seriesUrl)
  if (!p) {
    p = window.api.tokiChapters(seriesUrl)
    cache.set(seriesUrl, p)
    p.catch(() => cache.delete(seriesUrl)) // let a failed scrape retry later
  }
  return p
}
