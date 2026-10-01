import { promises as fs } from 'fs'
import { join, basename, dirname } from 'path'
import type { Work, Settings } from '../../shared/types'
import { langCategory, type LangCat } from '../../shared/lang'
import { moveDir } from './favorites'

// Language-based auto move (feature 5/1). Korean is the default language and
// stays put. Works whose language is known and not Korean get moved into the
// configured folder for English / Japanese / 기타(other). Works with no known
// language (not enriched yet) and favorited works (already relocated to the
// favorites dir) are left alone.

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function uniqueDest(dir: string, name: string): Promise<string> {
  let dest = join(dir, name)
  let i = 2
  while (await exists(dest)) dest = join(dir, `${name} (${i++})`)
  return dest
}

export async function organizeByLanguage(
  works: Work[],
  settings: Settings,
  onMove?: (movedCount: number, title: string) => void
): Promise<{ id: string; path: string }[]> {
  const targets: Record<Exclude<LangCat, 'korean'>, string | null> = {
    english: settings.langDirs.english,
    japanese: settings.langDirs.japanese,
    other: settings.langDirs.other
  }
  const moved: { id: string; path: string }[] = []
  for (const w of works) {
    if (w.favorite) continue
    const cat = langCategory(w.language)
    if (!cat || cat === 'korean') continue
    const targetDir = targets[cat]
    if (!targetDir) continue
    if (dirname(w.path) === targetDir) continue // already in the right place
    await fs.mkdir(targetDir, { recursive: true })
    const dest = await uniqueDest(targetDir, basename(w.path))
    await moveDir(w.path, dest)
    moved.push({ id: w.id, path: dest })
    onMove?.(moved.length, w.title)
  }
  return moved
}
