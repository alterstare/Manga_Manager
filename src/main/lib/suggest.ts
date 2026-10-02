import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

// Autocomplete backend for the online search box. Two sources are merged:
//   1. A bundled snapshot of every doujin tag (resources/hitomi-tokens.json,
//      `{ "artist:foo": count, "character:bar": count, "series:…", "tag:…" }`),
//      so the full artist/character/series/tag list is searchable offline.
//   2. Tokens harvested from galleries the user actually browses, persisted to
//      userData. This grows over time so brand-new tags/artists get suggested
//      without regenerating the bundled snapshot.

type CountMap = Record<string, number>

// name(lowercased, spaces→'_') already applied when building tokens.
const norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, '_')

let bundled: CountMap = {} // token (e.g. "artist:foo_bar") → work count
let bundledPromise: Promise<void> | null = null
const seen = new Map<string, number>() // token → hit count
let seenPromise: Promise<void> | null = null

function bundledPath(): string {
  // Packaged: extraResources drops it next to app.asar (process.resourcesPath).
  // Dev: __dirname is out/main, project resources/ is two levels up.
  return app.isPackaged
    ? join(process.resourcesPath, 'hitomi-tokens.json')
    : join(__dirname, '../../resources/hitomi-tokens.json')
}

function seenPath(): string {
  return join(app.getPath('userData'), 'hitomi-suggest-seen.json')
}

// Load-once, but share the in-flight promise so concurrent callers all await the
// SAME load (previously a boolean flag let the 2nd concurrent call return early
// with an empty map — the first keystrokes came back with no suggestions).
function ensureBundled(): Promise<void> {
  if (!bundledPromise) {
    bundledPromise = (async () => {
      try {
        bundled = JSON.parse(await fs.readFile(bundledPath(), 'utf-8')) as CountMap
      } catch (e) {
        console.log('[suggest] bundled tokens load failed:', String((e as Error)?.message ?? e))
        bundled = {}
      }
    })()
  }
  return bundledPromise
}

function ensureSeen(): Promise<void> {
  if (!seenPromise) {
    seenPromise = (async () => {
      try {
        const obj = JSON.parse(await fs.readFile(seenPath(), 'utf-8')) as CountMap
        for (const [k, v] of Object.entries(obj)) seen.set(k, v)
      } catch {
        /* first run — no file yet */
      }
    })()
  }
  return seenPromise
}

let saveTimer: NodeJS.Timeout | null = null
function saveSoon(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    const obj: CountMap = {}
    for (const [k, v] of seen) obj[k] = v
    void fs.writeFile(seenPath(), JSON.stringify(obj), 'utf-8').catch(() => {})
  }, 3000)
}

// Absorb the artists/tags of freshly browsed galleries into the seen store.
export async function recordSeen(items: { artists: string[]; tags: string[] }[]): Promise<void> {
  await ensureSeen()
  let changed = false
  const bump = (token: string): void => {
    seen.set(token, (seen.get(token) ?? 0) + 1)
    changed = true
  }
  for (const it of items) {
    for (const a of it.artists) if (a) bump(`artist:${norm(a)}`)
    for (const t of it.tags) if (t) bump(t.includes(':') ? norm(t) : `tag:${norm(t)}`)
  }
  if (changed) saveSoon()
}

// Rank: word-start match (0) beats mid-word (1); ties break on higher count.
function matchScore(value: string, term: string): number | null {
  const idx = value.indexOf(term)
  if (idx === -1) return null
  if (idx === 0) return 0
  return value[idx - 1] === ' ' ? 0 : 1
}

// Return up to `limit` token strings (e.g. "artist:foo_bar") for the query's last
// word. A namespaced query (artist:foo) restricts to that namespace; a plain word
// matches artist names + every seen tag value.
export async function suggestTokens(query: string, limit = 25): Promise<string[]> {
  await Promise.all([ensureBundled(), ensureSeen()])
  const raw = query.trim().toLowerCase()
  if (!raw) return []
  const ci = raw.indexOf(':')
  const ns = ci !== -1 ? raw.slice(0, ci) : null
  const term = (ci !== -1 ? raw.slice(ci + 1) : raw).replace(/_/g, ' ').trim()
  if (!term) return []

  type Hit = { token: string; score: number; count: number }
  const hits: Hit[] = []
  const best = new Map<string, Hit>() // dedupe token, keep the better hit
  // A token is "ns:value"; match on value (namespace-filtered), keep the best hit.
  const considerToken = (tok: string, count: number): void => {
    const c = tok.indexOf(':')
    const tns = c !== -1 ? tok.slice(0, c) : 'tag'
    if (ns && tns !== ns) return
    const value = (c !== -1 ? tok.slice(c + 1) : tok).replace(/_/g, ' ')
    const score = matchScore(value.toLowerCase(), term)
    if (score === null) return
    const prev = best.get(tok)
    if (prev && (prev.score < score || (prev.score === score && prev.count >= count))) return
    best.set(tok, { token: tok, score, count })
  }

  for (const tok in bundled) considerToken(tok, bundled[tok])
  for (const [tok, cnt] of seen) considerToken(tok, cnt)

  for (const h of best.values()) hits.push(h)
  hits.sort((a, b) => a.score - b.score || b.count - a.count || a.token.localeCompare(b.token))
  return hits.slice(0, limit).map((h) => h.token)
}
