import type { Work } from '../../shared/types'
import type { TransBlock, TransResult } from '../../shared/ipc'
import { getImages } from './images'
import { getTranslation } from './translate'
import { isSfx, loadImage, drawTranslation } from './inpaint'

// Reading order for exported text. Manga is drawn right-to-left, but the user asked
// for left-top-first paragraph order, so we sort top→bottom in row bands and
// left→right within a band. Flip RTL to switch to true manga order.
const RTL = false

function orderBlocks(blocks: TransBlock[]): TransBlock[] {
  if (blocks.length <= 1) return blocks
  const hs = blocks.map((b) => b.h).sort((a, b) => a - b)
  const band = Math.max(8, (hs[hs.length >> 1] || 20) * 0.7)
  return [...blocks].sort((a, b) => {
    const ay = a.y + a.h / 2
    const by = b.y + b.h / 2
    if (Math.abs(ay - by) > band) return ay - by // different row → higher one first
    const ax = a.x + a.w / 2
    const bx = b.x + b.w / 2
    return RTL ? bx - ax : ax - bx
  })
}

export interface ExportProgress {
  page: number
  total: number
}

// Extract every page's text for a work and return it as one document. `withTr`
// includes the Korean translation line under each source paragraph.
//
//   1p
//   <source paragraph>
//   <korean translation>   (only when withTr)
//   <next source paragraph>
//   ...
//   2p
//   ...
export async function buildWorkText(
  work: Work,
  withTr: boolean,
  onProgress?: (p: ExportProgress) => void
): Promise<string> {
  const srcs = await getImages(work.id)
  const langHint = work.language ?? undefined
  const out: string[] = []
  for (let i = 0; i < srcs.length; i++) {
    onProgress?.({ page: i + 1, total: srcs.length })
    let blocks: TransBlock[] = []
    try {
      const r = await getTranslation(srcs[i], langHint)
      // Drop onomatopoeia / SFX just like the in-viewer translation does.
      if (r.ok) blocks = orderBlocks(r.blocks.filter((b) => !isSfx(b, r.w, r.h)))
    } catch {
      /* skip a page that fails OCR — keep going */
    }
    // Page header even for empty pages so numbering stays aligned with the book.
    out.push(`${i + 1}p`)
    for (const b of blocks) {
      const src = (b.text || '').trim()
      const tr = (b.tr || '').trim()
      if (!src && !tr) continue
      out.push(src || tr) // source line (fall back to tr if no source came back)
      if (withTr && tr && src) out.push(tr)
      out.push('') // blank line between paragraphs
    }
    out.push('') // blank line between pages
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

// Render every page with its translation drawn in (same as the in-viewer overlay)
// and save each as an image into a fresh <exportDir>/<title>/ folder. Pages with no
// translation are saved as the plain original. Returns the folder path.
export async function exportWorkImages(
  work: Work,
  onProgress?: (p: ExportProgress) => void
): Promise<string> {
  const srcs = await getImages(work.id)
  const langHint = work.language ?? undefined
  // Resolve/create the folder first — throws early if no export folder is set.
  const dir = await window.api.exportImageDir(work.title)
  for (let i = 0; i < srcs.length; i++) {
    onProgress?.({ page: i + 1, total: srcs.length })
    const img = await loadImage(srcs[i])
    let res: TransResult = { ok: true, w: 0, h: 0, blocks: [] }
    try {
      const r = await getTranslation(srcs[i], langHint)
      if (r.ok) res = r
    } catch {
      /* no translation for this page → save the original */
    }
    const canvas = document.createElement('canvas')
    drawTranslation(canvas, img, res) // draws original + translation overlay (SFX skipped)
    const b64 = canvas.toDataURL('image/webp', 0.9).split(',')[1]
    await window.api.writeImageFile(dir, `${String(i + 1).padStart(3, '0')}.webp`, b64)
  }
  return dir
}

// Build the document and write it to <textExportDir>/<title>.txt. Returns the path.
export async function exportWorkText(
  work: Work,
  withTr: boolean,
  onProgress?: (p: ExportProgress) => void
): Promise<string> {
  const content = await buildWorkText(work, withTr, onProgress)
  return window.api.exportText(work.title, content)
}
