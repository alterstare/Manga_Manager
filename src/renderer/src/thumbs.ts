import { getCover } from './images'

// Thumbnail pipeline: each work gets a small webp generated once (Chromium
// decodes webp/avif via canvas) and saved to disk by main. Afterwards the
// <img> just points at the cached file — no re-decode on tab switches.

const mem = new Map<string, string | null>() // workId -> thumb url (null = no cover)
const pending = new Map<string, Promise<string | null>>()

const MAX_CONCURRENT = 4
let active = 0
const queue: (() => void)[] = []

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length) {
    active++
    queue.shift()!()
  }
}

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      fn()
        .then(resolve, reject)
        .finally(() => {
          active--
          pump()
        })
    })
    pump()
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // needed so canvas export isn't tainted
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

async function generate(workId: string): Promise<string | null> {
  const cover = await getCover(workId)
  if (!cover) return null
  let img: HTMLImageElement
  try {
    img = await loadImage(cover)
  } catch {
    return null
  }
  const sw = img.naturalWidth || img.width
  const sh = img.naturalHeight || img.height
  if (!sw || !sh) return null // decode failed (e.g. oversized webtoon strip)
  // Webtoon chapters are one very tall strip; squishing the whole height into the
  // thumbnail yields a blank-looking sliver. For tall images use only the TOP
  // (square-ish) region as the cover, like every other reader does.
  const srcH = sh / sw > 1.6 ? Math.round(sw * 1.4) : sh
  const MAX = 480
  const scale = Math.min(1, MAX / Math.max(sw, srcH))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(img, 0, 0, sw, srcH, 0, 0, w, h)
  let dataUrl: string
  try {
    dataUrl = canvas.toDataURL('image/webp', 0.72)
  } catch {
    return null
  }
  return window.api.saveThumb(workId, dataUrl)
}

async function resolve(workId: string): Promise<string | null> {
  const existing = await window.api.getThumb(workId)
  if (existing) return existing
  return schedule(() => generate(workId))
}

export async function loadThumb(workId: string): Promise<string | null> {
  if (mem.has(workId)) return mem.get(workId)!
  let p = pending.get(workId)
  if (!p) {
    p = resolve(workId).then((url) => {
      mem.set(workId, url)
      pending.delete(workId)
      return url
    })
    pending.set(workId, p)
  }
  return p
}

// Pre-generate thumbnails for the whole library after a scan, in the background.
export async function warmThumbs(
  workIds: string[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  let done = 0
  const total = workIds.length
  await Promise.all(
    workIds.map((id) =>
      // One failing thumb must not reject the whole batch (which would leave the
      // job stuck), so swallow per-work errors and still count progress.
      loadThumb(id)
        .catch(() => null)
        .then(() => {
          done++
          if (done % 10 === 0 || done === total) onProgress?.(done, total)
        })
    )
  )
}

export function invalidateThumb(workId: string): void {
  mem.delete(workId)
  pending.delete(workId)
}

// Force-regenerate a work's thumbnail from its local first page, overwriting any
// existing (or online-sourced) cover. Used as a fallback when the online cover
// search fails — the raw first page is better than a blank tile.
export async function regenLocalThumb(workId: string): Promise<string | null> {
  const url = await schedule(() => generate(workId))
  mem.set(workId, url)
  pending.delete(workId)
  return url
}
