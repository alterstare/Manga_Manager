import { hasExclusions, filterExcluded, getExcluded } from './exclude'
import { isTokiCode } from './util'

// Caches the per-work image url list so thumbnails and the reader share one
// readdir round-trip. Cleared entries reload on demand.
const cache = new Map<string, Promise<string[]>>()

export function getImages(workId: string): Promise<string[]> {
  let p = cache.get(workId)
  if (!p) {
    p = window.api.getWorkImages(workId)
    cache.set(workId, p)
  }
  return p
}

export function invalidate(workId: string): void {
  cache.delete(workId)
}

export async function getCover(workId: string): Promise<string | null> {
  const imgs = await getImages(workId)
  if (!imgs.length) return null
  if (!hasExclusions()) return imgs[0]
  // Use the first page that isn't a registered/excluded image.
  const kept = await filterExcluded(imgs.slice(0, 6), getExcluded())
  return kept[0] ?? imgs[0]
}

// Online (streamed) gallery image urls, keyed by hitomi code.
const onlineCache = new Map<string, Promise<string[]>>()

export function getOnlineImages(code: string): Promise<string[]> {
  let p = onlineCache.get(code)
  if (!p) {
    // A toki "code" is the chapter viewer URL (http…); a hitomi code is numeric.
    p = isTokiCode(code) ? window.api.tokiReadUrls(code) : window.api.hitomiReadUrls(code)
    onlineCache.set(code, p)
  }
  return p
}
