import { app } from 'electron'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { Work, Settings, SessionState, OnlineFav } from '../../shared/types'
import type { TransBlock } from '../../shared/ipc'
import { DEFAULT_SETTINGS } from '../../shared/types'

// Plain-JSON persistence. Metadata for a few thousand works fits comfortably in
// memory; searching/sorting happens in JS. Avoids native sqlite build pain on
// Windows + Electron. Files live in the app's userData dir.

// Stable id for a work. Coded works key on the globally-unique hitomi id.
// Uncoded works hash a basis string: callers pass `uniqueKey` (the full path)
// for general manga, because chapter folder names repeat across series
// ("0001 1 - - 1화", "1화") and a name-only hash collides → one chapter silently
// overwrites another. Hitomi uncoded works pass no uniqueKey so they keep the
// folder-name hash (gallery names are unique, and the id survives a move).
export function deriveId(folderName: string, code: string | null, uniqueKey?: string): string {
  if (code) return `h:${code}`
  const h = createHash('sha1').update((uniqueKey ?? folderName).toLowerCase()).digest('hex').slice(0, 16)
  return `u:${h}`
}

interface PersistShape {
  works: Work[]
}

export class Store {
  private dir: string
  private worksFile: string
  private settingsFile: string
  private sessionFile: string
  private onlineFile: string
  private transEditsFile: string

  works = new Map<string, Work>()
  settings: Settings = { ...DEFAULT_SETTINGS }
  session: SessionState = { tabs: [], activeTabId: null }
  onlineFavs = new Map<string, OnlineFav>()
  transEdits: Record<string, TransBlock[]> = {}

  private saveTimer: NodeJS.Timeout | null = null

  constructor() {
    this.dir = app.getPath('userData')
    this.worksFile = join(this.dir, 'works.json')
    this.settingsFile = join(this.dir, 'settings.json')
    this.sessionFile = join(this.dir, 'session.json')
    this.onlineFile = join(this.dir, 'online.json')
    this.transEditsFile = join(this.dir, 'translationEdits.json')
  }

  async load(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await readJson(this.settingsFile, {})) }
    // Migrate the old (wrong-host) Papago endpoint to the correct one.
    if (!this.settings.papagoImageEndpoint || /naveropenapi\.apigw\.ntruss\.com\/image-to-image/.test(this.settings.papagoImageEndpoint)) {
      this.settings.papagoImageEndpoint = DEFAULT_SETTINGS.papagoImageEndpoint
    }
    this.session = await readJson(this.sessionFile, { tabs: [], activeTabId: null })
    const data = await readJson<PersistShape>(this.worksFile, { works: [] })
    this.works = new Map(data.works.map((w) => [w.id, w]))
    const ofavs = await readJson<{ favs: OnlineFav[] }>(this.onlineFile, { favs: [] })
    this.onlineFavs = new Map(ofavs.favs.map((f) => [f.code, f]))
    this.transEdits = await readJson<Record<string, TransBlock[]>>(this.transEditsFile, {})
  }

  // Persist one page's manually edited translation blocks (keyed by image src).
  // Empty block list removes the override so the page reverts to auto-translation.
  async saveTransEdit(src: string, blocks: TransBlock[]): Promise<void> {
    if (blocks.length) this.transEdits[src] = blocks
    else delete this.transEdits[src]
    await writeJson(this.transEditsFile, this.transEdits)
  }

  // Update favorite/rank for an online gallery; cache its display meta on first
  // touch. A fav that is un-favorited and unranked is dropped from the map.
  setOnlineFav(
    code: string,
    patch: { favorite?: boolean; rank?: number },
    meta?: Partial<OnlineFav>
  ): OnlineFav {
    const prev = this.onlineFavs.get(code)
    const next: OnlineFav = {
      code,
      favorite: prev?.favorite ?? false,
      rank: prev?.rank ?? 0,
      title: prev?.title ?? meta?.title ?? code,
      artist: prev?.artist ?? meta?.artist ?? null,
      language: prev?.language ?? meta?.language ?? null,
      pageCount: prev?.pageCount ?? meta?.pageCount ?? 0,
      thumbUrl: prev?.thumbUrl ?? meta?.thumbUrl ?? null,
      addedAt: prev?.addedAt ?? Date.now(),
      ...patch
    }
    // Refresh cached meta if newer info arrived.
    if (meta?.title) next.title = meta.title
    if (meta?.artist !== undefined) next.artist = meta.artist
    if (meta?.thumbUrl) next.thumbUrl = meta.thumbUrl
    if (meta?.language !== undefined) next.language = meta.language
    if (meta?.pageCount) next.pageCount = meta.pageCount

    if (!next.favorite && next.rank === 0) this.onlineFavs.delete(code)
    else this.onlineFavs.set(code, next)
    void this.saveOnline()
    return next
  }

  async saveOnline(): Promise<void> {
    await writeJson(this.onlineFile, { favs: [...this.onlineFavs.values()] })
  }

  // Reconcile a freshly-scanned work with the stored one. User state (rank,
  // counts, manual tags) is preserved; favorite/group membership follows the
  // folder LOCATION when a favorites dir is configured (feature 8) so manual
  // folder moves are recognized, otherwise the stored flags are kept.
  private reconcile(w: Work, prev: Work | undefined): Work {
    if (!prev) return w
    // Location authority follows the relevant favorites dir per library, so a
    // general-manga work isn't reset just because a hitomi favorites dir exists.
    const locAuth =
      (w.library ?? 'hitomi') === 'normal'
        ? !!this.settings.normalFavoritesDir
        : !!this.settings.favoritesDir
    return {
      ...w,
      tags: w.tags,
      manualTags: prev.manualTags,
      library: w.library ?? prev.library, // location-derived; prefer fresh scan
      favorite: locAuth ? w.favorite : prev.favorite,
      groups: locAuth ? w.groups : prev.groups,
      homePath: locAuth ? w.homePath : prev.homePath,
      rank: prev.rank,
      viewCount: prev.viewCount,
      lastViewedAt: prev.lastViewedAt,
      addedAt: prev.addedAt,
      coverHash: prev.coverHash,
      coverW: prev.coverW,
      coverH: prev.coverH
    }
  }

  // Full scan: replaces the set entirely (works no longer found are dropped).
  mergeScan(scanned: Work[]): Work[] {
    const next = new Map<string, Work>()
    for (const w of scanned) next.set(w.id, this.reconcile(w, this.works.get(w.id)))
    this.works = next
    this.scheduleSaveWorks()
    return [...this.works.values()]
  }

  // Partial scan (one folder): update/add the scanned works, keep the rest.
  mergeScanPartial(scanned: Work[]): Work[] {
    for (const w of scanned) this.works.set(w.id, this.reconcile(w, this.works.get(w.id)))
    this.scheduleSaveWorks()
    return [...this.works.values()]
  }

  get(id: string): Work | undefined {
    return this.works.get(id)
  }

  update(id: string, patch: Partial<Work>): Work {
    const w = this.works.get(id)
    if (!w) throw new Error(`work not found: ${id}`)
    const merged = { ...w, ...patch }
    this.works.set(id, merged)
    this.scheduleSaveWorks()
    return merged
  }

  remove(id: string): void {
    this.works.delete(id)
    this.scheduleSaveWorks()
  }

  async saveSettings(s: Settings): Promise<Settings> {
    this.settings = s
    await writeJson(this.settingsFile, s)
    return s
  }

  async saveSession(s: SessionState): Promise<void> {
    this.session = s
    await writeJson(this.sessionFile, s)
  }

  private scheduleSaveWorks(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flushWorks(), 400)
  }

  async flushWorks(): Promise<void> {
    const data: PersistShape = { works: [...this.works.values()] }
    await writeJson(this.worksFile, data)
  }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(data), 'utf-8')
  await fs.rename(tmp, file)
}
