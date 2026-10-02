// IPC: general-manga online (toki-family mirror + backup gnuboard sites) —
// lists, chapters, image urls, author/title/cover lookups and downloads into
// the general-manga library. Scraping itself lives in lib/toki.ts.
import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import type { Work } from '../../shared/types'
import type { TokiListSource, TokiChapter } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import { store } from '../context'
import { scanRoot, normalRoots } from '../lib/scanner'
import {
  tokiList,
  tokiChapters,
  tokiReadUrls,
  fetchTokiBuffer,
  tokiDownloadSeries,
  tokiOpenSite,
  tokiCoverForTitle,
  tokiSeriesAuthor,
  tokiSeriesTitle,
  tokiAuthorForTitle,
  tokiScrapeList,
  downloadGenericChapters
} from '../lib/toki'
import { encodeToki, thumbFile } from '../lib/media'
import { runDownload } from '../downloads'

// Where general-manga downloads go — never the hitomi library.
function normalDestRoot(): string {
  const s = store.settings
  const dest = s.normalDownloadDir ?? normalRoots(s)[0]
  if (!dest) throw new Error('일반 만화 다운로드 폴더(설정 · 일반 만화)를 먼저 지정하세요')
  return dest
}

// Register a freshly downloaded series folder as general-manga works (the
// 'normal' stamp is forced regardless of where the folder sits).
async function importDownloaded(dir: string, artist?: string | null): Promise<Work[]> {
  const scanned = await scanRoot(dir, store.settings, 'normal')
  const merged = store.mergeScanPartial(scanned)
  // The artist belongs to THIS series only. mergeScanPartial returns the whole
  // library, so stamping its result overwrote every work's artist (hitomi
  // included) with the downloaded series' author.
  if (artist) for (const w of scanned) store.update(w.id, { artist })
  await store.flushWorks()
  return artist ? [...store.works.values()] : merged
}

// Download a toki series (all chapters, or only `chapterUrls`).
function runTokiDownload(seriesUrl: string, title: string, chapterUrls?: string[]): Promise<Work[]> {
  const destRoot = normalDestRoot()
  return runDownload(seriesUrl, title, async (signal, report) => {
    // Grab the author from the series page so downloaded chapters carry it.
    const artist = await tokiSeriesAuthor(store.settings.tokiBaseUrl, seriesUrl).catch(() => null)
    const dir = await tokiDownloadSeries(
      store.settings.tokiBaseUrl,
      seriesUrl,
      title,
      destRoot,
      (done, total, label) => report('downloading', done, total, label),
      chapterUrls,
      signal
    )
    const merged = await importDownloaded(dir, artist)
    report('done', merged.length, merged.length)
    return merged
  })
}

export function registerTokiIpc(): void {
  // ---------- browse ----------

  ipcMain.handle(IPC.tokiList, async (_e, source: TokiListSource, page: number) => {
    const r = await tokiList(store.settings.tokiBaseUrl, source, page)
    // Wrap card thumbs so they load through our protocol with the site referer.
    return { ...r, items: r.items.map((it) => ({ ...it, thumb: it.thumb ? encodeToki(it.thumb) : null })) }
  })
  ipcMain.handle(IPC.tokiChapters, (_e, seriesUrl: string) => tokiChapters(store.settings.tokiBaseUrl, seriesUrl))
  ipcMain.handle(IPC.tokiReadUrls, async (_e, chapterUrl: string) => (await tokiReadUrls(store.settings.tokiBaseUrl, chapterUrl)).map(encodeToki))
  ipcMain.handle(IPC.tokiSeriesAuthor, (_e, seriesUrl: string) => tokiSeriesAuthor(store.settings.tokiBaseUrl, seriesUrl))
  ipcMain.handle(IPC.tokiSeriesTitle, (_e, seriesUrl: string) => tokiSeriesTitle(store.settings.tokiBaseUrl, seriesUrl))

  // Show the scraper window (Cloudflare check / backup site browsing by hand).
  ipcMain.handle(IPC.tokiOpenSite, (_e, url?: string) => tokiOpenSite(store.settings.tokiBaseUrl, url))
  // Backup site: read the chapter list of whatever page the user navigated to.
  ipcMain.handle(IPC.tokiScrapeList, () => tokiScrapeList())

  // ---------- downloads (progress on hitomiProgress, code = seriesUrl) ----------

  ipcMain.handle(IPC.tokiDownload, (_e, seriesUrl: string, title: string) => runTokiDownload(seriesUrl, title))
  ipcMain.handle(IPC.tokiDownloadChapters, (_e, seriesUrl: string, title: string, chapterUrls: string[]) =>
    runTokiDownload(seriesUrl, title, chapterUrls)
  )

  // Backup site: download already-scraped chapters in the background
  // (progress code = "backup:<title>").
  ipcMain.handle(IPC.tokiDownloadGeneric, (_e, title: string, chapters: TokiChapter[], only?: string[]) => {
    const destRoot = normalDestRoot()
    return runDownload('backup:' + title, title, async (signal, report) => {
      const dir = await downloadGenericChapters(
        chapters,
        title,
        destRoot,
        (done, total, label) => report('downloading', done, total, label),
        only,
        signal
      )
      const merged = await importDownloaded(dir)
      report('done', merged.length, merged.length)
      return merged
    })
  })

  // ---------- metadata for local works ----------

  // Fill the artist of local works from the online source (search by title).
  ipcMain.handle(IPC.tokiFillArtist, async (_e, workIds: string[], title: string) => {
    const artist = await tokiAuthorForTitle(store.settings.tokiBaseUrl, title).catch(() => null)
    if (!artist) return []
    const out = workIds.map((id) => store.update(id, { artist })).filter(Boolean) as Work[]
    await store.flushWorks()
    return out
  })

  // Regenerate a series' cover from the online source (search by title, take the
  // first result's cover) into every given chapter's thumb. Written raw; the
  // renderer shrinks it on load.
  ipcMain.handle(IPC.tokiRegenCover, async (_e, workIds: string[], title: string) => {
    try {
      const cover = await tokiCoverForTitle(store.settings.tokiBaseUrl, title)
      if (!cover) return { ok: false }
      const buf = await fetchTokiBuffer(store.settings.tokiBaseUrl, cover)
      for (const id of workIds) await fs.writeFile(thumbFile(id), buf).catch(() => {})
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })
}
