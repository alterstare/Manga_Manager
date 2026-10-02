// IPC: hitomi online — browsing/search, gallery metadata (enrich local works),
// image urls, cover regeneration, downloads, and the deleted-gallery sweep.
import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import type { Work } from '../../shared/types'
import type { HitomiProgress, HitomiListSource, GallerySummary } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import { store, sendToRenderer, delay } from '../context'
import { scanOne } from '../lib/scanner'
import { moveWorkToFolder } from '../lib/favorites'
import {
  fetchMeta,
  writeSidecar,
  downloadGallery,
  extractCode,
  searchNozomi,
  summary,
  readImageUrls,
  fetchHitomiBuffer,
  pingHitomi,
  popularRanks,
  findKorean,
  hitomiExists, fetchNozomiExcluding } from '../lib/hitomi'
import { suggestTokens, recordSeen } from '../lib/suggest'
import { encodeWeb, thumbFile } from '../lib/media'
import { runDownload, stopDownload } from '../downloads'
import { placeIfFavorite } from '../lib/favoriteSync'

// Summary with its thumb wrapped for our image protocol.
const withWebThumb = (s: GallerySummary): GallerySummary => ({
  ...s,
  thumbUrl: s.thumbUrl ? encodeWeb(s.thumbUrl) : null
})

// Append the user's auto-exclude tags as negative (-) tokens to a search query,
// without ever showing them in the search box. Tokens are stored space-free
// (`female:x`), so appending is separator-safe: reuse the query's own separator
// (comma if it has one, else space) so tokenization stays consistent.
function withExcludes(query: string, exclude: string[]): string {
  const toks = exclude.filter(Boolean).map((t) => (t.startsWith('-') ? t : `-${t}`))
  if (!toks.length) return query
  const sep = query.includes(',') ? ' , ' : ' '
  return query.trim() + sep + toks.join(sep)
}

// Fill a local work's tags/language/artist from hitomi using its code (also
// writes the metadata sidecar into the work folder).
async function enrichOne(workId: string): Promise<Work> {
  const w = store.get(workId)
  if (!w) throw new Error('no work')
  if (!w.code) throw new Error('이 작품에는 hitomi 코드가 없습니다')
  const meta = await fetchMeta(w.code)
  await writeSidecar(w.path, meta)
  return store.update(workId, {
    tags: [...new Set([...w.tags, ...meta.tags])],
    language: meta.language,
    artist: w.artist ?? (meta.artists.length ? meta.artists.join(', ') : null)
  })
}

// Bulk enrich state: one run at a time, cancellable from the UI.
let enrichRunning = false
let enrichCancel = false

export function registerHitomiIpc(): void {
  ipcMain.handle(IPC.hitomiPing, () => pingHitomi())
  ipcMain.handle(IPC.hitomiPopularRanks, (_e, codes: string[]) => popularRanks(codes))
  ipcMain.handle(IPC.hitomiFetchMeta, (_e, code: string) => fetchMeta(code))
  ipcMain.handle(IPC.hitomiSuggest, (_e, query: string) => suggestTokens(query))

  // ---------- browse / search ----------

  ipcMain.handle(IPC.hitomiList, async (_e, source: HitomiListSource, page: number) => {
    const pageSize = store.settings.pageSize || 50
    // A bare gallery number or a hitomi link isn't a nozomi search token — look
    // that single gallery up directly instead of a (fruitless) tag search.
    if (source.kind === 'search') {
      const q = source.query.trim()
      const code = /^\d{5,}$/.test(q) || /^https?:\/\//i.test(q) ? extractCode(q) : null
      if (code) {
        try {
          return { items: [withWebThumb(await summary(code))], total: 1, page: 0, pageSize }
        } catch {
          return { items: [], total: 0, page: 0, pageSize }
        }
      }
    }
    const { ids, total } =
      source.kind === 'search'
        ? await searchNozomi(
            withExcludes(source.query, store.settings.onlineExcludeTags ?? []),
            source.language,
            page,
            pageSize,
            source.sort ?? 'date'
          )
        : // Browse (latest / popular) also honors 설정 › 검색 제외 태그.
          await fetchNozomiExcluding(source, page, pageSize, store.settings.onlineExcludeTags ?? [])
    // Fetch summaries 6 at a time; unreachable galleries are dropped.
    const items: GallerySummary[] = []
    for (let i = 0; i < ids.length; i += 6) {
      const results = await Promise.allSettled(ids.slice(i, i + 6).map((id) => summary(String(id))))
      for (const r of results) if (r.status === 'fulfilled') items.push(withWebThumb(r.value))
    }
    // Learn artists/tags from what the user actually browses, so new artists get
    // suggested without regenerating the bundled snapshot (fire-and-forget).
    void recordSeen(items)
    return { items, total, page, pageSize }
  })

  // Korean-translation candidates of a work (by code / artist / title).
  ipcMain.handle(
    IPC.hitomiFindKorean,
    async (_e, payload: { code: string | null; artist: string | null; title: string }) =>
      (await findKorean(payload)).map(withWebThumb)
  )

  ipcMain.handle(IPC.hitomiReadUrls, async (_e, code: string) => (await readImageUrls(code)).map(encodeWeb))

  // ---------- metadata (enrich local works) ----------

  ipcMain.handle(IPC.hitomiEnrich, (_e, workId: string) => enrichOne(workId))

  ipcMain.handle(IPC.hitomiCancelEnrich, () => {
    enrichCancel = true
  })

  // Enrich every coded work missing language OR artist (the artist clause makes
  // this double as a recovery for cleared/wrong artists). Progress rides the
  // hitomiProgress channel with an empty code.
  ipcMain.handle(IPC.hitomiEnrichAll, async () => {
    if (enrichRunning) return []
    enrichRunning = true
    enrichCancel = false
    const targets = [...store.works.values()].filter((w) => w.code && (!w.language || !w.artist))
    const updated: Work[] = []
    const emit = (done: number, title: string, phase: HitomiProgress['phase']): void =>
      sendToRenderer(IPC.hitomiProgress, { code: '', title, done, total: targets.length, phase } satisfies HitomiProgress)
    for (let i = 0; i < targets.length; i++) {
      if (enrichCancel) break
      try {
        updated.push(await enrichOne(targets[i].id))
      } catch {
        /* skip failures, keep going */
      }
      emit(i + 1, targets[i].title, 'enriching')
      await delay(200) // be gentle with hitomi
    }
    await store.flushWorks()
    enrichRunning = false
    emit(updated.length, '', 'done')
    return updated
  })

  // Sweep hitomi-coded works that no longer exist on hitomi (404) into
  // deletedDir. Network-uncertain results are never moved, so a connection
  // problem can't relocate valid works.
  ipcMain.handle(IPC.classifyDeleted, async () => {
    const dir = store.settings.deletedDir
    if (!dir) throw new Error('삭제된 작품 폴더가 설정되지 않았습니다. 설정에서 폴더를 지정하세요.')
    const targets = [...store.works.values()].filter(
      (w) => (w.library ?? 'hitomi') === 'hitomi' && w.code && /^\d{4,}$/.test(w.code)
    )
    let moved = 0
    let uncertain = 0
    const emit = (done: number, current: string, finished = false): void =>
      sendToRenderer(IPC.classifyProgress, { done, total: targets.length, moved, current, finished })
    for (let i = 0; i < targets.length; i++) {
      const w = targets[i]
      emit(i, w.title)
      const exists = await hitomiExists(w.code as string) // false = 404, null = unknown
      if (exists === false) {
        try {
          store.update(w.id, await moveWorkToFolder(w, dir))
          moved++
        } catch {
          uncertain++
        }
      } else if (exists === null) {
        uncertain++
      }
    }
    await store.flushWorks()
    emit(targets.length, '', true)
    return { moved, checked: targets.length, uncertain, works: [...store.works.values()] }
  })

  // ---------- covers / downloads ----------

  // Regenerate a work's thumbnail from the gallery's first online image (written
  // raw; the renderer shrinks it on load). Callers fall back to the local first
  // page (regenLocalThumb) when this returns !ok.
  ipcMain.handle(IPC.hitomiRegenCover, async (_e, workId: string, code: string) => {
    try {
      const urls = await readImageUrls(code)
      if (!urls.length) return { ok: false }
      await fs.writeFile(thumbFile(workId), await fetchHitomiBuffer(urls[0]))
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })

  // Download a gallery (code or url) into the download dir, then register it.
  ipcMain.handle(IPC.hitomiDownload, async (_e, input: string) => {
    const code = extractCode(input)
    if (!code) throw new Error('코드를 찾을 수 없습니다')
    const destRoot = store.settings.downloadDir ?? store.settings.libraryRoots[0]
    if (!destRoot) throw new Error('다운로드 폴더 또는 라이브러리 폴더를 먼저 설정하세요')
    return runDownload(code, '', async (signal, report) => {
      const { dir, meta } = await downloadGallery(
        code,
        destRoot,
        (done, total, title) => report('downloading', done, total, title),
        store.settings.downloadImageFormat ?? 'avif',
        store.settings.hitomiNamePatterns?.[store.settings.hitomiDownloadPatternIdx ?? 0],
        signal
      )
      const scanned = await scanOne(dir, store.settings)
      if (!scanned) throw new Error('다운로드 후 폴더를 읽지 못했습니다')
      // Register like a scan (an already-favorited gallery comes in hearted),
      // then give a favorite the same folder placement a heart would.
      store.mergeScanPartial([scanned])
      const work = await placeIfFavorite(store.get(scanned.id)!)
      await store.flushWorks()
      report('done', meta.pageCount, meta.pageCount, meta.title)
      return work
    })
  })

  // Stop a queued/running download (any source). The download then reports
  // 'stopped' and rejects with STOP_MSG.
  ipcMain.handle(IPC.downloadStop, (_e, code: string) => stopDownload(code))
}
