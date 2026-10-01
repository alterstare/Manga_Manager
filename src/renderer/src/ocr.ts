import { createWorker, PSM, type Worker } from 'tesseract.js'

// Local OCR via Tesseract.js (WASM). Free, no API cost. Used by the 'free'
// translation engine: we OCR here, then send the strings to main for a free
// translator. Traineddata is fetched from the default CDN on first use per lang.

const MAX_SIDE = 1920 // keep in sync with inpaint.ts / translate.ts

export interface OcrBlock {
  x: number
  y: number
  w: number
  h: number
  text: string
}
export interface OcrResult {
  w: number
  h: number
  blocks: OcrBlock[]
}

// Map our language hint to Tesseract traineddata. Manga is usually vertical
// Japanese, so we load the vertical model first.
function tessLangs(hint?: string): string {
  const h = (hint ?? '').toLowerCase()
  if (h.startsWith('en') || h === 'english') return 'eng'
  if (h === 'zh-tw' || h === 'chinese_traditional') return 'chi_tra'
  if (h.startsWith('zh') || h === 'chinese') return 'chi_sim'
  return 'jpn_vert+jpn'
}

// One worker per language set, reused across pages (loading is the slow part).
const workers = new Map<string, Promise<Worker>>()
function getWorker(langs: string): Promise<Worker> {
  let p = workers.get(langs)
  if (!p) {
    p = createWorker(langs, 1).then(async (w) => {
      // Sparse mode finds scattered text regions (speech bubbles) instead of
      // assuming one uniform block covering the whole page.
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
      return w
    })
    workers.set(langs, p)
  }
  return p
}

// Downscale the image the same way the rest of the pipeline does, so OCR coords
// live in the same pixel space the inpaint canvas uses.
function downscaled(img: HTMLImageElement): { canvas: HTMLCanvasElement; w: number; h: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
  return { canvas, w, h }
}

export async function ocrBlocks(img: HTMLImageElement, langHint?: string): Promise<OcrResult> {
  const { canvas, w, h } = downscaled(img)
  const worker = await getWorker(tessLangs(langHint))
  const { data } = await worker.recognize(canvas, {}, { blocks: true })

  const pageArea = w * h
  const blocks: OcrBlock[] = []
  const push = (
    bbox: { x0: number; y0: number; x1: number; y1: number },
    text: string,
    conf?: number
  ): void => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (!t) return
    if (conf !== undefined && conf < 30) return // drop low-confidence garbage
    const bw = bbox.x1 - bbox.x0
    const bh = bbox.y1 - bbox.y0
    if (bw <= 3 || bh <= 3) return
    // Guard: ignore mis-segmented giant boxes (would cover the whole page).
    if (bw * bh > pageArea * 0.5 || (bw > w * 0.85 && bh > h * 0.85)) return
    blocks.push({ x: bbox.x0, y: bbox.y0, w: bw, h: bh, text: t })
  }
  // Line-level boxes (≈ one bubble line / one vertical column) — granular enough
  // to stay in place. Fall back up the hierarchy if a level is missing.
  for (const blk of (data as any).blocks ?? []) {
    const paras = blk.paragraphs ?? []
    if (!paras.length) {
      push(blk.bbox, blk.text)
      continue
    }
    for (const p of paras) {
      const lines = p.lines ?? []
      if (lines.length) for (const ln of lines) push(ln.bbox, ln.text, ln.confidence)
      else push(p.bbox, p.text, p.confidence)
    }
  }
  return { w, h, blocks }
}
