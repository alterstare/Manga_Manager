import { invalidate } from './images'

// Encode an image (loaded from a mangaimg:// url) to a webp Blob via canvas.
// Chromium decodes avif and encodes webp natively — no native module needed.
async function toWebpBlob(url: string, quality: number): Promise<Blob | null> {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', quality))
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).split(',')[1] ?? '')
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

// Convert every .avif page of a work to .webp (for Pupil compatibility). Returns
// the number of files converted. `onProgress(done, total)` fires per page.
export async function convertWorkToWebp(
  workId: string,
  quality = 0.92,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const files = await window.api.listAvifPaths(workId)
  let done = 0
  for (const f of files) {
    try {
      const blob = await toWebpBlob(f.url, quality)
      if (blob) {
        const b64 = await blobToBase64(blob)
        await window.api.replaceAvifWithWebp(f.path, b64)
        done++
      }
    } catch {
      /* skip a page that fails to decode/encode */
    }
    onProgress?.(done, files.length)
  }
  if (done) invalidate(workId)
  return done
}
