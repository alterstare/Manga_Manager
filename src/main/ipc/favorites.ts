// IPC: favorites (doujin) — the hearts themselves, favorite files and lists.
//  • Hearts: setFavoriteByCode / setOnlineFav keep the favorites list and the
//    local copies in sync (lib/favoriteSync.ts). Manga-site (general-manga online)
//    favorites, keyed by url, also live in the list but have no local copy.
//  • Files: ONE favorites file format (Pupil-compatible JSON + our ranks) for
//    export / merge-import / merging several files.
//  • Lists: a file imported as a named list of codes (browse them online, or
//    the downloaded ones in the library).
import { ipcMain, dialog } from 'electron'
import { basename } from 'path'
import { promises as fs } from 'fs'
import type { OnlineFav } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import { store, sendToRenderer } from '../context'
import { parseIds, tagToEntry, parseFavoriteTags, listNameFromFile } from '../lib/favfile'
import { ensureSummaries } from '../lib/summaries'
import { isGalleryCode, setFavoriteByCode } from '../lib/favoriteSync'

const JSON_FILTER = [{ name: 'JSON', extensions: ['json'] }]

async function pickJson(title: string): Promise<string | null> {
  const r = await dialog.showOpenDialog({ title, properties: ['openFile'], filters: JSON_FILTER })
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
}

async function pickJsons(title: string): Promise<string[]> {
  const r = await dialog.showOpenDialog({ title, properties: ['openFile', 'multiSelections'], filters: JSON_FILTER })
  return r.canceled ? [] : r.filePaths
}

async function saveJsonAs(title: string, defaultPath: string): Promise<string | null> {
  const r = await dialog.showSaveDialog({ title, defaultPath, filters: JSON_FILTER })
  return r.canceled || !r.filePath ? null : r.filePath
}

const readJson = async (path: string): Promise<any> => JSON.parse(await fs.readFile(path, 'utf-8'))
const writeJson = (path: string, data: unknown): Promise<void> => fs.writeFile(path, JSON.stringify(data), 'utf-8')

// Rating of a gallery: the better of the list entry and any local copy.
function rankOf(code: string): number {
  let r = store.onlineFavs.get(code)?.rank ?? 0
  for (const w of store.works.values()) if (w.code === code) r = Math.max(r, w.rank)
  return r
}

export function registerFavoritesIpc(): void {
  // ---------- hearts ----------

  ipcMain.handle(IPC.getOnlineFavs, () => [...store.onlineFavs.values()])
  // General-manga last-read chapters (이어보기 / last-read mark).
  ipcMain.handle(IPC.getReadProgress, () => store.readProgress)
  ipcMain.handle(IPC.markRead, (_e, key: string) => store.markRead(key))

  ipcMain.handle(IPC.setFavoriteByCode, (_e, code: string, fav: boolean, meta?: Partial<OnlineFav>) =>
    setFavoriteByCode(code, fav, meta)
  )

  // Rank (and heart, for manga-site urls). A heart change on a gallery code is routed
  // through setFavoriteByCode so local copies follow.
  ipcMain.handle(
    IPC.setOnlineFav,
    async (_e, code: string, patch: { favorite?: boolean; rank?: number }, meta?: Partial<OnlineFav>) => {
      if (patch.favorite !== undefined && isGalleryCode(code)) {
        await setFavoriteByCode(code, patch.favorite, meta)
        if (patch.rank === undefined) return store.onlineFavs.get(code) ?? store.setOnlineFav(code, {}, meta)
        return store.setOnlineFav(code, { rank: patch.rank }, meta)
      }
      return store.setOnlineFav(code, patch, meta)
    }
  )

  // ---------- favorites file ----------

  // Every favorited gallery code (+ favorite tags + ranks) in Pupil's shape;
  // `ranks` is our own extension that Pupil ignores. Uncoded local favorites
  // can't be represented.
  ipcMain.handle(IPC.exportFavorites, async () => {
    const codes = [...store.onlineFavs.values()].filter((f) => f.favorite && isGalleryCode(f.code)).map((f) => f.code)
    const ranks: Record<string, number> = {}
    for (const c of codes) if (rankOf(c) > 0) ranks[c] = rankOf(c)
    const path = await saveJsonAs('즐겨찾기 내보내기', 'favorites.json')
    if (!path) return { ok: false, count: 0 }
    await writeJson(path, {
      favorites: codes.map(Number),
      favorite_tags: store.settings.favoriteTags.map(tagToEntry),
      ranks
    })
    return { ok: true, count: codes.length, path }
  })

  // Merge a file into the favorites (never unhearts): every code is hearted —
  // downloaded copies follow, moved into the favorites folder per the setting —
  // ranks are adopted, and favorite tags are unioned into settings.
  ipcMain.handle(IPC.importFavorites, async () => {
    const file = await pickJson('즐겨찾기 불러오기 (병합)')
    if (!file) return { ok: false, matched: 0, total: 0 }
    let raw: any
    try {
      raw = await readJson(file)
    } catch {
      return { ok: false, matched: 0, total: 0 }
    }
    const ids = parseIds(raw)
    const ranks: Record<string, unknown> = raw?.ranks ?? {}
    let matched = 0
    for (const id of ids) {
      const { works } = await setFavoriteByCode(id, true)
      if (works.length) matched++
      const r = Number(ranks[id]) || 0
      if (r > 0) store.setOnlineFav(id, { rank: r })
    }
    const tags = parseFavoriteTags(raw)
    if (tags.length) {
      await store.saveSettings({ ...store.settings, favoriteTags: [...new Set([...store.settings.favoriteTags, ...tags])] })
    }
    await store.saveOnline()
    return { ok: true, matched, total: ids.length }
  })

  // Merge several favorite files into one new file (union of ids, tags, ranks
  // — the higher rank wins). Standalone: does not touch the favorites.
  ipcMain.handle(IPC.mergeFavorites, async () => {
    const files = await pickJsons('병합할 즐겨찾기 파일 선택 (2개 이상)')
    if (!files.length) return { ok: false, count: 0, files: 0 }
    const union = new Set<string>()
    const tagUnion = new Set<string>()
    const ranks: Record<string, number> = {}
    for (const fp of files) {
      try {
        const raw = await readJson(fp)
        for (const id of parseIds(raw)) union.add(id)
        for (const t of parseFavoriteTags(raw)) tagUnion.add(t)
        for (const [k, v] of Object.entries(raw?.ranks ?? {})) ranks[k] = Math.max(ranks[k] ?? 0, Number(v) || 0)
      } catch {
        /* skip unreadable file */
      }
    }
    const path = await saveJsonAs('병합 결과 저장', 'favorites-merged.json')
    if (!path) return { ok: false, count: union.size, files: files.length }
    const ids = [...union].map(Number).filter(Number.isFinite)
    await writeJson(path, { favorites: ids, favorite_tags: [...tagUnion].map(tagToEntry), ranks })
    return { ok: true, count: ids.length, files: files.length, path }
  })

  // ---------- favorite lists ----------

  // Import a file as a named list of codes (replacing a same-named list).
  ipcMain.handle(IPC.importOnlineFavList, async () => {
    const file = await pickJson('즐겨찾기 목록 추가 (파일명이 목록 이름)')
    if (!file) return { ok: false, name: '', total: 0 }
    const name = listNameFromFile(basename(file))
    let codes: string[] = []
    try {
      codes = parseIds(await readJson(file))
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

  // Gallery summaries for `codes` (renders favorites / lists). Served from the
  // on-disk cache; only uncached codes are fetched.
  ipcMain.handle(IPC.hitomiSummaries, async (_e, codes: string[]) => {
    const cache = await ensureSummaries(codes)
    return codes.map((c) => cache[c]).filter(Boolean)
  })

  // Cache every list's summaries in one go so viewing a list later is instant.
  // Returns how many of the total codes are now cached.
  ipcMain.handle(IPC.preloadOnlineFavLists, async () => {
    const codes = [...new Set((store.settings.onlineFavLists ?? []).flatMap((l) => l.codes))]
    const cache = await ensureSummaries(codes, (done, total) =>
      sendToRenderer(IPC.onlineFavPreloadProgress, { done, total })
    )
    return { ok: true, total: codes.length, cached: codes.filter((c) => cache[c]).length }
  })
}
