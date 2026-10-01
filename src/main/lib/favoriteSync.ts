// The favorites model (hitomi library).
//
// ONE source of truth per work:
//   • works with a hitomi gallery code → the favorites list (store.onlineFavs,
//     keyed by code). Work.favorite of every local copy mirrors that entry, so
//     a heart set online, in the library, or by import is the same state.
//   • works without a code → Work.favorite itself (they can't be in the list).
// (General manga keeps its own in-app lists: settings.normalFavSeries /
// normalFavChapters, linked to online toki favorites by title in the renderer.)
//
// The favorites FOLDER is a side effect, not the truth: with
// settings.favoriteMoveToFolder, hearting moves the work folder into
// favoritesDir (remembering homePath) and unhearting moves it back. On scan, a
// work that newly appears inside favoritesDir is added to the favorites
// (manual drag-in still works), but leaving the folder never removes a heart.
import type { OnlineFav, Work } from '../../shared/types'
import { store } from '../context'
import { moveToFavorites, moveFromFavorites, isUnder } from './favorites'

// A numeric hitomi gallery code (toki favorites are keyed by url instead).
export const isGalleryCode = (code: string | null | undefined): code is string => !!code && /^\d+$/.test(code)

// Does the work belong in the favorites list (hitomi work with a gallery code)?
export const listKeyOf = (w: Work): string | null =>
  (w.library ?? 'hitomi') === 'hitomi' && isGalleryCode(w.code) ? w.code : null

const metaOf = (w: Work): Partial<OnlineFav> => ({
  title: w.title,
  artist: w.artist,
  language: w.language,
  pageCount: w.pageCount
})

// Apply a heart to one local work: flag + timestamp, and the folder move when
// enabled. Never touches the favorites list (callers do).
async function applyToWork(w: Work, fav: boolean): Promise<Work> {
  const s = store.settings
  const stamp = { favorite: fav, favoritedAt: fav ? (w.favoritedAt ?? Date.now()) : undefined }
  let patch: Partial<Work> = {}
  if ((w.library ?? 'hitomi') === 'hitomi' && s.favoriteMoveToFolder !== false && s.favoritesDir) {
    try {
      if (fav && !isUnder(w.path, s.favoritesDir)) patch = await moveToFavorites(w, s.favoritesDir, s.groups)
      else if (!fav && w.homePath) patch = await moveFromFavorites(w)
    } catch {
      /* folder busy/missing — the heart still changes, the folder stays put */
    }
  }
  return store.update(w.id, { ...patch, ...stamp })
}

// Heart / unheart a gallery by code: the list entry plus every local copy.
export async function setFavoriteByCode(
  code: string,
  fav: boolean,
  meta?: Partial<OnlineFav>
): Promise<{ fav: OnlineFav; works: Work[] }> {
  const locals = [...store.works.values()].filter((w) => listKeyOf(w) === code)
  const entry = store.setOnlineFav(code, { favorite: fav }, meta ?? (locals[0] ? metaOf(locals[0]) : undefined))
  const works: Work[] = []
  for (const w of locals) works.push(w.favorite === fav ? w : await applyToWork(w, fav))
  await store.flushWorks()
  return { fav: entry, works }
}

// Heart / unheart a local work (routes coded works through the list).
export async function setWorkFavorite(workId: string, fav: boolean): Promise<Work> {
  const w = store.get(workId)
  if (!w) throw new Error('no work')
  const key = listKeyOf(w)
  if (key) {
    const r = await setFavoriteByCode(key, fav, metaOf(w))
    return r.works.find((x) => x.id === workId) ?? store.get(workId)!
  }
  const updated = await applyToWork(w, fav)
  await store.flushWorks()
  return updated
}

// A freshly downloaded / registered work that is already a favorite gets the
// same folder placement a heart would give it.
export async function placeIfFavorite(w: Work): Promise<Work> {
  return w.favorite ? applyToWork({ ...w, favorite: false }, true) : w
}

// Favorite state of a scanned work, given its stored predecessor. Installed as
// Store.favoriteRule. `inFavDir` = the scan found it inside favoritesDir.
export function scannedFavorite(w: Work, prev: Work | undefined, inFavDir: boolean): boolean {
  const key = listKeyOf(w)
  const enteredFavDir = inFavDir && (!prev || !isUnder(prev.path, store.settings.favoritesDir))
  if (key) {
    const listed = !!store.onlineFavs.get(key)?.favorite
    if (!listed && enteredFavDir) store.setOnlineFav(key, { favorite: true }, metaOf(w))
    return listed || enteredFavDir
  }
  return (prev?.favorite ?? false) || enteredFavDir
}

// One-time migration to this model (settings.favoritesUnified):
//  • local hearts of coded works → favorites list (keeping when they were added),
//    and list hearts → local copies (flag only, no folder moves);
//  • favlist:<name> tags → favorite lists of codes;
//  • the removed general-manga favorites-folder setting is dropped.
export async function migrateFavorites(): Promise<void> {
  const s = store.settings as typeof store.settings & { favLists?: string[]; normalFavoritesDir?: string | null }
  if (s.favoritesUnified) return
  const lists = new Map((s.onlineFavLists ?? []).map((l) => [l.name, new Set(l.codes)]))
  for (const w of store.works.values()) {
    const key = listKeyOf(w)
    if (key && w.favorite && !store.onlineFavs.get(key)?.favorite) {
      store.setOnlineFav(key, { favorite: true, addedAt: w.favoritedAt ?? w.addedAt ?? Date.now() }, metaOf(w))
    } else if (key && !w.favorite && store.onlineFavs.get(key)?.favorite) {
      store.update(w.id, { favorite: true, favoritedAt: store.onlineFavs.get(key)!.addedAt })
    }
    const tags = (w.manualTags ?? []).filter((t) => t.startsWith('favlist:'))
    if (!tags.length) continue
    for (const t of tags) {
      const name = t.slice('favlist:'.length)
      if (key) (lists.get(name) ?? lists.set(name, new Set()).get(name)!).add(key)
    }
    store.update(w.id, { manualTags: w.manualTags.filter((t) => !t.startsWith('favlist:')) })
  }
  const next = { ...s, favoritesUnified: true }
  delete next.favLists
  delete next.normalFavoritesDir
  next.onlineFavLists = [...lists].map(([name, codes]) => ({ name, codes: [...codes] }))
  await store.flushWorks()
  await store.saveOnline()
  await store.saveSettings(next)
}
