// Main process entry: app lifecycle, the main window, auto-update, and wiring
// of every IPC module. The handlers themselves live in ./ipc/*:
//   ipc/library.ts    local library, works, settings, thumbnails, exit/reset
//   ipc/favorites.ts  favorite files/lists and online favorites
//   ipc/hitomi.ts     doujin online, metadata, downloads
//   ipc/toki.ts       general-manga online (manga-site / backup sites)
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, globalShortcut } from 'electron'
import electronUpdater from 'electron-updater'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import type { UpdateStatus } from '../shared/ipc'
import { store, appState, setMainWindow, getMainWindow, sendToRenderer } from './context'
import { moveFromFavorites } from './lib/favorites'
import { scannedFavorite, migrateFavorites } from './lib/favoriteSync'
import { setTokiChallengeHandler, setTokiStatusHandler } from './lib/toki'
import { applyNetwork } from './lib/network'
import { registerImageScheme, handleImageProtocol, initThumbDir } from './lib/media'
import { registerLibraryIpc } from './ipc/library'
import { registerFavoritesIpc } from './ipc/favorites'
import { registerHitomiIpc } from './ipc/hitomi'
import { registerTokiIpc } from './ipc/toki'
import { applyQuitShortcut } from './lib/quitShortcut'

// Privileged schemes must be registered before the app is ready.
registerImageScheme()

// One-time migration to the in-app general-manga favorites: un-favorite every
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
  await store.saveSettings({ ...store.settings, normalFavSeries: [], normalFavChapters: [], normalFavMigrated: true })
}

function createWindow(): void {
  // No native File/Edit/View menu bar.
  Menu.setApplicationMenu(null)
  // Match the OS caption (title + min/max/close) to the app theme, not the
  // system theme. Kept in sync on theme change by the saveSettings handler.
  nativeTheme.themeSource = store.settings.theme
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: store.settings.theme === 'light' ? '#f4f5f8' : '#0c0e12',
    autoHideMenuBar: true,
    show: false,
    // Dev only: window/taskbar icon from the source asset. Packaged builds use
    // the exe icon (build/icon.png via electron-builder) automatically.
    ...(process.env['ELECTRON_RENDERER_URL'] ? { icon: join(__dirname, '../../build/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })
  setMainWindow(win)

  win.on('ready-to-show', () => win.show())

  // Drop the ref once the window is gone, and force-close leftover windows (the
  // manga-site scraper vetoes close; destroy() bypasses that) so window-all-closed
  // fires and the app quits instead of lingering as a zombie.
  win.on('closed', () => {
    setMainWindow(null)
    for (const w of BrowserWindow.getAllWindows()) w.destroy()
  })

  // F12 / Ctrl+Shift+I toggles DevTools (there's no menu to do it).
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    const f12 = input.key === 'F12'
    const ctrlShiftI = input.control && input.shift && input.key.toLowerCase() === 'i'
    if (f12 || ctrlShiftI) win.webContents.toggleDevTools()
  })

  // Mouse side buttons (Windows sends APPCOMMAND_BROWSER_BACKWARD/FORWARD, not a
  // DOM mouse event) → renderer history navigation.
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') sendToRenderer(IPC.navBack)
    else if (cmd === 'browser-forward') sendToRenderer(IPC.navForward)
  })

  // Close (X) → ask the renderer to show its styled exit modal; it answers via
  // IPC.closeWindow. Not vetoed once confirmed/quitting, or when the renderer
  // has crashed (the modal could never show).
  win.on('close', (e) => {
    if (appState.closing || appState.quitting) return
    if (win.webContents.isCrashed()) return
    e.preventDefault()
    sendToRenderer(IPC.requestClose)
  })

  // Renderer crashed (black screen) → reload once instead of stranding a dead window.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details.reason)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload()
  })

  // MV_DIAG=1 → log renderer lifecycle problems to the terminal.
  if (process.env['MV_DIAG']) {
    const wc = win.webContents
    wc.on('render-process-gone', (_e, d) => console.log('[DIAG] render-process-gone', JSON.stringify(d)))
    wc.on('preload-error', (_e, p, err) => console.log('[DIAG] preload-error', p, err))
    wc.on('did-fail-load', (_e, code, desc) => console.log('[DIAG] did-fail-load', code, desc))
    wc.on('console-message', (_e, lvl, msg, line, src) => console.log('[DIAG] console', lvl, msg, src + ':' + line))
    wc.on('did-finish-load', () => console.log('[DIAG] did-finish-load OK'))
  }

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// Auto-update from GitHub Releases (publish config in electron-builder.yml).
// Packaged builds only (dev has no app-update.yml). Downloads in the background,
// installs on quit or when the user clicks "지금 재시작". NSIS (win) and
// AppImage (linux) are updatable; zip/tar.gz are not.
function setupAutoUpdate(): void {
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  const send = (s: UpdateStatus): void => sendToRenderer(IPC.updateStatus, s)
  autoUpdater.on('update-available', (i) => send({ state: 'available', version: i.version }))
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => send({ state: 'downloaded', version: i.version }))
  autoUpdater.on('error', (e) => {
    console.error('[updater]', e?.message ?? e)
    send({ state: 'error', error: String(e?.message ?? e) })
  })
  autoUpdater.checkForUpdates().catch((e) => console.error('[updater]', e))
  ipcMain.on(IPC.installUpdate, () => {
    appState.quitting = true
    autoUpdater.quitAndInstall()
  })
}

// Single-instance lock: a second launch would fight over the same userData /
// persist:manga-site disk cache ("Unable to move the cache (0x5)"), breaking the manga-site
// scraper. Enforced only in the packaged app — in dev, electron-vite manages a
// single electron, and a zombie left by an HMR restart would otherwise make the
// fresh launch quit instantly. isDev = renderer served by the vite dev server.
const isDev = !!process.env['ELECTRON_RENDERER_URL']
const gotSingleLock = isDev || app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
} else if (!isDev) {
  app.on('second-instance', () => {
    const w = getMainWindow()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.focus()
  })
}

app.whenReady().then(async () => {
  if (!gotSingleLock) return // second instance — quitting
  handleImageProtocol()
  await store.load()
  store.favoriteRule = scannedFavorite
  await applyNetwork(store.settings)
  await migrateNormalFavorites()
  await migrateFavorites()
  await initThumbDir()

  registerLibraryIpc()
  registerFavoritesIpc()
  registerHitomiIpc()
  registerTokiIpc()

  createWindow()

  // Emergency force-quit that works even when the renderer is a black screen
  // (no DOM key events reach the app then): hard-exits, bypassing close vetoes.
  applyQuitShortcut(store.settings)

  // Cloudflare check window shown/cleared → "인증 필요" banner in the renderer.
  setTokiChallengeHandler((active) => sendToRenderer(IPC.tokiChallenge, active))
  setTokiStatusHandler((msg) => sendToRenderer(IPC.tokiStatus, msg))

  if (app.isPackaged) setupAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// From here on every close veto (main window + manga-site scraper) stands down.
app.on('before-quit', () => {
  appState.quitting = true
})
app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', async () => {
  await store.flushWorks()
  await store.flushProgress()
  if (process.platform !== 'darwin') app.quit()
})

