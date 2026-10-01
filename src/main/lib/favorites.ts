import { promises as fs } from 'fs'
import { join, basename, dirname, resolve, sep } from 'path'
import type { Work, WorkGroup } from '../../shared/types'

// Sanitize a group name for use as a folder name (strip illegal chars).
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+$/g, '').trim() || 'group'
}

async function rmdirIfEmpty(dir: string): Promise<void> {
  try {
    const items = await fs.readdir(dir)
    if (items.length === 0) await fs.rmdir(dir)
  } catch {
    /* ignore */
  }
}

// Is `path` the folder `dir` or inside it?
export function isUnder(path: string, dir: string | null | undefined): boolean {
  if (!dir) return false
  const d = resolve(dir)
  const p = resolve(path)
  return p === d || p.startsWith(d + sep)
}

// With favoriteMoveToFolder, a heart physically moves the work folder into the
// favorites dir; homePath remembers where it came from so unhearting can move
// it back (see favoriteSync.ts).

export async function moveDir(src: string, dest: string): Promise<void> {
  if (src === dest) return
  await fs.mkdir(join(dest, '..'), { recursive: true })
  try {
    await fs.rename(src, dest)
  } catch (err: any) {
    // Cross-volume rename fails with EXDEV; fall back to copy + remove.
    if (err.code === 'EXDEV') {
      await fs.cp(src, dest, { recursive: true })
      await fs.rm(src, { recursive: true, force: true })
    } else {
      throw err
    }
  }
}

async function uniqueDest(dir: string, name: string): Promise<string> {
  let dest = join(dir, name)
  let i = 2
  // Avoid clobbering an existing folder of the same name.
  while (await exists(dest)) {
    dest = join(dir, `${name} (${i++})`)
  }
  return dest
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function moveToFavorites(
  work: Work,
  favoritesDir: string,
  groups: WorkGroup[] = []
): Promise<Partial<Work>> {
  const name = basename(work.path)
  // Nest under the work's group folder if it belongs to one (feature 6):
  // favorites/<group>/<work>.
  const gid = (work.groups ?? [])[0]
  const gname = gid ? groups.find((g) => g.id === gid)?.name : null
  const parent = gname ? join(favoritesDir, safeName(gname)) : favoritesDir
  await fs.mkdir(parent, { recursive: true })
  const dest = await uniqueDest(parent, name)
  await moveDir(work.path, dest)
  return { favorite: true, homePath: work.homePath ?? work.path, path: dest }
}

// Move a work's folder to reflect a (single) group membership change.
// Groups nest one level under the work's current base folder:
//   <base>/<group name>/<work folder>
// Switching groups pops out of the old group folder first; leaving a group
// moves the folder back up to the base. Returns the metadata + path patch.
export async function setGroupFolder(
  work: Work,
  newGroupIds: string[],
  groups: WorkGroup[]
): Promise<Partial<Work>> {
  const oldId = (work.groups ?? [])[0] ?? null
  const newId = newGroupIds[0] ?? null
  if (oldId === newId) return { groups: newId ? [newId] : [] }

  const oldFolder = dirname(work.path) // may be the old group folder
  // Base = the parent without any current group nesting.
  const base = oldId ? dirname(oldFolder) : oldFolder
  const g = newId ? groups.find((x) => x.id === newId) : null
  const destParent = g ? join(base, safeName(g.name)) : base
  await fs.mkdir(destParent, { recursive: true })
  const dest = await uniqueDest(destParent, basename(work.path))
  await moveDir(work.path, dest)
  if (oldId) await rmdirIfEmpty(oldFolder) // clean up the emptied group folder
  return { groups: newId ? [newId] : [], path: dest }
}

// Merge several general-manga works into one series folder: move each work
// folder into <root>/<title> so the scanner's "parent folder = series" rule
// groups them as one series. Returns id -> path patch for each moved work.
export async function mergeSeries(
  works: Work[],
  title: string,
  root: string
): Promise<Record<string, Partial<Work>>> {
  const destParent = join(root, safeName(title))
  await fs.mkdir(destParent, { recursive: true })
  const patches: Record<string, Partial<Work>> = {}
  const oldParents = new Set<string>()
  for (const w of works) {
    oldParents.add(dirname(w.path))
    if (dirname(w.path) === destParent) {
      patches[w.id] = {} // already in the series folder
      continue
    }
    const dest = await uniqueDest(destParent, basename(w.path))
    await moveDir(w.path, dest)
    patches[w.id] = { path: dest, library: 'normal' }
  }
  // Clean up any folders we emptied (but never the new series folder).
  for (const p of oldParents) if (p !== destParent) await rmdirIfEmpty(p)
  return patches
}

// Move a work's folder into an arbitrary destination directory (used to sweep
// hitomi-deleted works aside). Cleans up the emptied source parent if possible.
export async function moveWorkToFolder(work: Work, destDir: string): Promise<Partial<Work>> {
  await fs.mkdir(destDir, { recursive: true })
  const dest = await uniqueDest(destDir, basename(work.path))
  const oldParent = dirname(work.path)
  await moveDir(work.path, dest)
  await rmdirIfEmpty(oldParent)
  return { path: dest }
}

export async function moveFromFavorites(work: Work): Promise<Partial<Work>> {
  if (!work.homePath) return { favorite: false }
  const dest = (await exists(work.homePath))
    ? await uniqueDest(join(work.homePath, '..'), basename(work.homePath))
    : work.homePath
  await moveDir(work.path, dest)
  return { favorite: false, homePath: null, path: dest }
}
