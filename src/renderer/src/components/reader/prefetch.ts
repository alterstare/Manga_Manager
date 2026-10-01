// Bounded, ordered image pre-decoding for the reader.

// Decode `order` (indexes into `srcs`) off-DOM with at most `concurrency`
// decodes in flight, so the FIRST pages finish fast instead of competing with
// the whole list (fixes the long "load everything up front" stall). Pages paint
// from the warm decode cache the instant their <img> mounts (no black frame).
// `onDims` reports each decoded natural size for height estimation; refs are
// pushed into `sink` so decoded bytes aren't GC'd before display. Returns a
// cancel fn.
export function prefetchOrdered(
  srcs: string[],
  order: number[],
  concurrency: number,
  sink: HTMLImageElement[],
  onDims: (i: number, w: number, h: number) => void
): () => void {
  let cancelled = false
  let next = 0
  const step = (): void => {
    if (cancelled) return
    const k = next++
    if (k >= order.length) return
    const i = order[k]
    const im = new Image()
    im.decoding = 'async'
    im.src = srcs[i]
    sink.push(im)
    const after = (): void => {
      if (cancelled) return
      if (im.naturalWidth > 0) onDims(i, im.naturalWidth, im.naturalHeight)
      step() // pull the next page only when this one is done → bounded pressure
    }
    const p = im.decode?.()
    if (p) p.then(after, after)
    else {
      im.onload = after
      im.onerror = after
    }
  }
  for (let c = 0; c < Math.min(concurrency, order.length); c++) step()
  return () => {
    cancelled = true
  }
}
