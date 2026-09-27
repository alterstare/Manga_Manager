import type { TransResult, TransBlock } from '../../shared/ipc'
import { useStore } from './store'
import { loadImage } from './inpaint'
import { ocrBlocks } from './ocr'

// Caches per-image translation so toggling / re-viewing a page is instant and
// (importantly) doesn't re-spend OCR/Papago quota on the same page.
const cache = new Map<string, Promise<TransResult>>()

// Manual edits (bubble box/colour/text) persisted across sessions, keyed by image
// src. Loaded once; an override short-circuits OCR/translation entirely.
let editsPromise: Promise<Record<string, TransBlock[]>> | null = null
function ensureEdits(): Promise<Record<string, TransBlock[]>> {
  if (!editsPromise) editsPromise = window.api.getTransEdits().catch(() => ({}))
  return editsPromise
}

const MAX_SIDE = 1920 // Papago rejects images with any side > 1960px

// Papago Image Translation only accepts JPG/PNG/TIFF — but manga pages are
// often webp/avif. Chromium's canvas decodes those, so we re-encode to JPEG in
// the renderer and send the bytes to main. crossOrigin=anonymous keeps the
// canvas untainted (our mangaimg:// protocol sends Access-Control-Allow-Origin).
function toJpegInfo(src: string): Promise<{ b64: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img
      const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
      w = Math.round(w * scale)
      h = Math.round(h * scale)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return reject(new Error('canvas 컨텍스트 실패'))
      ctx.drawImage(img, 0, 0, w, h)
      const url = c.toDataURL('image/jpeg', 0.9)
      resolve({ b64: url.slice(url.indexOf(',') + 1), w, h })
    }
    img.onerror = () => reject(new Error('이미지 로드 실패'))
    img.src = src
  })
}

// Image engines (Papago / Gemini): main does OCR + translation, returns boxes.
// We send the downscaled image + its size; Gemini needs the size to turn its
// normalized boxes into pixels, Papago ignores it.
function imageTranslate(src: string, langHint?: string): Promise<TransResult> {
  return toJpegInfo(src).then(({ b64, w, h }) => window.api.translateImage(b64, langHint, w, h))
}

// Free engine: OCR locally (Tesseract), translate the strings via main
// (Google unofficial / DeepL), then assemble the same box+translation shape.
async function freeTranslate(src: string, langHint?: string): Promise<TransResult> {
  const img = await loadImage(src)
  const ocr = await ocrBlocks(img, langHint)
  if (!ocr.blocks.length) return { ok: true, w: ocr.w, h: ocr.h, blocks: [] }
  const r = await window.api.translateTexts(
    ocr.blocks.map((b) => b.text),
    langHint
  )
  if (!r.ok) return { ok: false, w: ocr.w, h: ocr.h, blocks: [], error: r.error ?? '번역 실패' }
  const blocks = ocr.blocks.map((b, i) => ({
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    text: b.text,
    tr: r.texts[i] || ''
  }))
  return { ok: true, w: ocr.w, h: ocr.h, blocks }
}

export function getTranslation(src: string, langHint?: string): Promise<TransResult> {
  let p = cache.get(src)
  if (!p) {
    p = (async () => {
      const edits = await ensureEdits()
      // A saved manual edit wins — no OCR/API call, just replay the edited blocks.
      if (edits[src]) return { ok: true, w: 0, h: 0, blocks: edits[src] }
      const engine = useStore.getState().settings?.translateEngine ?? 'papago'
      return engine === 'free' ? freeTranslate(src, langHint) : imageTranslate(src, langHint)
    })()
    cache.set(src, p)
    // Don't cache failures permanently — let the user retry after fixing keys.
    p.then((r) => {
      if (!r.ok) cache.delete(src)
    }).catch(() => cache.delete(src))
  }
  return p
}

// Persist a page's manually edited blocks and make them the live translation so the
// viewer/export pick them up immediately. Empty list clears the override.
export async function saveTranslationEdit(src: string, blocks: TransBlock[]): Promise<void> {
  const edits = await ensureEdits()
  if (blocks.length) edits[src] = blocks
  else delete edits[src]
  cache.delete(src) // force re-resolve (override if present, else fresh translation)
  await window.api.saveTransEdit(src, blocks)
}

export function clearTranslation(src?: string): void {
  if (src) cache.delete(src)
  else cache.clear()
}
