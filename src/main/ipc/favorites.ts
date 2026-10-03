// IPC: favorites (doujin) — the hearts themselves, favorite files and lists.
//  • Hearts: setFavoriteByCode / setOnlineFav keep the favorites list and the
//    local copies in sync (lib/favoriteSync.ts). Manga-site (general-manga online)
//    favorites, keyed by url, also live in the list but have no local copy.
//  • Files: ONE favorites file format (Pupil-compatible JSON + our ranks) for
//    export / merge-import / merging several files.
//  • Lists: a file imported as a named list of codes (browse them online, or
//    the downloaded ones in the library).
import { ipcMain, dialog } from 'electron'
import { basename, dirname } from 'path'
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

// ---------- rating files ----------
// Ratings are exported per library mode — 동인지 and 일반 만화 never mix:
//   동인지:   { library: 'doujin', ratings: { doujin: {code: n}, local: {...} }, ranks: {code: n} }
//   일반 만화: { library: 'manga',  ratings: { online: {url: n}, local: {...} } }
// `ranks` repeats the doujin ratings at top level (same as the favorites file).
// Local works without a code are keyed by their last two path segments
// (series/chapter or group/work) so the file works on another PC too.
type Lib = 'hitomi' | 'normal'
type RatingFile = { doujin: Record<string, number>; online: Record<string, number>; local: Record<string, number> }
const localKey = (path: string): string => `${basename(dirname(path))}/${basename(path)}`.toLowerCase()
const libOf = (w: { library?: Lib }): Lib => w.library ?? 'hitomi'

function collectRatings(lib: Lib): RatingFile {
  const out: RatingFile = { doujin: {}, online: {}, local: {} }
  for (const f of store.onlineFavs.values()) {
    if (!(f.rank > 0)) continue
    if (lib === 'hitomi' && isGalleryCode(f.code)) out.doujin[f.code] = Math.max(out.doujin[f.code] ?? 0, f.rank)
    if (lib === 'normal' && !isGalleryCode(f.code)) out.online[f.code] = f.rank
  }
  for (const w of store.works.values()) {
    if (!(w.rank > 0) || libOf(w) !== lib) continue
    if (w.code && lib === 'hitomi') out.doujin[w.code] = Math.max(out.doujin[w.code] ?? 0, w.rank)
    else if (!w.code) out.local[localKey(w.path)] = w.rank
  }
  return out
}

function parseRatings(raw: any, lib: Lib): RatingFile {
  const r = raw?.ratings ?? {}
  const num = (o: any): Record<string, number> => {
    const m: Record<string, number> = {}
    for (const [k, v] of Object.entries(o ?? {})) {
      const n = Math.round(Number(v))
      if (n > 0) m[k] = Math.min(5, n)
    }
    return m
  }
  // A file from the other mode contributes nothing here.
  const fileLib: Lib | null = raw?.library === 'manga' ? 'normal' : raw?.library === 'doujin' ? 'hitomi' : null
  if (fileLib && fileLib !== lib) return { doujin: {}, online: {}, local: {} }
  return lib === 'hitomi'
    ? // Plain favorites files carry ranks at top level — accept them too.
      { doujin: { ...num(raw?.ranks), ...num(r.doujin) }, online: {}, local: num(r.local) }
    : { doujin: {}, online: num(r.online), local: num(r.local) }
}

const countRatings = (r: RatingFile): number =>
  Object.keys(r.doujin).length + Object.keys(r.online).length + Object.keys(r.local).length

const fileOf = (lib: Lib, r: RatingFile): unknown =>
  lib === 'hitomi'
    ? { library: 'doujin', ratings: { doujin: r.doujin, local: r.local }, ranks: r.doujin }
    : { library: 'manga', ratings: { online: r.online, local: r.local } }

export function registerFavoritesIpc(): void {
  ipcMain.handle(IPC.exportRatings, async (_e, lib: Lib) => {
    const ratings = collectRatings(lib)
    const path = await saveJsonAs('평점 내보내기', lib === 'hitomi' ? 'ratings-doujin.json' : 'ratings-manga.json')
    if (!path) return { ok: false, count: 0 }
    await writeJson(path, fileOf(lib, ratings))
    return { ok: true, count: countRatings(ratings), path }
  })

  // Apply a rating file: each rating in it is set (doujin codes on the list
  // entry and any local copy; online urls on the list entry; local works by
  // path key). Ratings not in the file are left alone.
  ipcMain.handle(IPC.importRatings, async (_e, lib: Lib) => {
    const file = await pickJson('평점 불러오기 (병합)')
    if (!file) return { ok: false, applied: 0, total: 0 }
    let r: RatingFile
    try {
      r = parseRatings(await readJson(file), lib)
    } catch {
      return { ok: false, applied: 0, total: 0 }
    }
    let applied = 0
    for (const [code, n] of Object.entries(r.doujin)) {
      store.setOnlineFav(code, { rank: n })
      applied++
      for (const w of store.works.values()) if (w.code === code) store.update(w.id, { rank: n })
    }
    for (const [url, n] of Object.entries(r.online)) {
      store.setOnlineFav(url, { rank: n })
      applied++
    }
    const byKey = new Map<string, string[]>()
    for (const w of store.works.values()) {
      if (w.code || libOf(w) !== lib) continue
      const k = localKey(w.path)
      byKey.set(k, [...(byKey.get(k) ?? []), w.id])
    }
    for (const [k, n] of Object.entries(r.local)) {
      const ids = byKey.get(k.toLowerCase())
      if (!ids) continue
      for (const id of ids) store.update(id, { rank: n })
      applied++
    }
    await store.saveOnline()
    await store.flushWorks()
    return { ok: true, applied, total: countRatings(r) }
  })

  // Merge several rating files into one new file (the higher rating wins).
  ipcMain.handle(IPC.mergeRatings, async (_e, lib: Lib) => {
    const files = await pickJsons('병합할 평점 파일 선택 (2개 이상)')
    if (!files.length) return { ok: false, count: 0, files: 0 }
    const out: RatingFile = { doujin: {}, online: {}, local: {} }
    for (const fp of files) {
      try {
        const r = parseRatings(await readJson(fp), lib)
        for (const part of ['doujin', 'online', 'local'] as const)
          for (const [k, v] of Object.entries(r[part])) out[part][k] = Math.max(out[part][k] ?? 0, v)
      } catch {
        /* skip unreadable file */
      }
    }
    const path = await saveJsonAs('병합 결과 저장', lib === 'hitomi' ? 'ratings-doujin-merged.json' : 'ratings-manga-merged.json')
    if (!path) return { ok: false, count: countRatings(out), files: files.length }
    await writeJson(path, fileOf(lib, out))
    return { ok: true, count: countRatings(out), files: files.length, path }
  })

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
