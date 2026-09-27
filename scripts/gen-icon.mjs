// Generates build/icon.png — a simple "MV" app icon, drawn with pure Node
// (no image libs available). Rounded dark square + gold "MV" letters, letters
// built from thick line segments and anti-aliased by 4x4 supersampling.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const N = 512 // output size
const SS = 4 // supersample factor per axis

// palette (matches app: dark #0c0e12 bg, gold #ffcf3f accent)
const BG_TOP = [30, 34, 44]
const BG_BOT = [12, 14, 18]
const GOLD = [255, 207, 63]

const RADIUS = 96 // rounded-corner radius
const PAD = 70 // inner margin for letters
const T = 52 // stroke thickness

// distance from point p to segment ab
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

// letter geometry (in output coordinate space)
const yTop = PAD + 40
const yBot = N - PAD - 40
const mid = N / 2
const gap = 26
// M occupies left block, V the right block
const mL = PAD + 6
const mR = mid - gap
const vL = mid + gap
const vR = N - PAD - 6
const mApexY = yBot - (yBot - yTop) * 0.42

const segs = [
  // M: two verticals + two diagonals to a center valley
  [mL, yBot, mL, yTop],
  [mR, yBot, mR, yTop],
  [mL, yTop, (mL + mR) / 2, mApexY],
  [mR, yTop, (mL + mR) / 2, mApexY],
  // V: two diagonals meeting at bottom center
  [vL, yTop, (vL + vR) / 2, yBot],
  [vR, yTop, (vL + vR) / 2, yBot]
]

function insideLetter(x, y) {
  const half = T / 2
  for (const [ax, ay, bx, by] of segs) {
    if (segDist(x, y, ax, ay, bx, by) <= half) return true
  }
  return false
}

// signed coverage of rounded rect at (x,y): true if inside
function insideRoundRect(x, y) {
  const r = RADIUS
  const minx = r
  const miny = r
  const maxx = N - r
  const maxy = N - r
  let cx = x
  let cy = y
  if (x < minx) cx = minx
  else if (x > maxx) cx = maxx
  if (y < miny) cy = miny
  else if (y > maxy) cy = maxy
  // if inside the inner cross region, definitely inside
  if ((x >= minx && x <= maxx) || (y >= miny && y <= maxy)) {
    // outside the corner circles' zone -> just the rect band
    if (x >= 0 && x <= N && y >= 0 && y <= N) {
      if (x >= minx && x <= maxx) return y >= 0 && y <= N
      if (y >= miny && y <= maxy) return x >= 0 && x <= N
    }
  }
  return Math.hypot(x - cx, y - cy) <= r
}

const buf = Buffer.alloc(N * N * 4)
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS
        const py = y + (sy + 0.5) / SS
        if (!insideRoundRect(px, py)) continue // transparent outside
        let cr
        let cg
        let cb
        if (insideLetter(px, py)) {
          cr = GOLD[0]
          cg = GOLD[1]
          cb = GOLD[2]
        } else {
          const t = py / N
          cr = Math.round(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t)
          cg = Math.round(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t)
          cb = Math.round(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t)
        }
        r += cr
        g += cg
        b += cb
        a += 255
      }
    }
    const n = SS * SS
    const i = (y * N + x) * 4
    // premultiplied-free straight alpha: average color over covered subsamples
    const cov = a / 255 // number of covered subsamples
    if (cov > 0) {
      buf[i] = Math.round(r / cov)
      buf[i + 1] = Math.round(g / cov)
      buf[i + 2] = Math.round(b / cov)
    }
    buf[i + 3] = Math.round(a / n)
  }
}

// --- minimal PNG encoder (RGBA, filter 0) ---
function crc32(data) {
  let c = ~0
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const body = Buffer.concat([t, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0)
ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0
// raw scanlines with filter byte 0
const raw = Buffer.alloc(N * (N * 4 + 1))
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0
  buf.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4)
}
const idat = deflateSync(raw, { level: 9 })
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync(join(ROOT, 'build'), { recursive: true })
const out = join(ROOT, 'build', 'icon.png')
writeFileSync(out, png)
console.log('wrote', out, png.length, 'bytes,', N + 'x' + N)
