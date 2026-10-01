import { useEffect, useState } from 'react'
import type { GallerySummary } from '../../shared/ipc'

// Online favorites are stored without tags (just title/artist/thumb). Fetch the
// full gallery summary (tags etc.) for favorite codes once, cache it for the
// session, and re-render subscribers when new summaries land.
const cache = new Map<string, GallerySummary>()
const pending = new Set<string>()
const listeners = new Set<() => void>()

export function getFavSummary(code: string): GallerySummary | undefined {
  return cache.get(code)
}

function request(codes: string[]): void {
  const need = codes.filter((c) => /^\d+$/.test(c) && !cache.has(c) && !pending.has(c))
  if (!need.length) return
  need.forEach((c) => pending.add(c))
  window.api
    .hitomiSummaries(need)
    .then((list) => {
      for (const g of list) cache.set(g.code, g)
    })
    .catch(() => {})
    .finally(() => {
      need.forEach((c) => pending.delete(c))
      listeners.forEach((fn) => fn())
    })
}

// Subscribe to summaries for these codes; returns a version number that bumps
// whenever new data arrives (use it as a memo dependency).
export function useFavSummaries(codes: string[]): number {
  const [ver, setVer] = useState(0)
  useEffect(() => {
    const fn = (): void => setVer((v) => v + 1)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  const key = codes.join(',')
  useEffect(() => {
    request(codes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return ver
}
