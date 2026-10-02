import type { Work, SortMode, OnlineFav } from '../../shared/types'
import type { GallerySummary } from '../../shared/ipc'
import { langCategory } from '../../shared/lang'
import type { Filter } from './store'

export function allTags(w: Work): string[] {
  // language: is shown in the meta row, not as a tag; favlist:<name> is a
  // legacy list marker (converted to code lists by migrateFavorites) — hide both.
  return [...new Set([...w.tags, ...w.manualTags])].filter(
    (t) => !t.startsWith('favlist:') && !t.startsWith('language:')
  )
}

// A clicked tag → search token. Already-namespaced tags (female:x, artist:y)
// are used as-is; a bare tag gets the `tag:` namespace. Spaces → underscore so
// the token survives the whitespace tokenizer. (Fixes the old `tag:female:…`
// double-prefix.)
// "A, B" → ["A", "B"] (multi-artist works store a comma-joined string).
export function splitArtists(s: string | null | undefined): string[] {
  return (s ?? '').split(',').map((a) => a.trim()).filter(Boolean)
}

export function tagToken(t: string): string {
  const body = t.includes(':') ? t : `tag:${t}`
  return body.replace(/\s+/g, '_')
}

// A search token → chip label. Keep the raw namespace ("female:", "tag:", …); only
// turn underscores into spaces for readability. No translation.
export function tokenLabel(tok: string): string {
  return tok.replace(/_/g, ' ')
}

// Autocomplete tokens (`namespace:value`, spaces→underscore) built from the
// user's own library tags, so typing in the search box suggests full
// `female:` / `series:` / `artist:` tokens. Shared by Home + Browse (replaces
// the old separate tag-builder row).
export function tagTokens(works: Work[]): string[] {
  const m: Record<string, Set<string>> = {}
  const add = (k: string, v: string): void => {
    ;(m[k] ??= new Set()).add(v)
  }
  for (const w of works) {
    for (const t of w.tags) {
      const ci = t.indexOf(':')
      if (ci !== -1) add(t.slice(0, ci), t.slice(ci + 1))
      else add('tag', t)
    }
    if (w.artist) w.artist.split(',').map((s) => s.trim()).filter(Boolean).forEach((a) => add('artist', a))
  }
  const out: string[] = []
  for (const [k, set] of Object.entries(m)) for (const v of set) out.push(`${k}:${v.replace(/\s+/g, '_')}`)
  return out.sort().slice(0, 2000)
}

// Meta payload cached with an online favorite, derived from a gallery summary.
// Shared by Browse (grid) and OnlineList (reader sidebar).
export function favMeta(g: GallerySummary): Partial<OnlineFav> {
  return {
    title: g.title,
    artist: g.artists.join(', ') || null,
    language: g.language,
    pageCount: g.pageCount,
    thumbUrl: g.thumbUrl
  }
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

// Normalize for matching: lowercase + underscores→spaces (online tags use
// underscores, local sidecar tags use spaces; treat them the same).
const norm = (s: string): string => s.toLowerCase().replace(/_/g, ' ').trim()

const NS_TAGS = ['female', 'male', 'type', 'series', 'parody', 'character', 'group']

// True if a single (positive) token matches the work. Supports the same
// namespace syntax as online search: artist:, tag:, language:, female:, male:,
// type:, series:, character:, group:. A bare token is a free-text substring.
function tokenMatch(w: Work, tok: string): boolean {
  const ci = tok.indexOf(':')
  const tags = allTags(w).map(norm)
  if (ci > 0) {
    const ns = tok.slice(0, ci).toLowerCase()
    const v = norm(tok.slice(ci + 1))
    if (ns === 'artist') return norm(w.artist ?? '').includes(v)
    if (ns === 'language')
      return norm(w.language ?? '').includes(v) || langCategory(w.language) === v
    if (ns === 'tag') return tags.some((t) => t.includes(v))
    if (NS_TAGS.includes(ns)) return tags.some((t) => t === `${ns}:${v}` || t.includes(`${ns}:${v}`))
    // Unknown namespace → fall through to free-text on the whole token.
  }
  const hay = norm(`${w.title} ${w.artist ?? ''} ${w.code ?? ''} ${allTags(w).join(' ')}`)
  return hay.includes(norm(tok))
}

// Split a query into tokens, keeping quoted phrases together so a multi-word
// tag survives: `tag:"big breasts"` or `"big breasts"` stays one token. Quotes
// are stripped from the result. Underscores also work (norm treats _ as space).
export function tokenizeSearch(raw: string): string[] {
  const out: string[] = []
  const re = /[^\s"]*"[^"]*"|\S+/g
  let m: RegExpExecArray | null
  // Commas are a display separator (added when appending clicked tags); strip
  // them from token edges so `tag:foo,` matches the same as `tag:foo`.
  while ((m = re.exec(raw)) !== null) out.push(m[0].replace(/"/g, '').replace(/^,+|,+$/g, ''))
  return out.filter(Boolean)
}

// AND across positive tokens; tokens prefixed with '-' are exclusions.
export function matchesSearch(w: Work, raw: string): boolean {
  if (!raw.trim()) return true
  for (const tok of tokenizeSearch(raw)) {
    if (tok.startsWith('-')) {
      const body = tok.slice(1)
      if (body && tokenMatch(w, body)) return false
    } else if (!tokenMatch(w, tok)) return false
  }
  return true
}

function matchesFilter(w: Work, f: Filter): boolean {
  switch (f.kind) {
    case 'all':
      return true
    case 'favorites':
      return w.favorite
    case 'artist':
      return splitArtists(w.artist).some((a) => a.toLowerCase() === f.value.toLowerCase())
    case 'tag':
      return allTags(w).some((t) => t.toLowerCase() === f.value.toLowerCase())
    case 'favlists':
      // Checked lists: 기본 = hearted works; imported lists = their codes.
      return (f.value.includes(FAV_BASE) && w.favorite) || (!!w.code && f.codes.includes(w.code))
  }
}

// Sentinel list name for the app's own favorites in the drawer.
// The "기본" entry of the favorites drawer = the hearts themselves (as
// opposed to an imported favorite list).
export const FAV_BASE = '기본'

// Strip grouped tag blocks so "[Group] Title" / "【작가】제목" sort under the
// real title. Covers ASCII and CJK/fullwidth bracket pairs.
const BRACKET_GROUP = /[[(（【「『〔［{][^\])）】」』〕］}]*[\])）】」』〕］}]/g
export function titleSortKey(title: string, ignoreBrackets: boolean): string {
  let t = title
  if (ignoreBrackets) t = t.replace(BRACKET_GROUP, ' ')
  return t.replace(/\s+/g, ' ').trim()
}

export function selectWorks(
  works: Work[],
  search: string,
  filter: Filter,
  sort: SortMode,
  seed: number,
  ignoreBrackets = false,
  ranks?: Record<string, number>
): Work[] {
  const out = works.filter((w) => matchesFilter(w, filter) && matchesSearch(w, search))
  return sortWorks(out, sort, seed, ignoreBrackets, ranks)
}

export function sortWorks(
  works: Work[],
  sort: SortMode,
  seed: number,
  ignoreBrackets = false,
  ranks?: Record<string, number>
): Work[] {
  const arr = [...works]
  const titleCmp = (a: Work, b: Work) =>
    titleSortKey(a.title, ignoreBrackets).localeCompare(titleSortKey(b.title, ignoreBrackets), undefined, {
      numeric: true,
      sensitivity: 'base'
    })
  switch (sort) {
    case 'random':
      return arr
        .map((w) => ({ w, k: hashSeed(w.id + seed) }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.w)
    case 'recent':
      return arr.sort((a, b) => b.mtime - a.mtime)
    case 'viewed':
      // Actually-last-opened first; never-opened (null) sink to the bottom.
      return arr.sort((a, b) => (b.lastViewedAt ?? 0) - (a.lastViewedAt ?? 0) || titleCmp(a, b))
    case 'rank':
      return arr.sort((a, b) => b.rank - a.rank || b.viewCount - a.viewCount || titleCmp(a, b))
    case 'views':
      return arr.sort((a, b) => b.viewCount - a.viewCount || titleCmp(a, b))
    case 'title':
      return arr.sort(titleCmp)
    case 'artist': {
      // By artist name (A→Z); works with no artist always sink to the bottom.
      const key = (w: Work): string => w.artist?.trim() ?? ''
      return arr.sort((a, b) => {
        const ka = key(a)
        const kb = key(b)
        if (!ka && !kb) return titleCmp(a, b)
        if (!ka) return 1
        if (!kb) return -1
        return ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' }) || titleCmp(a, b)
      })
    }
    case 'popular': {
      const rankOf = (w: Work): number =>
        w.code && ranks && ranks[w.code] !== undefined ? ranks[w.code] : Number.MAX_SAFE_INTEGER
      return arr.sort((a, b) => rankOf(a) - rankOf(b) || titleCmp(a, b))
    }
  }
}

// --- general-manga series grouping ------------------------------------------
// Normal-library works split a series across chapter folders. Two layouts are
// supported: (1) parent folder = series, each chapter a subfolder; (2) chapter
// folders sit directly under a root, their series name extracted from the title.

const SEP = /[\\/]/
function parentDir(p: string): string {
  const parts = p.split(SEP)
  parts.pop()
  return parts.join('\\')
}
function baseName(p: string): string {
  const parts = p.split(SEP)
  return parts[parts.length - 1] ?? p
}
const normPath = (p: string): string => p.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()

// A chapter number can be "28", "28.1", or "28-1" (split/part numbering).
const CH_NUM = String.raw`\d+(?:[.\-]\d+)?`
// The number must sit directly against the unit char (no space). Allowing a
// space let "0001 회복술사…" match "0001"+회 (회 = chapter unit, also in the
// title), so the leading sort index was mistaken for the chapter number.
const CH_TOKEN = new RegExp(`(${CH_NUM})(?:화|회|권|화차|話|장)`)

// Chapter number from a folder/title. Handles "97화", "28-1화" (→ 28), a
// zero-padded pure number folder ("0097" → 97), trailing/leading bare numbers.
export function chapterNum(s: string): number | null {
  const m =
    s.match(CH_TOKEN) ||
    s.match(new RegExp(`(${CH_NUM})\\s*$`)) ||
    s.match(new RegExp(`^\\s*(${CH_NUM})`))
  if (!m) return null
  return Number(m[1].split(/[.\-]/)[0]) // take the major number
}

// Extract the clean series title from a messy chapter name. Drops a range half
// ("제목 28-1화 ~ 제목 76-2화" → "제목"), chapter tokens anywhere ("83화"/"28-1화"),
// and a leading or trailing bare chapter number ("19화 일탈일기" → "일탈일기").
export function seriesTitle(name: string): string {
  let s = name.split(/\s*[~～〜∼]\s*/)[0] // keep the left side of a range
  s = s.replace(new RegExp(CH_TOKEN.source, 'g'), ' ') // "83화" / "28-1화" anywhere
  s = s.replace(new RegExp(`^\\s*${CH_NUM}[\\s_]+`), '') // leading bare chapter number
  s = s.replace(new RegExp(`[\\s_]*${CH_NUM}\\s*$`), '') // trailing bare number
  s = s.replace(/[\s_]+/g, ' ').trim()
  return s || name.trim()
}

// Concise chapter label for the chapter list ("97화"); falls back to the folder
// name when no number is found.
export function chapterLabel(w: Work): string {
  const n = chapterNum(baseName(w.path)) ?? chapterNum(w.title)
  return n != null ? `${n}화` : baseName(w.path) || w.title
}

const isNormal = (w: Work): boolean => (w.library ?? 'hitomi') === 'normal'

// Strip a leading index run ("0008 8 - - …" → "…") so the series name is exposed.
const cleanLeading = (name: string): string => name.replace(/^[\s\d.\-_]+/, '').trim()

// The series-name prefix in a chapter name that has an X화 token (the text
// before it), e.g. "앨리스의 느끼는 라디오 7화 …" → "앨리스의 느끼는 라디오".
function prefixBeforeToken(clean: string): string | null {
  const m = clean.match(CH_TOKEN)
  if (m && m.index && m.index > 0) return clean.slice(0, m.index).trim()
  return null
}

export interface SeriesGroup {
  key: string
  title: string
  chapters: Work[] // sorted in chapter order
}

export type ChapterScheme = 'auto' | 'token' | 'index'

// Number + raw text of an X화 / X-Y화 token (e.g. "28-1" → {raw:'28-1', val:28.001}).
function tokenNum(name: string): { raw: string; val: number } | null {
  const m = name.match(CH_TOKEN)
  if (!m) return null
  const raw = m[1]
  const [a, b] = raw.split(/[.\-]/).map(Number)
  return { raw, val: a + (b ? b / 1000 : 0) }
}
// Leading number of a name (a zero-padded sort index counts: "0008" → 8).
function leadingNum(name: string): number | null {
  const m = name.match(/^\s*(\d+)/)
  return m ? Number(m[1]) : null
}

// Quality of a numbering candidate: how many chapters have no number, how many
// share a number (duplicates), and how many numbers are missing in the run (gaps).
interface SchemeStat {
  missing: number
  dups: number
  gaps: number
}
function statsOf(keys: (number | null)[]): SchemeStat {
  const present = keys.filter((k): k is number => k != null)
  const missing = keys.length - present.length
  const seen = new Map<number, number>()
  for (const k of present) seen.set(k, (seen.get(k) ?? 0) + 1)
  let dups = 0
  for (const n of seen.values()) if (n > 1) dups += n - 1
  // Gaps measured on the integer (major) part: missing chapter numbers in range.
  const majors = [...new Set(present.map((k) => Math.floor(k)))].sort((a, b) => a - b)
  const gaps = majors.length > 1 ? majors[majors.length - 1] - majors[0] + 1 - majors.length : 0
  return { missing, dups, gaps }
}
// Lower is better. Duplicates/missing dominate; gaps only break ties (a series
// can legitimately be missing chapters).
const schemeScore = (s: SchemeStat): number => (s.missing + s.dups) * 1000 + s.gaps

// Pick a numbering scheme by comparing the X화 token (e.g. "28-1화") against the
// leading folder index ("0001 …"). Whichever yields fewer duplicates/missing —
// then fewer gaps — wins. So a series where the leading index just repeats a
// part number (0001×40, 0002×20 …) uses the real trailing 화 number, while a
// clean sequential index beats tokens that collide (e.g. "2부 1화" ↔ "1화").
// Ties favor the token, since it's the true chapter number.
function detectScheme(chapters: Work[]): 'token' | 'index' {
  const tokenKeys = chapters.map((c) => (tokenNum(baseName(c.path)) ?? tokenNum(c.title))?.val ?? null)
  const indexKeys = chapters.map((c) => leadingNum(baseName(c.path)))
  return schemeScore(statsOf(tokenKeys)) <= schemeScore(statsOf(indexKeys)) ? 'token' : 'index'
}

// Resolve 'auto' to the concrete scheme used for a series.
export function effectiveChapterScheme(chapters: Work[], scheme: ChapterScheme): 'token' | 'index' {
  return scheme === 'auto' ? detectScheme(chapters) : scheme
}

// Strip a lone chapter-unit char (화/회/장/권/話) left at the START after a token
// was removed — e.g. "0001 1 - - 1화 부제" → the leading "1 … 1" index run is
// eaten first, leaving an orphan "화" that isn't a real N화 token.
function stripOrphanUnit(s: string): string {
  return s.replace(/^[\s,·…\-_]*[화회장권話](?=\s|$)/, ' ')
}

// The "core" of a chapter folder name = name minus chapter tokens (N화) and the
// leading sort-index run. What remains is the series title + any real subtitle.
function chapterCore(name: string): string {
  let s = name.replace(new RegExp(CH_TOKEN.source, 'g'), ' ') // strip every N화 token
  s = s.replace(/^[\s\d.\-_]+/, ' ') // then the leading index run (tokens already gone)
  s = stripOrphanUnit(s) // and a lone 화 unit orphaned by the token removal
  return s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// Longest whitespace-delimited word prefix shared by every string (≥2 needed).
// Used to detect the series-title words repeated across a series' chapter names.
function commonWordPrefix(list: string[]): string[] {
  const items = list.filter(Boolean)
  if (items.length < 2) return []
  let pre = items[0].split(/\s+/)
  for (const s of items.slice(1)) {
    const w = s.split(/\s+/)
    let k = 0
    while (k < pre.length && k < w.length && pre[k] === w[k]) k++
    pre = pre.slice(0, k)
    if (!pre.length) break
  }
  return pre
}

// The chapter's own subtitle = its core minus the series-name words shared across
// the series (`prefix`), then leading punctuation cleaned. So "…남여사친 프롤로그"
// with prefix ["…","남여사친"] → "프롤로그"; a chapter that's only the series name
// → "" (folder becomes just "N화").
function subtitleOf(core: string, prefix: string[]): string {
  let words = core.split(/\s+/).filter(Boolean)
  let k = 0
  while (k < prefix.length && k < words.length && words[k] === prefix[k]) k++
  words = words.slice(k)
  return words.join(' ').replace(/^[\s,·…\-_]+/, '').trim()
}

export interface ChapterInfo {
  work: Work
  label: string // "28-1화" / "8화"
  subtitle: string // chapter-specific title, '' if none
  sort: number
}

// Analyze a series' chapters: per-chapter label + subtitle, in chapter order.
export function analyzeSeries(chapters: Work[], seriesTitle: string, scheme: ChapterScheme): ChapterInfo[] {
  const eff = scheme === 'auto' ? detectScheme(chapters) : scheme
  // Series-name words shared across the chapters (drops the repeated title even
  // when it's truncated differently or the folder-derived seriesTitle is noisy).
  const cores = chapters.map((c) => chapterCore(baseName(c.path)))
  const prefix = commonWordPrefix(cores)
  const info = chapters.map((c, i) => {
    const name = baseName(c.path)
    let label: string
    let sort: number
    const tok = tokenNum(name) ?? tokenNum(c.title)
    if (eff === 'token' && tok) {
      label = `${tok.raw}화`
      sort = tok.val
    } else {
      const n = leadingNum(name)
      label = n != null ? `${n}화` : name
      sort = n ?? 0
    }
    // Fall back to the folder-derived series title (single-chapter series have no
    // shared prefix) so a lone chapter still drops its series name.
    let subtitle = subtitleOf(cores[i], prefix)
    if (!prefix.length && seriesTitle) {
      const low = subtitle.toLowerCase()
      const st = seriesTitle.toLowerCase()
      if (low.startsWith(st)) subtitle = subtitle.slice(seriesTitle.length).replace(/^[\s,·…\-_]+/, '').trim()
    }
    return { work: c, label, subtitle, sort }
  })
  info.sort(
    (a, b) =>
      a.sort - b.sort ||
      baseName(a.work.path).localeCompare(baseName(b.work.path), undefined, { numeric: true, sensitivity: 'base' })
  )
  return info
}

// Roots handed to groupSeries / seriesOf: the general-manga library roots.
// Chapters sitting DIRECTLY under one of these are clustered by title prefix
// (layout 2 below); anything deeper groups by its parent folder. Every caller
// must use this same list — series keys (used for favorites/tags) and the
// thumbnail target ids depend on it.
export function seriesRoots(s: { normalRoots?: string[] | null }): string[] {
  return (s.normalRoots ?? []).filter(Boolean)
}

// Collapse normal works into one entry per series. Two folder layouts:
//  (1) parent folder = series (chapters are subfolders) → one group per parent;
//  (2) chapters sit directly under a root → cluster by common series prefix, so
//      "…라디오 프롤로그" / "…라디오 7화 여친과…" land in one series even though
//      the trailing subtitle differs.
export function groupSeries(works: Work[], roots: string[]): SeriesGroup[] {
  const rootSet = new Set(roots.filter(Boolean).map(normPath))
  const out: SeriesGroup[] = []
  const byParent = new Map<string, Work[]>()
  for (const w of works) {
    if (!isNormal(w)) continue
    const pa = normPath(parentDir(w.path))
    const arr = byParent.get(pa)
    if (arr) arr.push(w)
    else byParent.set(pa, [w])
  }

  for (const [pa, list] of byParent) {
    if (!rootSet.has(pa)) {
      // Layout 1: the parent folder is the series.
      out.push({ key: pa, title: seriesTitle(baseName(parentDir(list[0].path))), chapters: list })
      continue
    }
    // Layout 2: cluster by the series prefix taken from chapters that have an
    // X화 token; chapters without one (프롤로그 등) attach to the longest prefix
    // they start with.
    const items = list.map((w) => ({ w, clean: cleanLeading(baseName(w.path)) }))
    const cands = [
      ...new Set(items.map((it) => prefixBeforeToken(it.clean)).filter((x): x is string => !!x))
    ].sort((a, b) => b.length - a.length)
    const groups = new Map<string, { title: string; chapters: Work[] }>()
    for (const it of items) {
      const title = cands.find((c) => it.clean.toLowerCase().startsWith(c.toLowerCase())) ?? seriesTitle(it.clean)
      const key = `${pa}|${title.toLowerCase()}`
      const g = groups.get(key)
      if (g) g.chapters.push(it.w)
      else groups.set(key, { title, chapters: [it.w] })
    }
    for (const [key, g] of groups) out.push({ key, title: g.title, chapters: g.chapters })
  }
  // Order each series' chapters ascending (1화 first) so the representative /
  // "open" chapter and the reading queue start at chapter 1 — the scan order is
  // arbitrary, which made e.g. 강철의연금술사 open at 화 10.
  for (const g of out) g.chapters = analyzeSeries(g.chapters, g.title, 'auto').map((ci) => ci.work)
  return out
}

// Which works actually need a thumbnail. Doujin: every work. General manga: only
// the series representative (chapter 1) — chapters share one cover on the home
// card, so generating a thumb per chapter is wasteful (thousands vs a handful).
export function thumbTargetIds(
  works: Work[],
  mode: 'hitomi' | 'normal',
  normalRoots: string[]
): string[] {
  const inMode = works.filter((w) => (w.library ?? 'hitomi') === mode)
  if (mode !== 'normal') return inMode.map((w) => w.id)
  return groupSeries(inMode, normalRoots)
    .map((s) => s.chapters[0]?.id)
    .filter((id): id is string => !!id)
}

// If `path` sits under one of the "artist folder" roots (settings.flattenRoots),
// return a normalized key for its artist folder (root/<first child>), else null.
// Used to scope the reader's left list to a single artist's works.
export function artistFolderOf(path: string, roots: string[]): string | null {
  const np = normPath(path)
  for (const r of roots) {
    if (!r) continue
    const nr = normPath(r)
    if (np === nr) continue
    if (np.startsWith(nr + '\\')) return nr + '\\' + np.slice(nr.length + 1).split('\\')[0]
  }
  return null
}

// The series group a normal work belongs to (computed from all works).
export function seriesOf(work: Work, all: Work[], roots: string[]): SeriesGroup {
  const found = groupSeries(all, roots).find((g) => g.chapters.some((c) => c.id === work.id))
  return found ?? { key: work.id, title: seriesTitle(work.title), chapters: [work] }
}

// Prefix marking a synthetic single-chapter favorite entry (a chapter favorited
// on its own, shown in the fav view as a card that opens that chapter directly).
export const CHAP_FAV_PREFIX = 'chap:'

export const SORT_LABELS: Record<SortMode, string> = {
  random: '무작위',
  recent: '최신순',
  viewed: '최근 본',
  rank: '평점순',
  views: '감상 횟수순',
  title: '이름순',
  artist: '작가순',
  popular: '인기순'
}

// Normalized series-title key used to link a local general-manga series with its
// online (manga-site) counterpart — they share no id, only the title. Drops bracketed
// groups, punctuation and whitespace, lowercases.
export function titleKey(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[[(【<{（][^\][)】>}）]*[\])】>}）]/g, ' ')
    .replace(/[\s_~～〜·・|/\:\-!?.,'"]+/g, '')
    .trim()
}

// Online favorites live in one map keyed by "code": a numeric gallery id for
// doujin, the series URL for manga-site (general manga). This tells them apart.
export function isTokiCode(code: string): boolean {
  return /^https?:/.test(code)
}

// Is a general-manga series with this title favorited ONLINE (manga-site)? Local and
// online series share only their title, so this is how a local series card
// shows a heart set from the online side.
export function isOnlineTitleFav(onlineFavs: Record<string, OnlineFav>, title: string): boolean {
  const k = titleKey(title)
  return !!k && Object.values(onlineFavs).some((f) => f.favorite && isTokiCode(f.code) && titleKey(f.title) === k)
}

// Order general-manga series for the home list. A series takes its chapters'
// aggregate: newest mtime (recent), last viewed (viewed), summed views (views),
// best rank (rank), first artist found (artist). random / popular keep the
// incoming order. `dir` 'asc' reverses the default (descending) order — artist
// sorting always keeps series without an artist at the end.
export function sortSeries(arr: SeriesGroup[], sort: SortMode, dir: 'asc' | 'desc'): SeriesGroup[] {
  const byTitle = (a: SeriesGroup, b: SeriesGroup): number =>
    a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
  const recentOf = (s: SeriesGroup): number => Math.max(...s.chapters.map((c) => c.mtime))
  const viewedOf = (s: SeriesGroup): number => Math.max(0, ...s.chapters.map((c) => c.lastViewedAt ?? 0))
  const sumViews = (s: SeriesGroup): number => s.chapters.reduce((n, c) => n + c.viewCount, 0)
  const maxRank = (s: SeriesGroup): number => Math.max(0, ...s.chapters.map((c) => c.rank))
  const artistOf = (s: SeriesGroup): string => s.chapters.find((c) => c.artist)?.artist?.trim() ?? ''
  let out = [...arr]
  if (sort === 'recent') out.sort((a, b) => recentOf(b) - recentOf(a))
  else if (sort === 'viewed') out.sort((a, b) => viewedOf(b) - viewedOf(a))
  else if (sort === 'title') out.sort(byTitle)
  else if (sort === 'views') out.sort((a, b) => sumViews(b) - sumViews(a))
  else if (sort === 'rank') out.sort((a, b) => maxRank(b) - maxRank(a))
  else if (sort === 'artist')
    out.sort((a, b) => {
      const ka = artistOf(a)
      const kb = artistOf(b)
      if (!ka && !kb) return byTitle(a, b)
      if (!ka) return 1
      if (!kb) return -1
      return ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' })
    })
  if (dir === 'asc') {
    out.reverse()
    if (sort === 'artist') out = [...out.filter((s) => artistOf(s)), ...out.filter((s) => !artistOf(s))]
  }
  return out
}
