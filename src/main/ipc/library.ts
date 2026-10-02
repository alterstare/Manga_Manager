// IPC: the local library — settings, scanning, works (favorite / rank / groups /
// tags / views), folder operations, session, thumbnails, exports and the app
// exit/reset flow.
import { app, ipcMain, dialog, shell, nativeTheme, clipboard } from 'electron'
import { join, resolve, sep, basename, dirname } from 'path'
import { promises as fs } from 'fs'
import type { Settings, SessionState, Work } from '../../shared/types'
import type { CloseDecision, TransBlock } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import { store, appState, getMainWindow, sendToRenderer } from '../context'
import { scanLibrary, scanRoot, listImages, normalRoots } from '../lib/scanner'
import { parseName } from '../lib/parser'
import { setGroupFolder, mergeSeries, moveWorkToFolder, renameGroupFolders, safeName } from '../lib/favorites'
import { setWorkFavorite } from '../lib/favoriteSync'
import { organizeByLanguage } from '../lib/organize'
import { translateImage, translateTexts } from '../lib/translate'
import { sanitize } from '../lib/hitomi'
import { applyNetwork } from '../lib/network'
import { encodeImg, thumbFile, isRawThumb } from '../lib/media'

const allWorks = (): Work[] => [...store.works.values()]

// First free path for `name` in `dir`: name, "name (1)", "name (2)" … (`ext`
// is appended after the counter, e.g. ".txt"; empty for folders).
async function freePath(dir: string, name: string, ext = ''): Promise<string> {
  let path = join(dir, `${name}${ext}`)
  for (let n = 1; ; n++) {
    try {
      await fs.access(path)
      path = join(dir, `${name} (${n})${ext}`)
    } catch {
      return path
    }
  }
}

// Move non-Korean works into their configured language folders.
async function runOrganize(): Promise<Work[]> {
  const moved = await organizeByLanguage(allWorks(), store.settings, (n, title) =>
    sendToRenderer(IPC.organizeProgress, { moved: n, current: title, done: false })
  )
  for (const m of moved) store.update(m.id, { path: m.path })
  await store.flushWorks()
  sendToRenderer(IPC.organizeProgress, { moved: moved.length, current: '', done: true })
  return allWorks()
}

export function registerLibraryIpc(): void {
  // ---------- pickers / settings ----------

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
    await applyNetwork(saved)
    nativeTheme.themeSource = saved.theme // keep the OS caption in sync with the app theme
    return saved
  })

  ipcMain.handle(IPC.parseName, (_e, name: string) => parseName(name, store.settings.hitomiNamePatterns))

  // ---------- scanning / organizing ----------

  ipcMain.handle(IPC.scanLibrary, async () => {
    const scanned = await scanLibrary(store.settings, {
      onProgress: (n, current) =>
        sendToRenderer(IPC.scanProgress, { scanned: n, total: 0, current, done: false })
    })
    const merged = store.mergeScan(scanned)
    await store.flushWorks()
    sendToRenderer(IPC.scanProgress, { scanned: merged.length, total: merged.length, current: '', done: true })
    if (store.settings.autoOrganizeOnScan) await runOrganize()
    return allWorks()
  })

  // Rescan just one folder (favorites / a library root / download dir). Works
  // found get favorite + group membership inferred from their path.
  ipcMain.handle(IPC.scanFolder, async (_e, root: string) => {
    const merged = store.mergeScanPartial(await scanRoot(root, store.settings))
    await store.flushWorks()
    return merged
  })

  ipcMain.handle(IPC.organizeLanguages, () => runOrganize())

  // Move works into a genre rule's destination folder based on their tags
  // (first matching rule wins).
  ipcMain.handle(IPC.organizeByGenre, async () => {
    const rules = store.settings.genreRules.filter((r) => r.genre && r.moveDir)
    let moved = 0
    for (const w of allWorks()) {
      const tags = [...(w.tags ?? []), ...(w.manualTags ?? [])]
      const rule = rules.find((r) => tags.includes(r.genre))
      if (!rule || dirname(w.path) === rule.moveDir) continue // no rule / already in place
      try {
        store.update(w.id, await moveWorkToFolder(w, rule.moveDir as string))
        moved++
      } catch {
        /* skip this work */
      }
    }
    await store.flushWorks()
    return { works: allWorks(), moved }
  })

  // ---------- works ----------

  ipcMain.handle(IPC.getWorks, () => allWorks())

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

  // Heart a local work. Coded doujin works go through the favorites list
  // (shared with the online side); see lib/favoriteSync.ts.
  ipcMain.handle(IPC.setFavorite, (_e, workId: string, fav: boolean) => setWorkFavorite(workId, fav))

  // General-manga in-app favorites: toggle a series (by key) or a single chapter
  // (by work id) in the persisted lists, stamping normalFavAt for ordering.
  ipcMain.handle(IPC.setNormalFav, async (_e, kind: 'series' | 'chapter', key: string, fav: boolean) => {
    const field = kind === 'series' ? 'normalFavSeries' : 'normalFavChapters'
    const cur = store.settings[field] ?? []
    const next = fav ? [...new Set([...cur, key])] : cur.filter((x) => x !== key)
    const at = { ...(store.settings.normalFavAt ?? {}) }
    if (fav) at[key] = at[key] ?? Date.now()
    else delete at[key]
    return store.saveSettings({ ...store.settings, [field]: next, normalFavAt: at })
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
    const updated = store.update(workId, await setGroupFolder(w, groupIds, store.settings.groups))
    await store.flushWorks()
    return updated
  })

  // Rename a group: rename its folders on disk (see renameGroupFolders), move
  // every stored path under them, then save the new name.
  ipcMain.handle(IPC.renameGroup, async (_e, groupId: string, name: string) => {
    const g = store.settings.groups.find((x) => x.id === groupId)
    if (!g) throw new Error('그룹을 찾을 수 없습니다')
    const n = name.trim()
    if (!n) throw new Error('그룹 이름을 입력하세요')
    const mode = g.mode ?? 'hitomi'
    const key = safeName(n).toLowerCase()
    if (store.settings.groups.some((x) => x.id !== groupId && (x.mode ?? 'hitomi') === mode && safeName(x.name).toLowerCase() === key))
      throw new Error('같은 이름의 그룹이 이미 있습니다')
    const members = allWorks().filter((w) => (w.groups ?? []).includes(groupId))
    const moved = await renameGroupFolders(members, g.name, n)
    if (moved.size) {
      const remap = (p: string | null | undefined): string | null | undefined => {
        if (!p) return p
        for (const [from, to] of moved) {
          if (p === from) return to
          if (p.startsWith(from + sep)) return to + p.slice(from.length)
        }
        return p
      }
      for (const w of allWorks()) {
        const path = remap(w.path) as string
        const homePath = remap(w.homePath) ?? null
        if (path !== w.path || homePath !== w.homePath) store.update(w.id, { path, homePath })
      }
    }
    const settings = await store.saveSettings({
      ...store.settings,
      groups: store.settings.groups.map((x) => (x.id === groupId ? { ...x, name: n } : x))
    })
    await store.flushWorks()
    return { settings, works: allWorks() }
  })

  // Delete a group: move every member out of the group folder, strip the id
  // from those works, and remove the group from settings.
  ipcMain.handle(IPC.deleteGroup, async (_e, groupId: string) => {
    for (const w of allWorks()) {
      if (!(w.groups ?? []).includes(groupId)) continue
      try {
        store.update(w.id, await setGroupFolder(w, [], store.settings.groups))
      } catch {
        // Move failed — still drop the membership so state stays sane.
        store.update(w.id, { groups: (w.groups ?? []).filter((g) => g !== groupId) })
      }
    }
    const settings = await store.saveSettings({
      ...store.settings,
      groups: store.settings.groups.filter((g) => g.id !== groupId)
    })
    await store.flushWorks()
    return { settings, works: allWorks() }
  })

  // Manual tags. A tag prefixed "language:" / "artist:" sets that field instead
  // (shown like doujin works' language/artist — mainly for general-manga works).
  ipcMain.handle(IPC.addManualTag, (_e, workId: string, tag: string) => {
    const w = store.get(workId)!
    const raw = tag.trim()
    if (!raw) return w
    const low = raw.toLowerCase()
    if (low.startsWith('language:')) return store.update(workId, { language: raw.slice(9).trim() || null })
    if (low.startsWith('artist:')) return store.update(workId, { artist: raw.slice(7).trim() || null })
    return store.update(workId, { manualTags: [...new Set([...w.manualTags, low])] })
  })

  ipcMain.handle(IPC.removeManualTag, (_e, workId: string, tag: string) => {
    const w = store.get(workId)!
    return store.update(workId, { manualTags: w.manualTags.filter((t) => t !== tag) })
  })

  ipcMain.handle(IPC.incrementView, (_e, workId: string) => {
    const w = store.get(workId)!
    return store.update(workId, { viewCount: w.viewCount + 1, lastViewedAt: Date.now() })
  })

  // ---------- folders on disk ----------

  // Clipboard text for the renderer's 붙여넣기 menu (no permission prompt needed).
  ipcMain.handle(IPC.clipboardReadText, () => clipboard.readText())
  ipcMain.handle(IPC.clipboardWriteText, (_e, text: string) => clipboard.writeText(String(text ?? '')))

  ipcMain.handle(IPC.openInExplorer, (_e, workId: string) => {
    const w = store.get(workId)
    if (w) shell.openPath(w.path)
  })

  ipcMain.handle(IPC.openFolder, (_e, path: string) => {
    if (path) shell.openPath(path)
  })

  ipcMain.handle(IPC.deleteWork, async (_e, workId: string) => {
    const w = store.get(workId)
    if (!w) return
    await fs.rm(w.path, { recursive: true, force: true })
    store.remove(workId)
  })

  // Merge general-manga works into one series folder, created under the deepest
  // normal-library root that contains the first work (so the scanner keeps
  // treating it as a normal-library series).
  ipcMain.handle(IPC.mergeSeries, async (_e, title: string, workIds: string[]) => {
    const works = workIds.map((id) => store.get(id)).filter(Boolean) as Work[]
    if (works.length < 2) return []
    const roots = normalRoots(store.settings)
    const rp = resolve(works[0].path)
    let root = ''
    for (const r of roots) {
      const rr = resolve(r)
      if ((rp === rr || rp.startsWith(rr + sep)) && rr.length > root.length) root = rr
    }
    if (!root) root = resolve(works[0].path, '..', '..') // fallback: grandparent
    const patches = await mergeSeries(works, title, root)
    const updated = Object.entries(patches).map(([id, patch]) => store.update(id, patch))
    await store.flushWorks()
    return updated
  })

  // Rename general-manga chapter folders in place. The renderer computes each
  // target name ("<n>화 <subtitle>"); here we just rename the folder within its
  // parent (skipping no-ops and collections) and update the stored path.
  ipcMain.handle(IPC.renameNormalChapters, async (_e, items: { id: string; name: string }[]) => {
    const clean = (s: string): string =>
      s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled'
    const updated: Work[] = []
    for (const it of items) {
      const w = store.get(it.id)
      if (!w || !w.path || (w.sources && w.sources.length)) continue // skip collections
      const parent = dirname(w.path)
      const target = clean(it.name)
      if (!target || basename(w.path) === target) continue
      // Avoid clobbering a different existing folder: "name (2)", "name (3)" …
      let dest = join(parent, target)
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

  // avif→webp conversion: list a work's avif files (with a loadable url)…
  ipcMain.handle(IPC.listAvifPaths, async (_e, workId: string) => {
    const w = store.works.get(workId)
    if (!w) return []
    const names = (await fs.readdir(w.path)).filter((f) => /\.avif$/i.test(f)).sort()
    return names.map((n) => {
      const p = join(w.path, n)
      return { path: p, url: encodeImg(p) }
    })
  })
  // …then write each renderer-encoded webp next to its avif and delete the avif.
  ipcMain.handle(IPC.replaceAvifWithWebp, async (_e, avifPath: string, webpBase64: string) => {
    const webpPath = avifPath.replace(/\.avif$/i, '.webp')
    await fs.writeFile(webpPath, Buffer.from(webpBase64, 'base64'))
    if (webpPath.toLowerCase() !== avifPath.toLowerCase()) await fs.rm(avifPath).catch(() => {})
  })

  // ---------- thumbnails ----------

  // Save a renderer-generated thumb (data: URL) and return its loadable url.
  ipcMain.handle(IPC.saveThumb, async (_e, workId: string, dataUrl: string) => {
    const file = thumbFile(workId)
    await fs.writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
    return encodeImg(file)
  })

  // Url of a work's cached thumb, or null if none yet. Versioned by mtime
  // (?v=…) so a regenerated cover busts the renderer's image cache; "#raw"
  // (never sent to the protocol) asks the renderer to shrink a full-size cover.
  ipcMain.handle(IPC.getThumb, async (_e, workId: string) => {
    const file = thumbFile(workId)
    try {
      const st = await fs.stat(file)
      const raw = await isRawThumb(file).catch(() => false)
      return encodeImg(file) + '?v=' + Math.floor(st.mtimeMs) + (raw ? '#raw' : '')
    } catch {
      return null
    }
  })

  // ---------- translation ----------

  // OCR + translate one page image (cloud engines).
  ipcMain.handle(IPC.translateImage, async (_e, imageBase64: string, langHint?: string, w?: number, h?: number) => {
    try {
      const buf = Buffer.from(imageBase64, 'base64')
      return await translateImage(buf, store.settings, langHint, w && h ? { w, h } : undefined)
    } catch (err: any) {
      return { ok: false, w: 0, h: 0, blocks: [], error: String(err?.message ?? err) }
    }
  })

  // Free engine: the renderer OCRs locally (Tesseract), main translates strings.
  ipcMain.handle(IPC.translateTexts, (_e, texts: string[], langHint?: string) =>
    translateTexts(texts, store.settings, langHint)
  )

  ipcMain.handle(IPC.getTransEdits, () => store.transEdits)
  ipcMain.handle(IPC.saveTransEdit, (_e, src: string, blocks: TransBlock[]) => store.saveTransEdit(src, blocks))

  // ---------- exports (settings · 내보내기 폴더) ----------

  const exportRoot = (): string => {
    const dir = store.settings.textExportDir
    if (!dir) throw new Error('내보낼 폴더가 설정되지 않았습니다. 설정에서 내보내기 폴더를 지정하세요.')
    return dir
  }
  const exportName = (title: string): string => (sanitize(title).trim() || 'export').slice(0, 150)

  // Write extracted text to <export dir>/<title>.txt (never overwrites).
  ipcMain.handle(IPC.exportText, async (_e, title: string, content: string) => {
    const dir = exportRoot()
    await fs.mkdir(dir, { recursive: true })
    const path = await freePath(dir, exportName(title), '.txt')
    await fs.writeFile(path, content, 'utf-8')
    return path
  })

  // Image export: create a fresh per-work folder; the renderer then streams each
  // translated page into it via writeImageFile.
  ipcMain.handle(IPC.exportImageDir, async (_e, title: string) => {
    const dir = await freePath(exportRoot(), exportName(title))
    await fs.mkdir(dir, { recursive: true })
    return dir
  })
  ipcMain.handle(IPC.writeImageFile, async (_e, dir: string, name: string, base64: string) => {
    await fs.writeFile(join(dir, name), Buffer.from(base64, 'base64'))
  })

  // ---------- session / exit / reset ----------

  ipcMain.handle(IPC.getSession, () => store.session)
  ipcMain.handle(IPC.saveSession, (_e, s: SessionState) => store.saveSession(s))

  // Exit modal decision: keep (persist tabs for next launch) / clear / cancel.
  ipcMain.handle(IPC.closeWindow, async (_e, decision: CloseDecision, sess?: SessionState) => {
    if (decision === 'cancel') return
    if (decision === 'keep') {
      if (sess) await store.saveSession(sess)
    } else {
      await store.saveSession({ tabs: [], activeTabId: null })
    }
    appState.closing = true
    getMainWindow()?.destroy()
  })

  // Full reset: wipe app data (settings/library/session/…) and relaunch into a
  // clean first-run state. With deleteWorkFolders, also delete every scanned
  // work's folder from disk.
  ipcMain.handle(IPC.resetApp, async (_e, deleteWorkFolders: boolean) => {
    if (deleteWorkFolders) {
      for (const w of store.works.values()) {
        // A locked/missing folder shouldn't abort the reset.
        await fs.rm(w.path, { recursive: true, force: true }).catch(() => {})
      }
    }
    const ud = app.getPath('userData')
    for (const f of ['works.json', 'settings.json', 'session.json', 'online.json', 'translationEdits.json', 'hitomi-suggest-seen.json', 'onlineSummaries.json']) {
      await fs.rm(join(ud, f), { force: true }).catch(() => {})
    }
    appState.quitting = true
    app.relaunch()
    app.exit(0)
  })
}
