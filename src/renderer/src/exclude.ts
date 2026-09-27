// Perceptual-hash (dHash) based page exclusion. Register a sample image (e.g. a
// warning page); pages similar to it are dropped from the reader/thumbnail.
// Entirely opt-in: with no registered hashes this does nothing and costs nothing.

const HASH_W = 9
const HASH_H = 8 // 9x8 -> 8x8 horizontal-gradient bits = 64-bit hash

const urlHashCache = new Map<string, string>()

// Currently active excluded hashes (mirrors settings.excludedImageHashes).
let excluded: string[] = []
export function setExcluded(hashes: string[]): void {
  excluded = hashes
}
export function getExcluded(): string[] {
  return excluded
}
export function hasExclusions(): boolean {
  return excluded.length > 0
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load failed'))
    img.src = src
  })
}

let scratch: HTMLCanvasElement | null = null
function canvas(): HTMLCanvasElement {
  if (!scratch) {
    scratch = document.createElement('canvas')
    scratch.width = HASH_W
    scratch.height = HASH_H
  }
  return scratch
}

export async function dHashFromImage(img: HTMLImageElement): Promise<string> {
  const c = canvas()
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, HASH_W, HASH_H)
  const data = ctx.getImageData(0, 0, HASH_W, HASH_H).data
  const gray = (x: number, y: number): number => {
    const i = (y * HASH_W + x) * 4
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  let bits = 0n
  let bit = 0n
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      if (gray(x, y) < gray(x + 1, y)) bits |= 1n << bit
      bit++
    }
  }
  return bits.toString(16).padStart(16, '0')
}

export async function dHashFromUrl(url: string): Promise<string | null> {
  const cached = urlHashCache.get(url)
  if (cached) return cached
  try {
    const h = await dHashFromImage(await loadImage(url))
    urlHashCache.set(url, h)
    return h
  } catch {
    return null
  }
}

// Cover hash + natural pixel size in one load (quality signal for dup keeper).
export async function hashAndSize(
  url: string
): Promise<{ hash: string; w: number; h: number } | null> {
  try {
    const img = await loadImage(url)
    const hash = await dHashFromImage(img)
    urlHashCache.set(url, hash)
    return { hash, w: img.naturalWidth, h: img.naturalHeight }
  } catch {
    return null
  }
}

function hamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let count = 0
  while (x) {
    count += Number(x & 1n)
    x >>= 1n
  }
  return count
}

const THRESHOLD = 10 // out of 64 bits

// Returns the subset of urls that are NOT similar to any excluded hash.
export async function filterExcluded(urls: string[], excluded: string[]): Promise<string[]> {
  if (!excluded.length) return urls
  const keep: string[] = []
  for (const url of urls) {
    const h = await dHashFromUrl(url)
    if (h && excluded.some((e) => hamming(h, e) <= THRESHOLD)) continue
    keep.push(url)
  }
  return keep
}
