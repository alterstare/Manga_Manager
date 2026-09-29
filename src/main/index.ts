import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session, Menu, nativeTheme, globalShortcut } from 'electron'
import electronUpdater from 'electron-updater'
import { join, resolve, sep, basename, dirname } from 'path'
import { pathToFileURL } from 'url'
import { promises as fs } from 'fs'
import type { Settings, SessionState, Work } from '../shared/types'
import { IPC } from '../shared/ipc'
import type { CloseDecision } from '../shared/ipc'
import { Store } from './lib/store'
import { scanLibrary, scanRoot, scanOne, listImages, normalRoots } from './lib/scanner'
import { parseName } from './lib/parser'
import { moveToFavorites, moveFromFavorites, setGroupFolder, mergeSeries, moveWorkToFolder } from './lib/favorites'
import { organizeByLanguage } from './lib/organize'
import { translateImage, translateTexts } from './lib/translate'
import {
  fetchMeta,
  writeSidecar,
  downloadGallery,
  extractCode,
  fetchNozomi,
  searchNozomi,
  summary,
  readImageUrls,
  thumbnailUrl,
  fetchHitomiBuffer,
  pingHitomi,
  popularRanks,
  findKorean,
  sanitize,
  hitomiExists,
  setHitomiContentHost
} from './lib/hitomi'
import { suggestTokens, recordSeen } from './lib/suggest'
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
  downloadGenericChapters,
  setTokiChallengeHandler
} from './lib/toki'
import type {
  HitomiProgress,
  HitomiListSource,
  GallerySummary,
  TokiListSource,
  TokiChapter,
  TransBlock
} from '../shared/ipc'

const store = new Store()
let thumbDir = ''
let enrichRunning = false
let enrichCancel = false

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Network setup for bypassing ISP blocking of hitomi.
// - dnsMode 'system': use the OS resolver. Tools like Unicorn HTTPS intercept
//   system DNS (UDP 53) + encrypt SNI, so they only work if we DON'T force DoH.
// - dnsMode 'doh': do our own DNS-over-HTTPS (for users without such a tool).
// - proxyServer: route all requests through a proxy if the user runs one.
// hitomi DNS is bypassed in lib/hitomi.ts (DoH + direct-IP connect), so we only
// need to honor an optional user proxy here. Default 'system' respects any
// system-wide VPN/proxy the user has configured.
// One-time migration to the in-app normal-favorites system: un-favorite every
// general-manga work and move any that were physically relocated into the fav
// folder back to their origin, so series regroup by their real folders again.
async function migrateNormalFavorites(): Promise<void> {
  if (store.settings.normalFavMigrated) return
  const normals = [...store.works.values()].filter((w) => (w.library ?? 'hitomi') === 'normal')
  for (const w of normals) {
    try {
      if (w.homePath) store.update(w.id, await moveFromFavorites(w))
      else if (w.favorite) store.update(w.id, { favorite: false })
    } catch {
      store.update(w.id, { favorite: false }) // move failed → at least clear the flag
    }
  }
  await store.flushWorks()
  await store.saveSettings({
    ...store.settings,
    normalFavSeries: [],
    normalFavChapters: [],
    normalFavMigrated: true
  })
}

function applyNetwork(s: Settings): void {
  const rules = s.proxyServer.trim()
  session.defaultSession.setProxy(rules ? { proxyRules: rules } : { mode: 'system' })
  setHitomiContentHost(s.hitomiBaseUrl ?? '')
}

// Custom scheme so the renderer can load arbitrary local image files safely.
// URL form: mangaimg://img/<base64url(absolute path)>
protocol.registerSchemesAsPrivileged([
  { scheme: 'mangaimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const HITOMI_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://hitomi.la/'
}

function encodeImg(p: string): string {
  return 'mangaimg://img/' + Buffer.from(p, 'utf-8').toString('base64url')
}

// A work id can contain characters illegal in Windows filenames (e.g. the "u:"
// namespace prefix → colon), so map it to a safe, deterministic thumb path.
// Any char outside [A-Za-z0-9._-] becomes "_".
function thumbFile(workId: string): string {
  return join(thumbDir, `${workId.replace(/[^A-Za-z0-9._-]/g, '_')}.v2.webp`)
}

// Wrap a remote hitomi image url so the renderer can load it through our
// protocol (main attaches the required Referer; bare <img> would get a 403).
function encodeWeb(url: string): string {
  return 'mangaimg://web/' + Buffer.from(url, 'utf-8').toString('base64url')
}

// Wrap a toki image url so the renderer loads it via our protocol (main fetches
// it through the toki session with the site referer; a bare <img> gets a 403).
function encodeToki(url: string): string {
  return 'mangaimg://toki/' + Buffer.from(url, 'utf-8').toString('base64url')
}

// Append the user's auto-exclude tags as negative (-) tokens onto a search query,
// without ever showing them in the search box. Tokens are stored space-free
// (`female:x`), so appending is separator-safe: reuse the query's own separator
// (comma if it has one, else space) so tokenization stays consistent.
function withExcludes(query: string, exclude: string[]): string {
  const toks = exclude.filter(Boolean).map((t) => (t.startsWith('-') ? t : `-${t}`))
  if (!toks.length) return query
  const sep = query.includes(',') ? ' , ' : ' '
  return query.trim() + sep + toks.join(sep)
}

// On-disk cache of gallery summaries by code, used by online favorite lists so a
// preloaded list renders instantly instead of re-fetching every time.
let sumCache: Record<string, GallerySummary> | null = null
async function loadSumCache(): Promise<Record<string, GallerySummary>> {
  if (sumCache) return sumCache
  try {
    sumCache = JSON.parse(await fs.readFile(join(app.getPath('userData'), 'onlineSummaries.json'), 'utf-8'))
  } catch {
    sumCache = {}
  }
  return sumCache!
}
// Ensure summaries for `codes` are cached (fetch the missing, bounded concurrency),
// persist, and return the cache map.
async function ensureSummaries(
  codes: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, GallerySummary>> {
  const cache = await loadSumCache()
  const missing = [...new Set(codes)].filter((c) => c && !cache[c])
  if (!missing.length) return cache
  const queue = [...missing]
  let done = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const code = queue.shift()
      if (!code) return
      try {
        const s = await summary(code)
        cache[code] = { ...s, thumbUrl: s.thumbUrl ? encodeWeb(s.thumbUrl) : null }
      } catch {
        /* skip unreachable */
      }
      onProgress?.(++done, missing.length)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  await fs.writeFile(join(app.getPath('userData'), 'onlineSummaries.json'), JSON.stringify(cache)).catch(() => {})
  return cache
}

function decodeB64Path(url: string): string {
  const b64 = new URL(url).pathname.replace(/^\//, '')
  return Buffer.from(b64, 'base64url').toString('utf-8')
}

// Tolerant extractor for hitomi gallery ids from a favorites/backup JSON in any
// common shape (Pupil and variants): a bare array, or an object with a
// favorites/bookmark/ids/... array; elements may be numbers, strings, or
// objects carrying id/galleryid/gallery_id.
function parseIds(raw: any): string[] {
  const out: string[] = []
  const pushFrom = (arr: any[]): void => {
    for (const x of arr) {
      const v =
        x && typeof x === 'object' ? (x.id ?? x.galleryid ?? x.gallery_id ?? x.gallery?.id) : x
      const s = String(v)
      if (s && s !== 'undefined' && s !== 'null' && /^\d+$/.test(s)) out.push(s)
    }
  }
  if (Array.isArray(raw)) pushFrom(raw)
  else if (raw && typeof raw === 'object') {
    for (const k of ['favorites', 'favorite', 'bookmark', 'bookmarks', 'ids', 'galleries', 'items', 'list']) {
      if (Array.isArray(raw[k])) pushFrom(raw[k])
    }
  }
  return [...new Set(out)]
}

// Pupil favorite_tags <-> our flat favoriteTags strings. Pupil stores
// {area:'artist'|'tag'|'female'|..., tag:'name'}; we store 'name' or 'area:name'.
function tagToEntry(t: string): { area: string; tag: string } {
  const i = t.indexOf(':')
  return i > 0 ? { area: t.slice(0, i), tag: t.slice(i + 1) } : { area: 'tag', tag: t }
}
function entryToTag(e: any): string {
  if (!e || typeof e !== 'object') return ''
  const tag = String(e.tag ?? '').trim()
  if (!tag) return ''
  return e.area && e.area !== 'tag' ? `${e.area}:${tag}` : tag
}
function parseFavoriteTags(raw: any): string[] {
  const arr = raw && Array.isArray(raw.favorite_tags) ? raw.favorite_tags : []
  return [...new Set(arr.map(entryToTag).filter(Boolean))] as string[]
}

let mainWindow: BrowserWindow | null = null
let closing = false
let quitting = false

function createWindow(): void {
  // Remove the native File/Edit/View/Window/Help menu bar entirely.
  Menu.setApplicationMenu(null)
  // Match the OS caption (title + min/max/close) to the app's own theme, not the
  // system theme. Updated live when the user changes theme (saveSettings handler).
  nativeTheme.themeSource = store.settings.theme
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: store.settings.theme === 'light' ? '#f4f5f8' : '#0c0e12',
    autoHideMenuBar: true,
    show: false,
    // Dev only: point the window/taskbar icon at the source build asset. In a
    // packaged build the exe icon (from build/icon.png via electron-builder) is
    // used automatically, so no icon path is needed there.
    ...(process.env['ELECTRON_RENDERER_URL']
      ? { icon: join(__dirname, '../../build/icon.png') }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Null the ref once the window is gone. Without this, mainWindow stays a
  // DESTROYED BrowserWindow (not null), so the many `mainWindow?.webContents.send`
  // guards pass the null check and then throw "Object has been destroyed" — e.g.
  // a toki/download progress callback still in flight after the app was closed.
  mainWindow.on('closed', () => {
    mainWindow = null
    // Force-close any leftover windows (e.g. the toki scraper window, which has a
    // close-vetoing handler). destroy() bypasses that veto, so window-all-closed
    // fires and the app actually quits instead of lingering as a zombie.
    for (const w of BrowserWindow.getAllWindows()) w.destroy()
  })

  // F12 / Ctrl+Shift+I toggles DevTools (no app menu, so wire it manually).
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    const f12 = input.key === 'F12'
    const ctrlShiftI = input.control && input.shift && input.key.toLowerCase() === 'i'
    if (f12 || ctrlShiftI) mainWindow?.webContents.toggleDevTools()
  })

  // Mouse "back" side button (Windows sends APPCOMMAND_BROWSER_BACKWARD, not a
  // DOM mouse event) → tell the renderer to go back to the list.
  mainWindow.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') mainWindow?.webContents.send(IPC.navBack)
    else if (cmd === 'browser-forward') mainWindow?.webContents.send(IPC.navForward)
  })

  // Intercept the close (X) button → show the in-app styled exit modal.
  // The renderer reports the decision back via IPC.closeWindow.
  mainWindow.on('close', (e) => {
    if (closing || quitting) return // already confirmed / app quitting → let it close
    // If the renderer is dead (crashed → black screen), the exit modal can never
    // show, so don't veto the close — let the window actually close.
    if (mainWindow?.webContents.isCrashed()) return
    e.preventDefault()
    mainWindow?.webContents.send(IPC.requestClose)
  })

  // Renderer crashed (black screen). Auto-reload once so the app recovers instead
  // of stranding a dead window the user can't get past.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details.reason)
    if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload()
    }
  })

  if (process.env['MV_DIAG']) {
    const wc = mainWindow.webContents
    wc.on('render-process-gone', (_e, d) => console.log('[DIAG] render-process-gone', JSON.stringify(d)))
    wc.on('preload-error', (_e, p, err) => console.log('[DIAG] preload-error', p, err))
    wc.on('did-fail-load', (_e, code, desc) => console.log('[DIAG] did-fail-load', code, desc))
    wc.on('console-message', (_e, lvl, msg, line, src) =>
      console.log('[DIAG] console', lvl, msg, src + ':' + line)
    )
    wc.on('did-finish-load', () => console.log('[DIAG] did-finish-load OK'))
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Single-instance lock: a second launch would fight over the same userData /
// persist:toki disk cache and throw "Unable to move the cache (0x5)", breaking
// the toki scraping window. Enforce it only in the PACKAGED app — in dev,
// electron-vite already manages a single electron, and a zombie process left by
// an HMR restart would otherwise make the fresh launch quit instantly (window
// never appears). isDev = the renderer is served from the vite dev server.
const isDev = !!process.env['ELECTRON_RENDERER_URL']
const gotSingleLock = isDev || app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
} else if (!isDev) {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  if (!gotSingleLock) return // second instance — quitting
  // Image bytes are immutable per URL (hitomi hash / toki path / local file), so
  // mark them cacheable. Chromium caches responses from this standard+secure
  // scheme when they carry Cache-Control, which is what lets the reader's up-front
  // prefetch (new Image()) warm the cache so the rendered <img> paints from cache
  // instead of re-invoking this handler → no black flash on scroll/page-flip.
  const IMG_CACHE = 'public, max-age=604800, immutable'
  protocol.handle('mangaimg', async (req) => {
    try {
      const host = new URL(req.url).host
      const target = decodeB64Path(req.url)
      if (host === 'web') {
        // Remote hitomi image — fetch through the DNS-bypass path.
        const buf = await fetchHitomiBuffer(target)
        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': IMG_CACHE }
        })
      }
      if (host === 'toki') {
        // General-manga online image — fetch via the toki session + referer.
        const buf = await fetchTokiBuffer(store.settings.tokiBaseUrl, target)
        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': IMG_CACHE }
        })
      }
      const res = await net.fetch(pathToFileURL(target).toString())
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cache-Control', IMG_CACHE)
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })

  await store.load()
  applyNetwork(store.settings)
  await migrateNormalFavorites()
  thumbDir = join(app.getPath('userData'), 'thumbs')
  await fs.mkdir(thumbDir, { recursive: true })
  registerIpc()

  createWindow()

  // Emergency force-quit that works even when the renderer is a black screen
  // (no DOM key events reach the app then). app.exit() hard-terminates the
  // process + all child windows immediately, bypassing any close vetoes.
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.exit(0))

  // Cloudflare auth window shown/cleared → banner in the renderer. Guarded send
  // (mainWindow may be null/destroyed after close) is safe now that 'closed' nulls it.
  setTokiChallengeHandler((active) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.tokiChallenge, active)
  })

  // Auto-update from GitHub Releases (publish config in electron-builder.yml).
  // Packaged builds only — in dev there's no app-update.yml and it would throw.
  // Downloads a newer release in the background; installs on next quit. Works for
  // the NSIS installer (win) and AppImage (linux); zip/tar.gz are not updatable.
  if (app.isPackaged) {
    const { autoUpdater } = electronUpdater
    autoUpdater.autoDownload = true // download in the background as soon as found
    autoUpdater.autoInstallOnAppQuit = true // also install on a normal quit
    const send = (s: import('../shared/ipc').UpdateStatus): void => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.updateStatus, s)
    }
    autoUpdater.on('update-available', (i) => send({ state: 'available', version: i.version }))
    autoUpdater.on('download-progress', (p) =>
      send({ state: 'downloading', percent: Math.round(p.percent) })
    )
    autoUpdater.on('update-downloaded', (i) => send({ state: 'downloaded', version: i.version }))
    autoUpdater.on('error', (e) => {
      console.error('[updater]', e?.message ?? e)
      send({ state: 'error', error: String(e?.message ?? e) })
    })
    autoUpdater.checkForUpdates().catch((e) => console.error('[updater]', e))
    // User clicked "지금 재시작" — install the downloaded update now.
    ipcMain.on(IPC.installUpdate, () => {
      quitting = true
      autoUpdater.quitAndInstall()
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Set once quit begins so window 'close' vetoes (main + toki scraper) stand down
// and the process can actually exit instead of lingering in the background.
app.on('before-quit', () => {
  quitting = true
})
app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', async () => {
  await store.flushWorks()
  if (process.platform !== 'darwin') app.quit()
})

// Concurrency gate for online downloads (settings · 동시 다운로드). The limit is
// read live on each acquire, so changing the setting affects downloads not yet
// started. 0 = unlimited. Waiters are released FIFO as slots free.
let dlActive = 0
const dlWaiters: (() => void)[] = []
// Thrown when a download is stopped by the user (queue wait or mid-download).
// Recognized by the renderer so it doesn't surface as a failure.
const STOP_MSG = 'DOWNLOAD_STOPPED'
// Per-download abort handles, keyed by progress code (hitomi code / toki
// seriesUrl / "backup:<title>"). Present only while queued or downloading.
const dlControllers = new Map<string, AbortController>()

async function acquireDownloadSlot(signal?: AbortSignal): Promise<() => void> {
  const limit = store.settings.maxConcurrentDownloads ?? 0
  if (limit > 0) {
    while (dlActive >= limit) {
      if (signal?.aborted) throw new Error(STOP_MSG)
      // Wake on either a freed slot or an abort, whichever comes first.
      await new Promise<void>((resolve) => {
        const wake = (): void => {
          signal?.removeEventListener('abort', wake)
          resolve()
        }
        dlWaiters.push(wake)
        signal?.addEventListener('abort', wake, { once: true })
      })
      if (signal?.aborted) throw new Error(STOP_MSG)
    }
  }
  dlActive++
  let released = false
  return () => {
    if (released) return
    released = true
    dlActive--
    dlWaiters.shift()?.()
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle(IPC.pickImage, async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['webp', 'jpg', 'jpeg', 'png', 'avif', 'gif', 'bmp'] }]
    })
    return r.canceled ? null : encodeImg(r.filePaths[0])
  })

  ipcMain.handle(IPC.getSettings, () => store.settings)

  ipcMain.handle(IPC.saveSettings, async (_e, s: Settings) => {
    const saved = await store.saveSettings(s)
    applyNetwork(saved)
    nativeTheme.themeSource = saved.theme // keep the OS caption in sync with the app theme
    return saved
  })

  ipcMain.handle(IPC.scanLibrary, async () => {
    const scanned = await scanLibrary(store.settings, {
      onProgress: (n, current) => {
        mainWindow?.webContents.send(IPC.scanProgress, { scanned: n, total: 0, current, done: false })
      }
    })
    const merged = store.mergeScan(scanned)
    await store.flushWorks()
    mainWindow?.webContents.send(IPC.scanProgress, { scanned: merged.length, total: merged.length, current: '', done: true })
    if (store.settings.autoOrganizeOnScan) await runOrganize()
    return [...store.works.values()]
  })

  // Rescan just one folder (favorites / a library root / download dir). Works
  // found get favorite + group membership inferred from their path.
  ipcMain.handle(IPC.scanFolder, async (_e, root: string) => {
    const scanned = await scanRoot(root, store.settings)
    const merged = store.mergeScanPartial(scanned)
    await store.flushWorks()
    return merged
  })

  // Move non-Korean works into their configured language folders.
  async function runOrganize(): Promise<Work[]> {
    const moved = await organizeByLanguage([...store.works.values()], store.settings, (n, title) =>
      mainWindow?.webContents.send(IPC.organizeProgress, { moved: n, current: title, done: false })
    )
    for (const m of moved) store.update(m.id, { path: m.path })
    await store.flushWorks()
    mainWindow?.webContents.send(IPC.organizeProgress, { moved: moved.length, current: '', done: true })
    return [...store.works.values()]
  }

  ipcMain.handle(IPC.organizeLanguages, () => runOrganize())

  // Move works into a genre rule's destination folder based on the works' tags.
  ipcMain.handle(IPC.organizeByGenre, async () => {
    const rules = store.settings.genreRules.filter((r) => r.genre && r.moveDir)
    let moved = 0
    for (const w of [...store.works.values()]) {
      const tags = [...(w.tags ?? []), ...(w.manualTags ?? [])]
      for (const r of rules) {
        if (!tags.includes(r.genre)) continue
        if (dirname(w.path) === r.moveDir) break // already in place
        try {
          store.update(w.id, await moveWorkToFolder(w, r.moveDir as string))
          moved++
        } catch {
          /* skip this work */
        }
        break
      }
    }
    await store.flushWorks()
    return { works: [...store.works.values()], moved }
  })

  ipcMain.handle(IPC.getWorks, () => [...store.works.values()])

  ipcMain.handle(IPC.getWorkImages, async (_e, workId: string) => {
    const w = store.get(workId)
    if (!w) return []
    let files: string[]
    if (w.sources?.length) {
      // Collection work: concatenate each source folder's images, then trim.
      files = []
      for (const s of w.sources) files.push(...(await listImages(s)))
      files = files.slice(store.settings.excludeLeadingPages)
    } else {
      files = await listImages(w.path, store.settings.excludeLeadingPages)
    }
    return files.map(encodeImg)
  })

  ipcMain.handle(IPC.setFavorite, async (_e, workId: string, fav: boolean) => {
    const w = store.get(workId)
    if (!w) throw new Error('no work')
    // General-manga (normal) favorites are managed in-app (see setNormalFav); they
    // never move folders. Only hitomi favorites use the folder-move favorites dir.
    if ((w.library ?? 'hitomi') === 'normal') return store.update(workId, { favorite: fav })
    const favDir = store.settings.favoritesDir
    if (fav && favDir) {
      const patch = await moveToFavorites(w, favDir, store.settings.groups)
      return store.update(workId, patch)
    }
    if (!fav && w.homePath) {
      const patch = await moveFromFavorites(w)
      return store.update(workId, patch)
    }
    return store.update(workId, { favorite: fav })
  })

  // General-manga in-app favorites: toggle a series (by key) or a single chapter
  // (by work id) in the persisted lists. No folder move.
  ipcMain.handle(IPC.setNormalFav, async (_e, kind: 'series' | 'chapter', key: string, fav: boolean) => {
    const field = kind === 'series' ? 'normalFavSeries' : 'normalFavChapters'
    const cur = store.settings[field] ?? []
    const next = fav ? [...new Set([...cur, key])] : cur.filter((x) => x !== key)
    return store.saveSettings({ ...store.settings, [field]: next })
  })

  ipcMain.handle(IPC.setRank, (_e, workId: string, rank: number) =>
    store.update(workId, { rank: Math.max(0, Math.min(5, rank)) })
  )

  ipcMain.handle(IPC.setCoverHash, (_e, workId: string, hash: string, w?: number, h?: number) =>
    store.update(workId, { coverHash: hash, coverW: w, coverH: h })
  )

  // Set a work's group membership (single group, enforced by the UI). Also
  // physically relocates the work folder into/out of the group subfolder.
  ipcMain.handle(IPC.setWorkGroups, async (_e, workId: string, groupIds: string[]) => {
    const w = store.get(workId)
    if (!w) throw new Error('no work')
    const patch = await setGroupFolder(w, groupIds, store.settings.groups)
    const updated = store.update(workId, patch)
    await store.flushWorks()
    return updated
  })

  // Delete a group entirely: move every member work out of the group folder,
  // strip the id from those works, and remove the group from settings.
  ipcMain.handle(IPC.deleteGroup, async (_e, groupId: string) => {
    for (const w of [...store.works.values()]) {
      if ((w.groups ?? []).includes(groupId)) {
        try {
          const patch = await setGroupFolder(w, [], store.settings.groups)
          store.update(w.id, patch)
        } catch {
          // If the move fails, still drop the membership so state stays sane.
          store.update(w.id, { groups: (w.groups ?? []).filter((g) => g !== groupId) })
        }
      }
    }
    const settings = await store.saveSettings({
      ...store.settings,
      groups: store.settings.groups.filter((g) => g.id !== groupId)
    })
    await store.flushWorks()
    return { settings, works: [...store.works.values()] }
  })

  // Favorites export: write favorited works' hitomi ids as a JSON array
  // (Pupil-compatible). Uncoded favorites can't be represented and are skipped.
  ipcMain.handle(IPC.exportFavorites, async () => {
    const ids = [...store.works.values()]
      .filter((w) => w.favorite && w.code)
      .map((w) => Number(w.code))
      .filter((n) => Number.isFinite(n))
    const r = await dialog.showSaveDialog({
      title: '즐겨찾기 내보내기',
      defaultPath: 'favorites.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, count: 0 }
    // Pupil-shaped: { favorites:[ids], favorite_tags:[{area,tag}] }.
    const data = {
      favorites: ids,
      favorite_tags: store.settings.favoriteTags.map(tagToEntry)
    }
    await fs.writeFile(r.filePath, JSON.stringify(data), 'utf-8')
    return { ok: true, count: ids.length, path: r.filePath }
  })

  // Favorites import (merge): read a JSON list of ids in any common shape, then
  // favorite every matching local work (union — never un-favorites).
  ipcMain.handle(IPC.importFavorites, async () => {
    const r = await dialog.showOpenDialog({
      title: '즐겨찾기 불러오기 (병합)',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, matched: 0, total: 0 }
    let ids: string[] = []
    try {
      const raw = JSON.parse(await fs.readFile(r.filePaths[0], 'utf-8'))
      ids = parseIds(raw)
      // Merge favorite tags into settings (union).
      const tags = parseFavoriteTags(raw)
      if (tags.length) {
        const merged = [...new Set([...store.settings.favoriteTags, ...tags])]
        await store.saveSettings({ ...store.settings, favoriteTags: merged })
      }
    } catch {
      return { ok: false, matched: 0, total: 0 }
    }
    let matched = 0
    for (const id of ids) {
      const w = store.get(`h:${id}`)
      if (!w || w.favorite) continue
      if (store.settings.favoritesDir) {
        const patch = await moveToFavorites(w, store.settings.favoritesDir, store.settings.groups)
        store.update(w.id, patch)
      } else {
        store.update(w.id, { favorite: true })
      }
      matched++
    }
    await store.flushWorks()
    return { ok: true, matched, total: ids.length }
  })

  // Import a favorite file as its OWN named list. Each matched local work gets a
  // `favlist:<file name>` manual tag so the list can be browsed separately, and is
  // also marked favorite so it still shows under 즐겨찾기.
  ipcMain.handle(IPC.importFavoriteList, async () => {
    const r = await dialog.showOpenDialog({
      title: '즐겨찾기 목록 불러오기 (파일명이 목록 이름)',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, matched: 0, total: 0, name: '' }
    const name = basename(r.filePaths[0]).replace(/\.[^.]+$/, '').replace(/[:,]/g, ' ').trim() || '목록'
    let ids: string[] = []
    try {
      ids = parseIds(JSON.parse(await fs.readFile(r.filePaths[0], 'utf-8')))
    } catch {
      return { ok: false, matched: 0, total: 0, name }
    }
    const tag = `favlist:${name}`
    let matched = 0
    for (const id of ids) {
      const w = store.get(`h:${id}`)
      if (!w) continue
      const manualTags = w.manualTags.includes(tag) ? w.manualTags : [...w.manualTags, tag]
      store.update(w.id, { manualTags, favorite: true })
      matched++
    }
    await store.flushWorks()
    // Remember the list name so it shows even before/without matches.
    const favLists = [...new Set([...(store.settings.favLists ?? []), name])]
    await store.saveSettings({ ...store.settings, favLists })
    return { ok: true, matched, total: ids.length, name }
  })

  // Import a favorite file as a named ONLINE list (browsed online, not tied to the
  // local library). Stores just the codes under the file name.
  ipcMain.handle(IPC.importOnlineFavList, async () => {
    const r = await dialog.showOpenDialog({
      title: '온라인 즐겨찾기 목록 불러오기 (파일명이 목록 이름)',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, name: '', total: 0 }
    const name = basename(r.filePaths[0]).replace(/\.[^.]+$/, '').replace(/[:,]/g, ' ').trim() || '목록'
    let codes: string[] = []
    try {
      codes = [...new Set(parseIds(JSON.parse(await fs.readFile(r.filePaths[0], 'utf-8'))))]
    } catch {
      return { ok: false, name, total: 0 }
    }
    const lists = (store.settings.onlineFavLists ?? []).filter((l) => l.name !== name)
    lists.push({ name, codes })
    await store.saveSettings({ ...store.settings, onlineFavLists: lists })
    return { ok: true, name, total: codes.length }
  })

  ipcMain.handle(IPC.removeOnlineFavList, async (_e, name: string) => {
    const lists = (store.settings.onlineFavLists ?? []).filter((l) => l.name !== name)
    await store.saveSettings({ ...store.settings, onlineFavLists: lists })
    return { ok: true }
  })

  // Gallery summaries for codes (renders an online favorite list). Served from the
  // on-disk cache; only uncached codes are fetched (so a preloaded list is instant).
  ipcMain.handle(IPC.hitomiSummaries, async (_e, codes: string[]) => {
    const cache = await ensureSummaries(codes)
    return codes.map((c) => cache[c]).filter(Boolean)
  })

  // Preload (cache) every online favorite list's summaries in one go, so viewing a
  // list later is instant. Returns how many of the total codes are now cached.
  ipcMain.handle(IPC.preloadOnlineFavLists, async () => {
    const codes = [...new Set((store.settings.onlineFavLists ?? []).flatMap((l) => l.codes))]
    const cache = await ensureSummaries(codes, (done, total) =>
      mainWindow?.webContents.send(IPC.onlineFavPreloadProgress, { done, total })
    )
    const cached = codes.filter((c) => cache[c]).length
    return { ok: true, total: codes.length, cached }
  })

  // Remove a favorite list: strip its favlist:<name> tag from every work and drop
  // the name from settings. Works stay favorited.
  ipcMain.handle(IPC.removeFavoriteList, async (_e, name: string) => {
    const tag = `favlist:${name}`
    for (const w of store.works.values()) {
      if (w.manualTags.includes(tag)) {
        store.update(w.id, { manualTags: w.manualTags.filter((t) => t !== tag) })
      }
    }
    await store.flushWorks()
    const favLists = (store.settings.favLists ?? []).filter((n) => n !== name)
    await store.saveSettings({ ...store.settings, favLists })
    return { ok: true }
  })

  // Merge several favorite files into one new JSON (union of ids). Standalone —
  // does not touch the library.
  ipcMain.handle(IPC.mergeFavorites, async () => {
    const r = await dialog.showOpenDialog({
      title: '병합할 즐겨찾기 파일 선택 (2개 이상)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || r.filePaths.length === 0) return { ok: false, count: 0, files: 0 }
    const union = new Set<string>()
    const tagUnion = new Set<string>()
    for (const fp of r.filePaths) {
      try {
        const raw = JSON.parse(await fs.readFile(fp, 'utf-8'))
        for (const id of parseIds(raw)) union.add(id)
        for (const t of parseFavoriteTags(raw)) tagUnion.add(t)
      } catch {
        /* skip unreadable file */
      }
    }
    const s = await dialog.showSaveDialog({
      title: '병합 결과 저장',
      defaultPath: 'favorites-merged.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (s.canceled || !s.filePath) return { ok: false, count: union.size, files: r.filePaths.length }
    const ids = [...union].map(Number).filter(Number.isFinite)
    const data = { favorites: ids, favorite_tags: [...tagUnion].map(tagToEntry) }
    await fs.writeFile(s.filePath, JSON.stringify(data), 'utf-8')
    return { ok: true, count: ids.length, files: r.filePaths.length, path: s.filePath }
  })

  // --- Online (hitomi) favorites + ranks ---
  ipcMain.handle(IPC.getOnlineFavs, () => [...store.onlineFavs.values()])
  ipcMain.handle(IPC.setOnlineFav, (_e, code: string, patch: { favorite?: boolean; rank?: number }, meta) =>
    store.setOnlineFav(code, patch, meta)
  )

  ipcMain.handle(IPC.exportOnlineFavs, async () => {
    const codes = [...store.onlineFavs.values()]
      .filter((f) => f.favorite)
      .map((f) => Number(f.code))
      .filter(Number.isFinite)
    const ranks: Record<string, number> = {}
    for (const f of store.onlineFavs.values()) if (f.rank > 0) ranks[f.code] = f.rank
    const r = await dialog.showSaveDialog({
      title: '온라인 즐겨찾기 내보내기',
      defaultPath: 'online-favorites.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, count: 0 }
    // Pupil-compatible shape ({favorites:[ids], favorite_tags}); `ranks` is our
    // own extension that Pupil ignores.
    await fs.writeFile(r.filePath, JSON.stringify({ favorites: codes, favorite_tags: [], ranks }), 'utf-8')
    return { ok: true, count: codes.length, path: r.filePath }
  })

  ipcMain.handle(IPC.importOnlineFavs, async () => {
    const r = await dialog.showOpenDialog({
      title: '온라인 즐겨찾기 불러오기 (병합)',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, count: 0 }
    let raw: any
    try {
      raw = JSON.parse(await fs.readFile(r.filePaths[0], 'utf-8'))
    } catch {
      return { ok: false, count: 0 }
    }
    const ids = parseIds(raw)
    const ranks = raw?.ranks ?? {}
    for (const id of ids) store.setOnlineFav(id, { favorite: true, rank: Number(ranks[id]) || 0 })
    await store.saveOnline()
    return { ok: true, count: ids.length }
  })

  ipcMain.handle(IPC.mergeOnlineFavs, async () => {
    const r = await dialog.showOpenDialog({
      title: '병합할 온라인 즐겨찾기 파일 선택 (2개 이상)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || r.filePaths.length === 0) return { ok: false, count: 0, files: 0 }
    const union = new Set<string>()
    const ranks: Record<string, number> = {}
    for (const fp of r.filePaths) {
      try {
        const raw = JSON.parse(await fs.readFile(fp, 'utf-8'))
        for (const id of parseIds(raw)) union.add(id)
        Object.assign(ranks, raw?.ranks ?? {})
      } catch {
        /* skip */
      }
    }
    const s = await dialog.showSaveDialog({
      title: '병합 결과 저장',
      defaultPath: 'online-favorites-merged.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (s.canceled || !s.filePath) return { ok: false, count: union.size, files: r.filePaths.length }
    const codes = [...union].map(Number).filter(Number.isFinite)
    await fs.writeFile(s.filePath, JSON.stringify({ favorites: codes, favorite_tags: [], ranks }), 'utf-8')
    return { ok: true, count: codes.length, files: r.filePaths.length, path: s.filePath }
  })

  ipcMain.handle(IPC.hitomiFindKorean, async (_e, payload: { code: string | null; artist: string | null; title: string }) => {
    const sums = await findKorean(payload)
    return sums.map((s) => ({ ...s, thumbUrl: s.thumbUrl ? encodeWeb(s.thumbUrl) : null }))
  })

  ipcMain.handle(IPC.addManualTag, (_e, workId: string, tag: string) => {
    const w = store.get(workId)!
    const raw = tag.trim()
    if (!raw) return w
    // A manual tag prefixed language:/artist: is recognized as that field and
    // shown like hitomi's language/artist (esp. for general-manga works).
    const low = raw.toLowerCase()
    if (low.startsWith('language:')) {
      const v = raw.slice(9).trim()
      return store.update(workId, { language: v || null })
    }
    if (low.startsWith('artist:')) {
      const v = raw.slice(7).trim()
      return store.update(workId, { artist: v || null })
    }
    const manualTags = [...new Set([...w.manualTags, low])]
    return store.update(workId, { manualTags })
  })

  ipcMain.handle(IPC.removeManualTag, (_e, workId: string, tag: string) => {
    const w = store.get(workId)!
    return store.update(workId, { manualTags: w.manualTags.filter((t) => t !== tag) })
  })

  ipcMain.handle(IPC.incrementView, (_e, workId: string) => {
    const w = store.get(workId)!
    return store.update(workId, { viewCount: w.viewCount + 1, lastViewedAt: Date.now() })
  })

  ipcMain.handle(IPC.openInExplorer, (_e, workId: string) => {
    const w = store.get(workId)
    if (w) shell.openPath(w.path)
  })

  ipcMain.handle(IPC.deleteWork, async (_e, workId: string) => {
    const w = store.get(workId)
    if (!w) return
    await fs.rm(w.path, { recursive: true, force: true })
    store.remove(workId)
  })

  // Merge general-manga works into one series folder. The folder is created
  // under the normal-library root that contains the first work (so the scanner
  // keeps treating it as a normal-library series).
  ipcMain.handle(IPC.mergeSeries, async (_e, title: string, workIds: string[]) => {
    const works = workIds.map((id) => store.get(id)).filter(Boolean) as Work[]
    if (works.length < 2) return []
    const roots = [...normalRoots(store.settings), store.settings.normalFavoritesDir].filter(
      Boolean
    ) as string[]
    // Deepest root that is an ancestor of the first work's folder.
    const rp = resolve(works[0].path)
    let root = ''
    for (const r of roots) {
      const rr = resolve(r)
      if ((rp === rr || rp.startsWith(rr + sep)) && rr.length > root.length) root = rr
    }
    if (!root) root = resolve(works[0].path, '..', '..') // fallback: grandparent
    const patches = await mergeSeries(works, title, root)
    const updated: Work[] = []
    for (const [id, patch] of Object.entries(patches)) {
      updated.push(store.update(id, patch))
    }
    await store.flushWorks()
    return updated
  })

  // Rename general-manga chapter folders in place. The renderer computes each
  // target name ("<n>화 <subtitle>"); here we just rename the folder within its
  // parent (skipping no-ops and collections) and update the stored path.
  ipcMain.handle(IPC.renameNormalChapters, async (_e, items: { id: string; name: string }[]) => {
    const sanitize = (s: string): string =>
      s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled'
    const updated: Work[] = []
    for (const it of items) {
      const w = store.get(it.id)
      if (!w || !w.path || (w.sources && w.sources.length)) continue // skip collections
      const parent = dirname(w.path)
      const target = sanitize(it.name)
      if (!target || basename(w.path) === target) continue
      let dest = join(parent, target)
      // Avoid clobbering a different existing folder.
      let i = 2
      while (dest !== w.path) {
        try {
          await fs.access(dest)
          dest = join(parent, `${target} (${i++})`)
        } catch {
          break // free name
        }
      }
      try {
        await fs.rename(w.path, dest)
        updated.push(store.update(it.id, { path: dest }))
      } catch {
        /* skip a folder that can't be renamed (locked/missing) */
      }
    }
    await store.flushWorks()
    return updated
  })

  // Sweep hitomi-coded works that no longer exist on hitomi (404) into deletedDir.
  // A work with a code that 404s = deleted; network-uncertain results are skipped
  // (never moved) so a connection problem can't relocate valid works.
  ipcMain.handle(IPC.classifyDeleted, async () => {
    const dir = store.settings.deletedDir
    if (!dir) throw new Error('삭제된 작품 폴더가 설정되지 않았습니다. 설정에서 폴더를 지정하세요.')
    const targets = [...store.works.values()].filter(
      (w) => (w.library ?? 'hitomi') === 'hitomi' && w.code && /^\d{4,}$/.test(w.code)
    )
    let moved = 0
    let uncertain = 0
    const emit = (done: number, current: string, finished = false): void => {
      mainWindow?.webContents.send(IPC.classifyProgress, { done, total: targets.length, moved, current, finished })
    }
    for (let i = 0; i < targets.length; i++) {
      const w = targets[i]
      emit(i, w.title)
      const ex = await hitomiExists(w.code as string)
      if (ex === false) {
        try {
          store.update(w.id, await moveWorkToFolder(w, dir))
          moved++
        } catch {
          uncertain++
        }
      } else if (ex === null) {
        uncertain++
      }
    }
    await store.flushWorks()
    emit(targets.length, '', true)
    return { moved, checked: targets.length, uncertain, works: [...store.works.values()] }
  })

  ipcMain.handle(IPC.getSession, () => store.session)
  ipcMain.handle(IPC.saveSession, (_e, s: SessionState) => store.saveSession(s))

  ipcMain.handle(IPC.getTransEdits, () => store.transEdits)
  ipcMain.handle(IPC.saveTransEdit, (_e, src: string, blocks: TransBlock[]) =>
    store.saveTransEdit(src, blocks)
  )

  // Exit modal decision from the renderer.
  ipcMain.handle(IPC.closeWindow, async (_e, decision: CloseDecision, sess?: SessionState) => {
    if (decision === 'cancel') return
    if (decision === 'keep') {
      // Persist the live tab state so it restores next launch.
      if (sess) await store.saveSession(sess)
    } else {
      // Clear → next launch opens with no tabs.
      await store.saveSession({ tabs: [], activeTabId: null })
    }
    closing = true
    mainWindow?.destroy()
  })
  // Full reset: wipe app data (settings/library/session/etc). When
  // deleteWorkFolders is set, also remove every scanned work's folder from disk.
  // Relaunches into a clean first-run state.
  ipcMain.handle(IPC.resetApp, async (_e, deleteWorkFolders: boolean) => {
    if (deleteWorkFolders) {
      for (const w of store.works.values()) {
        try {
          await fs.rm(w.path, { recursive: true, force: true })
        } catch {
          /* keep going — a locked/missing folder shouldn't abort the reset */
        }
      }
    }
    const ud = app.getPath('userData')
    const files = [
      'works.json',
      'settings.json',
      'session.json',
      'online.json',
      'translationEdits.json',
      'hitomi-suggest-seen.json'
    ]
    for (const f of files) {
      try {
        await fs.rm(join(ud, f), { force: true })
      } catch {
        /* ignore */
      }
    }
    quitting = true
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle(IPC.parseName, (_e, name: string) => parseName(name, store.settings.hitomiNamePatterns))

  async function enrichOne(workId: string): Promise<Work> {
    const w = store.get(workId)
    if (!w) throw new Error('no work')
    if (!w.code) throw new Error('이 작품에는 hitomi 코드가 없습니다')
    const meta = await fetchMeta(w.code)
    await writeSidecar(w.path, meta)
    const tags = [...new Set([...w.tags, ...meta.tags])]
    return store.update(workId, {
      tags,
      language: meta.language,
      artist: w.artist ?? (meta.artists.length ? meta.artists.join(', ') : null)
    })
  }

  ipcMain.handle(IPC.openFolder, (_e, path: string) => {
    if (path) shell.openPath(path)
  })

  ipcMain.handle(IPC.hitomiPing, () => pingHitomi())

  ipcMain.handle(IPC.hitomiPopularRanks, (_e, codes: string[]) => popularRanks(codes))

  ipcMain.handle(IPC.hitomiFetchMeta, (_e, code: string) => fetchMeta(code))

  // Fill a local work's tags/language/artist from hitomi using its code.
  ipcMain.handle(IPC.hitomiEnrich, async (_e, workId: string) => enrichOne(workId))

  // Bulk: enrich every coded work that has no language yet. Guarded against
  // concurrent runs and cancellable.
  ipcMain.handle(IPC.hitomiCancelEnrich, () => {
    enrichCancel = true
  })

  ipcMain.handle(IPC.hitomiEnrichAll, async () => {
    if (enrichRunning) return []
    enrichRunning = true
    enrichCancel = false
    // Coded works missing language OR artist — the artist clause lets this double
    // as a recovery for cleared/wrong artists (refills exactly from the code).
    const targets = [...store.works.values()].filter((w) => w.code && (!w.language || !w.artist))
    const updated: Work[] = []
    const emit = (done: number, title: string): void =>
      mainWindow?.webContents.send(IPC.hitomiProgress, {
        code: '',
        title,
        done,
        total: targets.length,
        phase: 'enriching'
      } satisfies HitomiProgress)
    for (let i = 0; i < targets.length; i++) {
      if (enrichCancel) break
      try {
        const u = await enrichOne(targets[i].id)
        updated.push(u)
      } catch {
        /* skip failures, keep going */
      }
      emit(i + 1, targets[i].title)
      await delay(200)
    }
    await store.flushWorks()
    enrichRunning = false
    mainWindow?.webContents.send(IPC.hitomiProgress, {
      code: '',
      title: '',
      done: updated.length,
      total: targets.length,
      phase: 'done'
    } satisfies HitomiProgress)
    return updated
  })

  ipcMain.handle(IPC.hitomiList, async (_e, source: HitomiListSource, page: number) => {
    const pageSize = store.settings.pageSize || 50
    // Search by number/URL: a bare gallery code (or a hitomi link) isn't a nozomi
    // token, so look the single gallery up directly instead of a (fruitless) tag search.
    if (source.kind === 'search') {
      const q = source.query.trim()
      const code = /^\d{5,}$/.test(q) || /^https?:\/\//i.test(q) ? extractCode(q) : null
      if (code) {
        try {
          const s = await summary(code)
          const item = { ...s, thumbUrl: s.thumbUrl ? encodeWeb(s.thumbUrl) : null }
          return { items: [item], total: 1, page: 0, pageSize }
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
        : await fetchNozomi(source, page, pageSize)
    const items: GallerySummary[] = []
    // Fetch summaries with limited concurrency.
    const limit = 6
    for (let i = 0; i < ids.length; i += limit) {
      const batch = ids.slice(i, i + limit)
      const results = await Promise.allSettled(batch.map((id) => summary(String(id))))
      for (const r of results) {
        if (r.status === 'fulfilled') {
          items.push({ ...r.value, thumbUrl: r.value.thumbUrl ? encodeWeb(r.value.thumbUrl) : null })
        }
      }
    }
    // Learn artists/tags from what the user actually browses so new artists get
    // suggested without regenerating the bundled snapshot (fire-and-forget).
    void recordSeen(items)
    return { items, total, page, pageSize }
  })

  ipcMain.handle(IPC.hitomiSuggest, (_e, query: string) => suggestTokens(query))

  // avif→webp: list a work's avif files (with a mangaimg url the renderer can load).
  ipcMain.handle(IPC.listAvifPaths, async (_e, workId: string) => {
    const w = store.works.get(workId)
    if (!w) return []
    const names = (await fs.readdir(w.path)).filter((f) => /\.avif$/i.test(f)).sort()
    return names.map((n) => {
      const p = join(w.path, n)
      return { path: p, url: encodeImg(p) }
    })
  })
  // Write the renderer-encoded webp next to the avif, then delete the avif.
  ipcMain.handle(IPC.replaceAvifWithWebp, async (_e, avifPath: string, webpBase64: string) => {
    const webpPath = avifPath.replace(/\.avif$/i, '.webp')
    await fs.writeFile(webpPath, Buffer.from(webpBase64, 'base64'))
    if (webpPath.toLowerCase() !== avifPath.toLowerCase()) await fs.rm(avifPath).catch(() => {})
  })

  // OCR + translate one page image. src is a mangaimg:// url (local or web).
  ipcMain.handle(IPC.translateImage, async (_e, imageBase64: string, langHint?: string, w?: number, h?: number) => {
    try {
      console.log('[translate] request bytes', imageBase64.length, 'engine', store.settings.translateEngine)
      const buf = Buffer.from(imageBase64, 'base64')
      const r = await translateImage(buf, store.settings, langHint, w && h ? { w, h } : undefined)
      console.log('[translate] result blocks=', r.blocks.length, 'panel=', !!r.panelText, 'err=', r.error ?? '-')
      return r
    } catch (err: any) {
      console.log('[translate] error', String(err?.message ?? err))
      return { ok: false, w: 0, h: 0, blocks: [], error: String(err?.message ?? err) }
    }
  })

  // Free engine: renderer OCRs locally (Tesseract), main translates the strings.
  ipcMain.handle(IPC.translateTexts, async (_e, texts: string[], langHint?: string) => {
    return translateTexts(texts, store.settings, langHint)
  })

  // Write extracted text to <textExportDir>/<title>.txt (renderer built the body).
  ipcMain.handle(IPC.exportText, async (_e, title: string, content: string) => {
    const dir = store.settings.textExportDir
    if (!dir) throw new Error('내보낼 폴더가 설정되지 않았습니다. 설정에서 텍스트 내보내기 폴더를 지정하세요.')
    await fs.mkdir(dir, { recursive: true })
    const name = (sanitize(title).trim() || 'export').slice(0, 150)
    // Don't overwrite an existing export — bump a " (1)", " (2)" … suffix.
    let path = join(dir, `${name}.txt`)
    for (let n = 1; ; n++) {
      try {
        await fs.access(path)
        path = join(dir, `${name} (${n}).txt`)
      } catch {
        break // free name
      }
    }
    await fs.writeFile(path, content, 'utf-8')
    return path
  })

  // Image export: renderer draws each translated page to a canvas and streams the
  // bytes here. First create a fresh per-work folder (collision-safe like the .txt).
  ipcMain.handle(IPC.exportImageDir, async (_e, title: string) => {
    const root = store.settings.textExportDir
    if (!root) throw new Error('내보낼 폴더가 설정되지 않았습니다. 설정에서 내보내기 폴더를 지정하세요.')
    const base = (sanitize(title).trim() || 'export').slice(0, 150)
    let dir = join(root, base)
    for (let n = 1; ; n++) {
      try {
        await fs.access(dir)
        dir = join(root, `${base} (${n})`)
      } catch {
        break
      }
    }
    await fs.mkdir(dir, { recursive: true })
    return dir
  })
  ipcMain.handle(IPC.writeImageFile, async (_e, dir: string, name: string, base64: string) => {
    await fs.writeFile(join(dir, name), Buffer.from(base64, 'base64'))
  })

  ipcMain.handle(IPC.hitomiReadUrls, async (_e, code: string) => {
    const urls = await readImageUrls(code)
    return urls.map(encodeWeb)
  })

  // Regenerate a hitomi work's thumbnail from the online (hitomi) cover: fetch the
  // gallery's first image and write it as the thumb. Falls back are handled by the
  // caller (regenLocalThumb) when this returns !ok.
  ipcMain.handle(IPC.hitomiRegenCover, async (_e, workId: string, code: string) => {
    try {
      const urls = await readImageUrls(code)
      if (!urls.length) return { ok: false }
      const buf = await fetchHitomiBuffer(urls[0])
      await fs.writeFile(thumbFile(workId), buf)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })

  // --- General-manga online (toki-family) ---
  ipcMain.handle(IPC.tokiList, async (_e, source: TokiListSource, page: number) => {
    const r = await tokiList(store.settings.tokiBaseUrl, source, page)
    // Wrap card thumbs so they load through our protocol with the site referer.
    return { ...r, items: r.items.map((it) => ({ ...it, thumb: it.thumb ? encodeToki(it.thumb) : null })) }
  })
  ipcMain.handle(IPC.tokiOpenSite, (_e, url?: string) =>
    tokiOpenSite(store.settings.tokiBaseUrl, url)
  )
  ipcMain.handle(IPC.tokiScrapeList, () => tokiScrapeList())
  ipcMain.handle(IPC.tokiChapters, (_e, seriesUrl: string) =>
    tokiChapters(store.settings.tokiBaseUrl, seriesUrl)
  )
  ipcMain.handle(IPC.tokiReadUrls, async (_e, chapterUrl: string) => {
    const urls = await tokiReadUrls(store.settings.tokiBaseUrl, chapterUrl)
    return urls.map(encodeToki)
  })

  // Download a toki series (all chapters, or only `chapterUrls`) into the
  // general-manga library, then scan the new chapter folders in. Progress rides
  // the hitomiProgress channel (code = seriesUrl). Downloads go to the dedicated
  // general-manga download folder — never the hitomi library.
  const runTokiDownload = async (
    seriesUrl: string,
    title: string,
    chapterUrls?: string[]
  ): Promise<Work[]> => {
    const destRoot =
      store.settings.normalDownloadDir ??
      store.settings.normalFavoritesDir ??
      normalRoots(store.settings)[0]
    if (!destRoot)
      throw new Error('일반 만화 다운로드 폴더(설정 · 일반 만화)를 먼저 지정하세요')
    const emit = (done: number, total: number, label: string, phase: HitomiProgress['phase']): void => {
      mainWindow?.webContents.send(IPC.hitomiProgress, {
        code: seriesUrl,
        title: title || label,
        done,
        total,
        phase
      } satisfies HitomiProgress)
    }
    const controller = new AbortController()
    dlControllers.set(seriesUrl, controller)
    emit(0, 0, '', 'queued')
    try {
      const release = await acquireDownloadSlot(controller.signal)
      emit(0, 0, '', 'fetching')
      try {
        // Grab the author from the series page so downloaded chapters carry it.
        const artist = await tokiSeriesAuthor(store.settings.tokiBaseUrl, seriesUrl).catch(() => null)
        const dir = await tokiDownloadSeries(
          store.settings.tokiBaseUrl,
          seriesUrl,
          title,
          destRoot,
          (done, total, label) => emit(done, total, label, 'downloading'),
          chapterUrls,
          controller.signal
        )
        // Force the normal library stamp regardless of where destRoot sits.
        const scanned = await scanRoot(dir, store.settings, 'normal')
        let merged = store.mergeScanPartial(scanned)
        if (artist) merged = merged.map((w) => store.update(w.id, { artist }) ?? w)
        await store.flushWorks()
        emit(merged.length, merged.length, '', 'done')
        return merged
      } finally {
        release()
      }
    } catch (err: any) {
      if (controller.signal.aborted || err?.message === STOP_MSG) {
        emit(0, 0, '', 'stopped')
        throw new Error(STOP_MSG)
      }
      mainWindow?.webContents.send(IPC.hitomiProgress, {
        code: seriesUrl,
        title,
        done: 0,
        total: 0,
        phase: 'error',
        message: String(err?.message ?? err)
      } satisfies HitomiProgress)
      throw err
    } finally {
      dlControllers.delete(seriesUrl)
    }
  }
  ipcMain.handle(IPC.tokiDownload, (_e, seriesUrl: string, title: string) =>
    runTokiDownload(seriesUrl, title)
  )
  ipcMain.handle(
    IPC.tokiDownloadChapters,
    (_e, seriesUrl: string, title: string, chapterUrls: string[]) =>
      runTokiDownload(seriesUrl, title, chapterUrls)
  )
  ipcMain.handle(IPC.tokiSeriesAuthor, (_e, seriesUrl: string) =>
    tokiSeriesAuthor(store.settings.tokiBaseUrl, seriesUrl)
  )
  ipcMain.handle(IPC.tokiSeriesTitle, (_e, seriesUrl: string) =>
    tokiSeriesTitle(store.settings.tokiBaseUrl, seriesUrl)
  )
  // Backup (gnuboard) site: download already-scraped chapters in the background
  // to the general-manga download folder. Progress rides the hitomiProgress
  // channel (code = a synthetic id from the title).
  ipcMain.handle(
    IPC.tokiDownloadGeneric,
    async (_e, title: string, chapters: TokiChapter[], only?: string[]) => {
      const destRoot =
        store.settings.normalDownloadDir ??
        store.settings.normalFavoritesDir ??
        normalRoots(store.settings)[0]
      if (!destRoot) throw new Error('일반 만화 다운로드 폴더(설정 · 일반 만화)를 먼저 지정하세요')
      const code = 'backup:' + title
      const emit = (done: number, total: number, label: string, phase: HitomiProgress['phase']): void => {
        mainWindow?.webContents.send(IPC.hitomiProgress, {
          code,
          title: title || label,
          done,
          total,
          phase
        } satisfies HitomiProgress)
      }
      const controller = new AbortController()
      dlControllers.set(code, controller)
      emit(0, 0, '', 'queued')
      try {
        const release = await acquireDownloadSlot(controller.signal)
        emit(0, 0, '', 'fetching')
        try {
          const dir = await downloadGenericChapters(
            chapters,
            title,
            destRoot,
            (done, total, label) => emit(done, total, label, 'downloading'),
            only,
            controller.signal
          )
          const scanned = await scanRoot(dir, store.settings, 'normal')
          const merged = store.mergeScanPartial(scanned)
          await store.flushWorks()
          emit(merged.length, merged.length, '', 'done')
          return merged
        } finally {
          release()
        }
      } catch (err: any) {
        if (controller.signal.aborted || err?.message === STOP_MSG) {
          emit(0, 0, '', 'stopped')
          throw new Error(STOP_MSG)
        }
        mainWindow?.webContents.send(IPC.hitomiProgress, {
          code,
          title,
          done: 0,
          total: 0,
          phase: 'error',
          message: String(err?.message ?? err)
        } satisfies HitomiProgress)
        throw err
      } finally {
        dlControllers.delete(code)
      }
    }
  )
  // Fill artist on works from the online source (search by title → author).
  ipcMain.handle(IPC.tokiFillArtist, async (_e, workIds: string[], title: string) => {
    const artist = await tokiAuthorForTitle(store.settings.tokiBaseUrl, title).catch(() => null)
    if (!artist) return []
    const out: Work[] = []
    for (const id of workIds) {
      const w = store.update(id, { artist })
      if (w) out.push(w)
    }
    await store.flushWorks()
    return out
  })

  ipcMain.handle(IPC.saveThumb, async (_e, workId: string, dataUrl: string) => {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const file = thumbFile(workId)
    await fs.writeFile(file, Buffer.from(b64, 'base64'))
    return encodeImg(file)
  })

  ipcMain.handle(IPC.getThumb, async (_e, workId: string) => {
    const file = thumbFile(workId)
    try {
      // Version the url by file mtime so a regenerated cover (same path) busts
      // the renderer's image cache. The protocol handler ignores the query.
      const st = await fs.stat(file)
      return encodeImg(file) + '?v=' + Math.floor(st.mtimeMs)
    } catch {
      return null
    }
  })

  // Regenerate a work's cover thumbnail from the online source (search by title,
  // grab the first result's cover, write it to every given chapter's thumb).
  ipcMain.handle(IPC.tokiRegenCover, async (_e, workIds: string[], title: string) => {
    try {
      const cover = await tokiCoverForTitle(store.settings.tokiBaseUrl, title)
      if (!cover) return { ok: false }
      const buf = await fetchTokiBuffer(store.settings.tokiBaseUrl, cover)
      for (const id of workIds) {
        await fs.writeFile(thumbFile(id), buf).catch(() => {})
      }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })

  // Download a gallery by code/url into the download dir, then register it.
  ipcMain.handle(IPC.hitomiDownload, async (_e, input: string) => {
    const code = extractCode(input)
    if (!code) throw new Error('코드를 찾을 수 없습니다')
    const destRoot = store.settings.downloadDir ?? store.settings.libraryRoots[0]
    if (!destRoot) throw new Error('다운로드 폴더 또는 라이브러리 폴더를 먼저 설정하세요')

    const emit = (p: HitomiProgress): void => {
      mainWindow?.webContents.send(IPC.hitomiProgress, p)
    }
    const controller = new AbortController()
    dlControllers.set(code, controller)
    emit({ code, title: '', done: 0, total: 0, phase: 'queued' })
    try {
      const release = await acquireDownloadSlot(controller.signal)
      emit({ code, title: '', done: 0, total: 0, phase: 'fetching' })
      try {
        const { dir, meta } = await downloadGallery(
          code,
          destRoot,
          (done, total, title) => emit({ code, title, done, total, phase: 'downloading' }),
          store.settings.downloadImageFormat ?? 'avif',
          store.settings.hitomiNamePatterns?.[store.settings.hitomiDownloadPatternIdx ?? 0],
          controller.signal
        )
        const work = await scanOne(dir, store.settings)
        if (!work) throw new Error('다운로드 후 폴더를 읽지 못했습니다')
        store.works.set(work.id, work)
        await store.flushWorks()
        emit({ code, title: meta.title, done: meta.pageCount, total: meta.pageCount, phase: 'done' })
        return work
      } finally {
        release()
      }
    } catch (err: any) {
      if (controller.signal.aborted || err?.message === STOP_MSG) {
        emit({ code, title: '', done: 0, total: 0, phase: 'stopped' })
        throw new Error(STOP_MSG)
      }
      emit({ code, title: '', done: 0, total: 0, phase: 'error', message: String(err?.message ?? err) })
      throw err
    } finally {
      dlControllers.delete(code)
    }
  })

  // Stop a running/queued download. Aborts its controller; the handler then
  // emits a 'stopped' progress event and rejects with STOP_MSG.
  ipcMain.handle(IPC.downloadStop, (_e, code: string) => {
    const c = dlControllers.get(code)
    if (!c) return false
    c.abort()
    return true
  })
}
