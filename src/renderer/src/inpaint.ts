import type { TransResult, TransBlock } from '../../shared/ipc'

// In-place ("circle to search" style) rendering: erase the original text inside
// each speech bubble and typeset the Korean translation in the same spot. All
// done locally on a canvas — no extra API cost beyond the Papago OCR we already
// pay for. Block coords are in the sent (≤1920px) image pixel space, which is
// also the canvas space we draw into.

const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif'

// MUST match translate.ts: the image is downscaled to this before being sent to
// Papago, so block coords live in that pixel space. The canvas must be sized to
// it (NOT to res.w/h, which is only the text-extent from Papago's doc corners
// and can be narrower than the real page → right-side text drifts right).
const MAX_SIDE = 1920

// Outline each Papago block + its index (diagnostics). Leave false normally.
const DEBUG_BOXES = false

type RGB = [number, number, number]

// Load an image CORS-clean so the canvas stays readable (getImageData) for
// background-colour sampling. mangaimg:// sends Access-Control-Allow-Origin: *.
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('이미지 로드 실패'))
    img.src = src
  })
}

function luminance([r, g, b]: RGB): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

export function rgbToHex([r, g, b]: RGB): string {
  const h = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return [255, 255, 255]
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

// Downscaled canvas size for an image (matches translate.ts's send size), so the
// editor can position overlay boxes in the same pixel space the block coords use.
export function canvasSize(img: HTMLImageElement): { W: number; H: number; scale: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  return { W: Math.round(img.naturalWidth * scale), H: Math.round(img.naturalHeight * scale), scale }
}

// Auto bubble-fill colour for a block, as hex — the editor's default swatch when
// the user hasn't picked one. Samples from a clean copy of the image.
export function autoBgHex(img: HTMLImageElement, b: TransBlock): string {
  const { W, H } = canvasSize(img)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return '#ffffff'
  ctx.drawImage(img, 0, 0, W, H)
  return rgbToHex(sampleBg(ctx, b, W, H))
}

// Dominant background colour of the block = the bubble's fill. Sample a grid over
// the block INTERIOR (plus a thin exterior ring), quantise into 16-level colour
// buckets, and return the average of the most-populated bucket. Because the glyphs
// are a minority of the pixels, the winning cluster is the bubble background — so a
// white bubble reads as white even when the old "ring outside the box" landed on a
// neighbouring bubble's border or the surrounding art.
function sampleBg(ctx: CanvasRenderingContext2D, b: TransBlock, W: number, H: number): RGB {
  const cx = (v: number): number => Math.max(0, Math.min(W - 1, Math.round(v)))
  const cy = (v: number): number => Math.max(0, Math.min(H - 1, Math.round(v)))
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  const add = (x: number, y: number): void => {
    const d = ctx.getImageData(cx(x), cy(y), 1, 1).data
    const key = ((d[0] >> 4) << 8) | ((d[1] >> 4) << 4) | (d[2] >> 4)
    const e = buckets.get(key)
    if (e) {
      e.n++
      e.r += d[0]
      e.g += d[1]
      e.b += d[2]
    } else buckets.set(key, { n: 1, r: d[0], g: d[1], b: d[2] })
  }
  const N = 10
  for (let iy = 0; iy <= N; iy++)
    for (let ix = 0; ix <= N; ix++) add(b.x + (b.w * ix) / N, b.y + (b.h * iy) / N)
  const ring = Math.max(2, Math.round(Math.min(b.w, b.h) * 0.15))
  for (let i = 0; i <= N; i++) {
    const x = b.x + (b.w * i) / N
    const y = b.y + (b.h * i) / N
    add(x, b.y - ring)
    add(x, b.y + b.h + ring)
    add(b.x - ring, y)
    add(b.x + b.w + ring, y)
  }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [255, 255, 255]
}

// Onomatopoeia / sound-effect detector.
//
// Geometry alone (box size) misses SMALL SFX, so the PRIMARY signal is the source
// SCRIPT: Japanese *dialogue* almost always contains hiragana (grammar particles,
// okurigana), while onomatopoeia/mimetic words are written in katakana only. So a
// katakana-only block — no hiragana, no kanji — is almost certainly SFX regardless
// of its size. Blocks that are only punctuation/symbols carry nothing worth
// translating either. A geometric rule stays as a fallback for when the source
// text is missing or non-Japanese (huge box per character).
const HIRAGANA = /[぀-ゟ]/
const KANJI = /[㐀-䶿一-鿿]/
const KATAKANA = /[゠-ヿｦ-ﾝ]/ // incl. long-vowel and half-width
const HAS_LETTER = /[\p{L}\p{N}]/u

// Kana blocks whose "core" length (below) is at most this are treated as
// SFX/interjections and skipped. Blocks that contain kanji are exempt (short kanji
// lines are usually real dialogue, e.g. 何だ). Tune if too / not aggressive enough.
const SFX_MAX_LEN = 3

// Small kana, long-vowel marks and interpuncts don't add a mora — strip them before
// counting so どちゅっ / ドキーッ count like ~2 letters (else they slip past the length
// rule and a stray one gets translated even though its twin was skipped).
const NON_MORA = /[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ゛゜ーｰ・~〜～]/g
function coreLen(s: string): number {
  return [...s.replace(NON_MORA, '')].filter((c) => HAS_LETTER.test(c)).length
}

// True if the whole (letters-only) string is a short unit repeated — the signature
// of a mimetic word: ドキドキ (ドキ×2), ゴゴゴ (ゴ×3), ざわざわ (ざわ×2).
function isRepeatedUnit(t: string): boolean {
  for (let u = 1; u <= 3; u++) {
    if (t.length >= u * 2 && t.length % u === 0 && t.slice(0, u).repeat(t.length / u) === t) return true
  }
  return false
}

export function isSfx(b: TransBlock, W: number, H: number): boolean {
  const src = (b.text || '').trim()
  if (src) {
    // Nothing meaningful (pure !? … symbols).
    if (!HAS_LETTER.test(src)) return true
    const letters = [...src].filter((c) => HAS_LETTER.test(c))
    const noKanji = !KANJI.test(src)
    // Katakana-only Japanese → onomatopoeia (dialogue would carry hiragana/kanji).
    if (KATAKANA.test(src) && !HIRAGANA.test(src) && noKanji) return true
    // Short kana blocks (no kanji) → SFX / grunts (오라, 바츄, ドキ, どちゅっ …).
    if (noKanji && coreLen(src) <= SFX_MAX_LEN) return true
    // Repeated-unit mimetic words of any length (ドキドキ, ざわざわ, ゴゴゴ).
    if (isRepeatedUnit(letters.join(''))) return true
  } else if (b.tr) {
    // No source text from the engine (only a translation) → can't script-detect;
    // judge by the translation instead: a short one is almost always an SFX (도츄 …).
    if (coreLen(b.tr) <= SFX_MAX_LEN) return true
  }
  // Fallback: non-Japanese / still ambiguous → a big box holding few characters.
  const chars = [...(src || b.tr || '').replace(/\s/g, '')].length
  if (chars <= 0) return false
  const areaFrac = (b.w * b.h) / (W * H)
  return areaFrac / chars > 0.004 || (chars <= 6 && areaFrac > 0.03)
}

// Greedy wrap. Korean rarely has spaces, so we break per-character but keep
// whole runs together when they fit. Honors explicit newlines.
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of text.replace(/\r/g, '')) {
    if (ch === '\n') {
      lines.push(cur)
      cur = ''
      continue
    }
    const next = cur + ch
    if (cur && ctx.measureText(next).width > maxW) {
      lines.push(cur)
      cur = ch === ' ' ? '' : ch
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

// Pick the largest font size that fits the text within the box, then draw it
// centered with a thin contrasting halo for readability.
function drawText(ctx: CanvasRenderingContext2D, b: TransBlock, text: string, bg: RGB): void {
  const pad = Math.max(3, Math.min(b.w, b.h) * 0.08)
  const maxW = Math.max(8, b.w - pad * 2)
  const maxH = Math.max(8, b.h - pad * 2)

  let chosen = 9
  let lines: string[] = []
  for (let fs = Math.min(Math.round(maxH), 72); fs >= 9; fs--) {
    ctx.font = `600 ${fs}px ${FONT}`
    const ls = wrap(ctx, text, maxW)
    const lh = fs * 1.18
    const fits = ls.length * lh <= maxH && ls.every((l) => ctx.measureText(l).width <= maxW)
    if (fits) {
      chosen = fs
      lines = ls
      break
    }
    if (fs === 9) {
      chosen = 9
      lines = ls
    }
  }

  ctx.font = `600 ${chosen}px ${FONT}`
  const lh = chosen * 1.18
  const dark = luminance(bg) > 140 // light background → dark text
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const cx = b.x + b.w / 2
  let y = b.y + (b.h - lines.length * lh) / 2

  ctx.lineJoin = 'round'
  for (const line of lines) {
    ctx.lineWidth = Math.max(1.5, chosen * 0.14)
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)'
    ctx.strokeText(line, cx, y)
    ctx.fillStyle = dark ? '#141414' : '#f4f4f4'
    ctx.fillText(line, cx, y)
    y += lh
  }
}

// Erase original text + typeset the translation for every block.
export function drawTranslation(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  res: TransResult
): void {
  // Size the canvas to the sent (downscaled) image — the space the block coords
  // are actually in — replicating translate.ts's downscale exactly.
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const W = Math.round(img.naturalWidth * scale)
  const H = Math.round(img.naturalHeight * scale)
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  ctx.drawImage(img, 0, 0, W, H)

  if (DEBUG_BOXES) {
    console.log('[inpaint] canvas', W, 'x', H, 'blocks', res.blocks.length)
    console.table(
      res.blocks.map((b, i) => ({
        i,
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.w),
        h: Math.round(b.h),
        src: b.text.slice(0, 18),
        tr: b.tr.slice(0, 18)
      }))
    )
  }

  res.blocks.forEach((b, i) => {
    if (b.w <= 0 || b.h <= 0) return
    // A manual edit (bg set in the editor) is an explicit "draw this" — only auto
    // blocks get the SFX/onomatopoeia skip.
    if (!b.bg && isSfx(b, W, H)) return
    const bg = b.bg ? hexToRgb(b.bg) : sampleBg(ctx, b, W, H)
    // Paint over the original glyphs (slightly padded to fully cover them).
    const pad = Math.max(2, Math.min(b.w, b.h) * 0.1)
    ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`
    ctx.fillRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2)
    // A manually edited block (bg set) has an authoritative translation: an empty
    // tr means "erase this bubble", so DON'T fall back to the source text (that would
    // repaint the original Japanese). Auto blocks still fall back when the engine
    // gave a box but no translation.
    const txt = b.bg ? b.tr : b.tr || b.text
    if (txt) drawText(ctx, b, txt, bg)
    if (DEBUG_BOXES) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,0,0,0.9)'
      ctx.lineWidth = 2
      ctx.strokeRect(b.x, b.y, b.w, b.h)
      ctx.fillStyle = 'red'
      ctx.font = `bold 16px ${FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(String(i), b.x + 2, b.y + 2)
      ctx.restore()
    }
  })
}
