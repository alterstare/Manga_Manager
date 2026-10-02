import { promises as fs } from 'fs'
import { join, basename, dirname, extname, resolve, sep } from 'path'
import type { Work, Settings } from '../../shared/types'
import { IMAGE_EXTS } from '../../shared/types'
import { parseName } from './parser'
import { deriveId } from './store'
import { readSidecar } from './hitomi'

export interface ScanCallbacks {
  onProgress?: (scanned: number, current: string) => void
}

// All folders treated as library roots: the explicit libraryRoots plus the
// favorites / download / language folders the user configured elsewhere, so
// works moved into those locations are still picked up without adding them by
// hand (feature: auto-include configured folders).
export function effectiveRoots(settings: Settings): string[] {
  const roots = new Set<string>()
  for (const r of settings.libraryRoots) if (r) roots.add(r)
  if (settings.favoritesDir) roots.add(settings.favoritesDir)
  if (settings.downloadDir) roots.add(settings.downloadDir)
  for (const d of [settings.langDirs.english, settings.langDirs.japanese, settings.langDirs.other])
    if (d) roots.add(d)
  return [...roots]
}

// Roots that make up the general-manga ("normal") library.
export function normalRoots(settings: Settings): string[] {
  const roots = new Set<string>()
  for (const r of settings.normalRoots ?? []) if (r) roots.add(r)
  if (settings.normalDownloadDir) roots.add(settings.normalDownloadDir)
  return [...roots]
}

// "Artist folder" roots: each immediate child folder NAMES an artist; every work
// found beneath that child is stamped with that artist (folders are not merged).
export function flattenRoots(settings: Settings): string[] {
  return (settings.flattenRoots ?? []).filter(Boolean)
}
function isFlattenRoot(dir: string, settings: Settings): boolean {
  const d = resolve(dir)
  return flattenRoots(settings).some((r) => resolve(r) === d)
}

// Which library a given root path belongs to (normal if it's a configured
// normal root, else doujin). Used by the per-folder rescan.
export function libraryOfRoot(root: string, settings: Settings): 'hitomi' | 'normal' {
  const r = resolve(root)
  return normalRoots(settings).some((n) => resolve(n) === r) ? 'normal' : 'hitomi'
}

// Walk each library root and collect "work folders" = any directory that
// directly contains image files. Cover/page ordering is natural-sorted.
export async function scanLibrary(settings: Settings, cb: ScanCallbacks = {}): Promise<Work[]> {
  const works: Work[] = []
  let scanned = 0
  const visited = new Set<string>() // avoid re-walking nested/overlapping roots

  // Normal roots first so they win library stamping on any overlap.
  for (const root of normalRoots(settings)) await walk(root, 'normal')
  // Artist-folder roots: walk normally, but each immediate child folder names the
  // artist stamped onto every work beneath it.
  for (const root of flattenRoots(settings)) await walk(root, 'hitomi')
  for (const root of effectiveRoots(settings)) await walk(root, 'hitomi')

  return applyCollections(works, settings)

  async function walk(
    dir: string,
    library: 'hitomi' | 'normal',
    artist: string | null = null
  ): Promise<void> {
    const key = resolve(dir)
    if (visited.has(key)) return
    visited.add(key)
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    // Artist-folder root: each immediate child folder names the artist for every
    // work found beneath it. Recurse with that name as the artist override.
    if (isFlattenRoot(dir, settings)) {
      for (const child of entries.filter((e) => e.isDirectory()))
        await walk(join(dir, child.name), library, child.name)
      return
    }

    const images = entries.filter((e) => e.isFile() && isImage(e.name))
    const subdirs = entries.filter((e) => e.isDirectory())

    if (images.length > 0) {
      const work = await makeWork(dir, images.length, settings, library, artist)
      works.push(work)
      scanned++
      cb.onProgress?.(scanned, work.title)
    }

    // Recurse into subdirectories (language folders, nested collections). The
    // artist override, if any, carries down to every work beneath.
    for (const sub of subdirs) {
      await walk(join(dir, sub.name), library, artist)
    }
  }
}

// Scan a single root folder (used by the per-folder "갱신" buttons). Walks just
// this subtree and returns the works found, with favorite/group inferred from
// their location (feature 8).
export async function scanRoot(
  root: string,
  settings: Settings,
  library: 'hitomi' | 'normal' = libraryOfRoot(root, settings)
): Promise<Work[]> {
  const works: Work[] = []
  const visited = new Set<string>()
  const walk = async (dir: string, artist: string | null = null): Promise<void> => {
    const key = resolve(dir)
    if (visited.has(key)) return
    visited.add(key)
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    // Artist-folder root: each immediate child folder names the artist for the
    // works beneath it.
    if (isFlattenRoot(dir, settings)) {
      for (const child of entries.filter((e) => e.isDirectory()))
        await walk(join(dir, child.name), child.name)
      return
    }
    const images = entries.filter((e) => e.isFile() && isImage(e.name))
    if (images.length > 0) works.push(await makeWork(dir, images.length, settings, library, artist))
    for (const sub of entries.filter((e) => e.isDirectory())) await walk(join(dir, sub.name), artist)
  }
  await walk(root)
  return applyCollections(works, settings)
}

// Fold "collection" works out of a scanned work list. Two sources:
//  1. auto: under an artist folder (flattenRoots), work folders with pageCount
//     <= flattenCollectThreshold are merged into one "<artist> collection".
//  2. manual: settings.manualCollections merges the exact folders the user picked.
// A collection Work carries `sources` (the folder paths) instead of a single
// path; getWorkImages concatenates their images.
function applyCollections(works: Work[], settings: Settings): Work[] {
  const threshold = settings.flattenCollectThreshold ?? 0
  const roots = flattenRoots(settings).map((r) => resolve(r))
  const manual = settings.manualCollections ?? []
  const manualByDir = new Map<string, number>()
  manual.forEach((c, i) => c.dirs.forEach((d) => manualByDir.set(resolve(d), i)))

  const out: Work[] = []
  const autoGroups = new Map<string, Work[]>() // artistFolder -> small works
  const manualGroups = new Map<number, Work[]>()

  for (const w of works) {
    const rp = resolve(w.path)
    const mi = manualByDir.get(rp)
    if (mi !== undefined) {
      const arr = manualGroups.get(mi) ?? []
      arr.push(w)
      manualGroups.set(mi, arr)
      continue
    }
    if (threshold > 0 && roots.length) {
      const af = artistFolderOf(rp, roots)
      // Don't collapse the artist folder itself (images sitting directly in it).
      if (af && af !== rp && w.pageCount <= threshold) {
        const arr = autoGroups.get(af) ?? []
        arr.push(w)
        autoGroups.set(af, arr)
        continue
      }
    }
    out.push(w)
  }

  for (const [af, group] of autoGroups) {
    // A lone small folder isn't a "collection" — leave it as its own work.
    if (group.length < 2) {
      out.push(...group)
      continue
    }
    const name = basename(af)
    out.push(makeCollection(af, af, `${name} collection`, name, group, group[0].library ?? 'hitomi'))
  }
  for (const [i, group] of manualGroups) {
    if (!group.length) continue
    const c = manual[i]
    const first = [...c.dirs].sort(naturalCompare)[0]
    out.push(makeCollection(first, dirname(first), c.title, c.artist, group, c.library))
  }
  return out
}

// The immediate child of a flatten root that contains `p` (the "artist folder"),
// or null if `p` isn't under any flatten root. Inputs are already resolved.
function artistFolderOf(p: string, roots: string[]): string | null {
  for (const r of roots) {
    if (p === r) continue
    if (p.startsWith(r + sep)) return join(r, p.slice(r.length + 1).split(sep)[0])
  }
  return null
}

// Build a collection Work whose pages are the concatenated images of `group`'s
// folders. `idBasis` keys a stable id; `path` is used for "open folder".
function makeCollection(
  idBasis: string,
  path: string,
  title: string,
  artist: string | null,
  group: Work[],
  library: 'hitomi' | 'normal'
): Work {
  const sources = [...group.map((w) => w.path)].sort(naturalCompare)
  const pageCount = group.reduce((n, w) => n + w.pageCount, 0)
  const id = deriveId(`${basename(idBasis)}::collection`, null, resolve(idBasis) + '#collection')
  return {
    id,
    path,
    title,
    artist,
    code: null,
    language: null,
    pageCount,
    tags: [],
    manualTags: [],
    favorite: group.some((w) => w.favorite),
    groups: [...new Set(group.flatMap((w) => w.groups ?? []))],
    homePath: null,
    rank: 0,
    viewCount: 0,
    lastViewedAt: null,
    addedAt: Date.now(),
    mtime: Math.max(0, ...group.map((w) => w.mtime)),
    source: 'local',
    library,
    sources
  }
}

// Build a Work for a single already-known folder (e.g. right after download).
export async function scanOne(
  dir: string,
  settings: Settings,
  library: 'hitomi' | 'normal' = 'hitomi'
): Promise<Work | null> {
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const images = entries.filter((e) => e.isFile() && isImage(e.name))
  if (!images.length) return null
  return makeWork(dir, images.length, settings, library)
}

async function makeWork(
  dir: string,
  pageCount: number,
  settings: Settings,
  library: 'hitomi' | 'normal' = 'hitomi',
  artistOverride: string | null = null
): Promise<Work> {
  const folderName = basename(dir)
  // Only doujin folders carry gallery ids; skip id detection for normal manga so
  // chapter numbers never look like codes.
  const parsed = library === 'hitomi' ? parseName(folderName, settings.hitomiNamePatterns) : { artist: null, code: null, title: folderName.replace(/\s+/g, ' ').trim() }
  // General-manga chapter folders reuse names across series, so key their id on
  // the full path to avoid id collisions (which drop chapters).
  const id = deriveId(folderName, parsed.code, library === 'normal' ? resolve(dir) : undefined)
  let mtime = Date.now()
  try {
    mtime = (await fs.stat(dir)).mtimeMs
  } catch {
    /* keep default */
  }

  // Sidecar (meta.hitomi.json) carries doujin metadata so it survives rescans.
  const meta = await readSidecar(dir)
  const tags = [...new Set([...applyGenreRules(dir, settings), ...(meta?.tags ?? [])])]

  return {
    id,
    path: dir,
    title: parsed.title,
    // Artist-folder roots override the artist with the folder name; otherwise use
    // the parsed / doujin-metadata artist.
    artist: artistOverride ?? parsed.artist ?? (meta?.artists.length ? meta.artists.join(', ') : null),
    code: parsed.code ?? meta?.code ?? null,
    language: meta?.language ?? null,
    pageCount,
    tags,
    manualTags: [],
    // Location signals, resolved by Store.reconcile: favorite=true here means
    // "found inside the favorites folder" (the heart itself comes from the
    // favorites list — see favoriteSync.ts); groups follow group folders.
    favorite: underFavorites(dir, settings, library),
    groups: groupFolderMatch(dir, settings, library),
    homePath: null,
    rank: 0,
    viewCount: 0,
    lastViewedAt: null,
    addedAt: Date.now(),
    mtime,
    source: 'local',
    library
  }
}

// Folder-name sanitizer mirroring favorites.ts, so a work sitting in
// <base>/<group name>/<work> is matched back to its group.
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+$/g, '').trim() || 'group'
}

// Inside the doujin favorites folder? (General manga has no favorites folder.)
function underFavorites(dir: string, settings: Settings, library: 'hitomi' | 'normal'): boolean {
  const favDir = library === 'normal' ? null : settings.favoritesDir
  if (!favDir) return false
  const fav = resolve(favDir)
  const d = resolve(dir)
  return d === fav || d.startsWith(fav + sep)
}

// If the work's immediate parent folder is named after a group, return that
// group's id (e.g. favorites/<group>/<work> or libRoot/<group>/<work>).
function groupFolderMatch(dir: string, settings: Settings, library: 'hitomi' | 'normal'): string[] {
  const parent = basename(dirname(dir)).toLowerCase()
  const g = settings.groups.find(
    (gr) => (gr.mode ?? 'hitomi') === library && safeName(gr.name).toLowerCase() === parent
  )
  return g ? [g.id] : []
}

// Auto-fill tags when a rule keyword appears anywhere in the folder path.
function applyGenreRules(path: string, settings: Settings): string[] {
  const lower = path.toLowerCase()
  const out = new Set<string>()
  for (const rule of settings.genreRules) {
    if (rule.keywords.some((k) => k && lower.includes(k.toLowerCase()))) {
      out.add(rule.genre)
    }
  }
  return [...out]
}

function isImage(name: string): boolean {
  return IMAGE_EXTS.includes(extname(name).toLowerCase())
}

// Natural sort so 2 < 10. Returns absolute image file paths in page order.
export async function listImages(dir: string, excludeLeading = 0): Promise<string[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const imgs = entries.filter(isImage).sort(naturalCompare)
  return imgs.slice(excludeLeading).map((n) => join(dir, n))
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}
