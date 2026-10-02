import { promises as fs } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import https from 'https'
import { lookup as systemLookup } from 'dns'
import type { LookupAddress } from 'dns'
import type { HitomiMeta } from '../../shared/types'
import { fillNamePattern, langCode } from '../../shared/pattern'
import { titleSim } from '../../shared/title'
import { dohAnswers } from './doh'

// the site crawler. Algorithm mirrors the maintained `node-hitomi` library:
//   - gallery metadata: GET the site/galleries/{id}.js  (strip "var galleryinfo = ")
//   - image url: derived from gg.js (image context) + each file's hash
// Network requests need a browser UA + doujin referer or the CDN returns 403.

// doujin migrated its content/CDN hosts off *.the site to this domain (the old
// ltn/a*/tn.the site names no longer resolve -> ERR_NAME_NOT_RESOLVED). The
// site itself is still the site (used as Referer).
// Content/CDN host. Empty until the user sets it in Settings → 네트워크 (online
// access is gated on this, because the domain changes often). The site referer
// stays the site. Set via setHitomiContentHost().
// The CDN host that actually serves galleries/images. the site (the site) no
// longer serves these — its ltn/tn/a* names don't resolve — so when the user
// enters the site address we map it to the current known CDN host.
const DEFAULT_CDN = 'gold-usergeneratedcontent.net'
let CONTENT_HOST = ''
export function setHitomiContentHost(v: string): void {
  let h = (v ?? '').trim()
  if (!h) {
    CONTENT_HOST = ''
    return
  }
  try {
    if (h.includes('://')) h = new URL(h).host
  } catch {
    /* keep as typed */
  }
  h = h
    .replace(/^www\./, '')
    .replace(/^ltn\./, '')
    .replace(/\/.*$/, '')
    .replace(/\/+$/, '')
  // Entered the site itself (the site) → use the current CDN host.
  CONTENT_HOST = /(^|\.)hitomi\.la$/i.test(h) ? DEFAULT_CDN : h
}
// Base for ltn.* endpoints; throws a clear error when the host isn't configured.
function ltn(): string {
  if (!CONTENT_HOST)
    throw new Error('동인지 온라인 주소가 설정되지 않았습니다. 설정 → 네트워크에서 주소를 입력하세요.')
  return `https://ltn.${CONTENT_HOST}`
}
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const HEADERS = { 'User-Agent': UA, Referer: 'https://hitomi.la/', Origin: 'https://hitomi.la' }

export const SIDECAR = 'meta.hitomi.json'

interface RawFile {
  name?: string
  hash: string
  hasavif?: number
  haswebp?: number
  width?: number
  height?: number
}

interface RawGallery {
  id: number | string
  title: string
  japanese_title: string | null
  language: string | null
  language_localname: string | null
  type: string | null
  date?: string
  files: RawFile[]
  tags?: { tag: string; female?: number | string; male?: number | string }[]
  artists?: { artist: string }[]
  groups?: { group: string }[]
  characters?: { character: string }[]
  parodys?: { parody: string }[]
  related?: (number | string)[]
  // Other-language editions of THIS gallery (the doujin site's own cross-language map).
  languages?: { galleryid: number | string; name: string; language_localname?: string; url?: string }[]
}

interface ImageContext {
  codes: Set<number>
  isSuffix: boolean
  b: string
}

// Use Electron's net.fetch (Chromium network stack) so requests honor the
// system certificate store and whatever unblocking the user has set up in their
// browser — Node's global fetch (undici) does not see system/custom CAs.
// --- DNS bypass --------------------------------------------------------------
// ISPs block doujin at the DNS level (ERR_NAME_NOT_RESOLVED). We resolve doujin
// hostnames ourselves via DoH (querying 1.1.1.1 directly by IP, so no system DNS
// is involved at all), then connect Node's https client straight to that IP via
// a custom `lookup`. SNI is still the real hostname, so packet-level tools
// (Unicorn HTTPS / VPN) can still do their SNI work. Falls back to system DNS.

const dohCache = new Map<string, { ip: string; at: number }>()
const DOH_TTL = 10 * 60 * 1000

// Last A record of `host` via DoH (after any CNAME chain).
async function dohQuery(host: string): Promise<string | null> {
  const a = (await dohAnswers(host, 'A')).filter((x) => x.type === 1)
  return a.length ? a[a.length - 1].data : null
}

async function resolveDoh(host: string): Promise<string | null> {
  const cached = dohCache.get(host)
  if (cached && Date.now() - cached.at < DOH_TTL) return cached.ip
  const ip = await dohQuery(host)
  if (ip) dohCache.set(host, { ip, at: Date.now() })
  return ip
}

// Node lookup that resolves via DoH first, then system DNS. Must honor
// options.all (array form) or Node passes `undefined` to connect ->
// ERR_INVALID_IP_ADDRESS.
function dohLookup(
  hostname: string,
  options: any,
  cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
): void {
  const fallback = (): void => systemLookup(hostname, options, cb as any)
  resolveDoh(hostname)
    .then((ip) => {
      if (!ip) return fallback()
      if (options && options.all) cb(null, [{ address: ip, family: 4 }])
      else cb(null, ip, 4)
    })
    .catch(fallback)
}

interface GetOpts {
  range?: string
}

interface HttpResult {
  status: number
  body: Buffer
  headers: Record<string, string | string[] | undefined>
}

function httpsGetFull(url: string, opts: GetOpts = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const headers: Record<string, string> = { ...HEADERS }
    if (opts.range) headers['Range'] = opts.range
    const req = https.request(
      {
        hostname: u.hostname,
        servername: u.hostname,
        path: u.pathname + u.search,
        port: 443,
        method: 'GET',
        headers,
        lookup: dohLookup as any
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status < 200 || status >= 300) {
          res.resume()
          reject(new Error(`GET ${url} -> ${status}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks), headers: res.headers }))
      }
    )
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('timeout')))
    req.end()
  })
}

function httpsGetBuffer(url: string, opts: GetOpts = {}): Promise<Buffer> {
  return httpsGetFull(url, opts).then((r) => r.body)
}

async function getText(url: string): Promise<string> {
  return (await httpsGetBuffer(url)).toString('utf8')
}

async function getBytes(url: string, range?: string): Promise<Buffer> {
  return httpsGetBuffer(url, { range })
}

// Public buffer fetch used by the image protocol in main (online/thumbnail
// images go through the same DNS-bypass path).
export function fetchHitomiBuffer(url: string): Promise<Buffer> {
  return httpsGetBuffer(url)
}

// Connectivity self-test for the settings UI.
export async function pingHitomi(): Promise<{ dohIp: string | null; ltnOk: boolean; error: string | null }> {
  const host = `ltn.${CONTENT_HOST}`
  const dohIp = await resolveDoh(host)
  try {
    await httpsGetBuffer(`${ltn()}/gg.js`)
    return { dohIp, ltnOk: true, error: null }
  } catch (e: any) {
    return { dohIp, ltnOk: false, error: String(e?.message ?? e) }
  }
}

// --- gg.js (image context) -------------------------------------------------

let cachedCtx: { ctx: ImageContext; at: number } | null = null
const CTX_TTL = 60 * 60 * 1000 // 1h

export async function getImageContext(force = false): Promise<ImageContext> {
  if (!force && cachedCtx && Date.now() - cachedCtx.at < CTX_TTL) return cachedCtx.ctx
  const js = await getText(`${ltn()}/gg.js?_=${Date.now()}`)
  const ctx = parseGG(js)
  cachedCtx = { ctx, at: Date.now() }
  return ctx
}

export function parseGG(js: string): ImageContext {
  const codes = new Set<number>()
  let i = 0
  // Collect every `case N:` label inside gg.m's switch.
  for (;;) {
    const c = js.indexOf('case ', i)
    if (c === -1) break
    const start = c + 5
    const colon = js.indexOf(':', start)
    if (colon === -1) break
    const n = Number(js.slice(start, colon).trim())
    if (Number.isInteger(n)) codes.add(n)
    i = colon + 1
  }
  const oIdx = js.indexOf('var o = ') + 8
  const rawO = Number(js.slice(oIdx, js.indexOf(';', oIdx)).trim())
  const isSuffix = !rawO
  const bIdx = js.lastIndexOf("b: '") + 4
  const b = js.slice(bIdx, js.indexOf("'", bIdx))
  if (!codes.size || !b) throw new Error('failed to parse gg.js (site changed format)')
  return { codes, isSuffix, b }
}

// Pick the on-server encoding to fetch. `pref` is a best-effort choice for
// compatibility with other apps (webp is more widely supported than avif); if the
// preferred encoding isn't available for a page, fall back to the other one.
function pickExt(f: RawFile, pref: 'avif' | 'webp' = 'avif'): 'avif' | 'webp' {
  if (pref === 'webp') {
    if (f.haswebp) return 'webp'
    if (f.hasavif) return 'avif'
    return 'webp'
  }
  if (f.hasavif) return 'avif'
  if (f.haswebp) return 'webp'
  return 'avif'
}

export function imageUrl(hash: string, ext: 'avif' | 'webp', ctx: ImageContext): string {
  const hashCode = parseInt(hash.slice(-1) + hash.slice(-3, -1), 16)
  const sub = ext[0] + (ctx.codes.has(hashCode) === ctx.isSuffix ? '2' : '1')
  return `https://${sub}.${CONTENT_HOST}/${ctx.b}${hashCode}/${hash}.${ext}`
}

// --- gallery metadata ------------------------------------------------------

export async function fetchRawGallery(code: string): Promise<RawGallery> {
  const text = await getText(`${ltn()}/galleries/${code}.js`)
  const json = text.slice(text.indexOf('{')) // strip "var galleryinfo = "
  return JSON.parse(json) as RawGallery
}

// Existence probe for a gallery id. true = present, false = 404 (deleted from
// doujin), null = uncertain (timeout / DNS / other error → do NOT treat as deleted,
// so a network hiccup never relocates a still-valid work).
export async function hitomiExists(code: string): Promise<boolean | null> {
  try {
    await httpsGetFull(`${ltn()}/galleries/${code}.js`)
    return true
  } catch (e: any) {
    return /->\s*404\b/.test(String(e?.message ?? e)) ? false : null
  }
}

export function toMeta(raw: RawGallery): HitomiMeta {
  const tags = new Set<string>()
  if (raw.type) tags.add(`type:${raw.type}`)
  if (raw.language) tags.add(`language:${raw.language}`)
  for (const p of raw.parodys ?? []) tags.add(`series:${p.parody}`)
  for (const c of raw.characters ?? []) tags.add(`character:${c.character}`)
  for (const g of raw.groups ?? []) tags.add(`group:${g.group}`)
  for (const t of raw.tags ?? []) {
    const gender = t.female ? 'female:' : t.male ? 'male:' : ''
    tags.add(gender + t.tag)
  }
  return {
    code: String(raw.id),
    title: raw.title,
    japaneseTitle: raw.japanese_title ?? null,
    artists: (raw.artists ?? []).map((a) => a.artist),
    tags: [...tags],
    language: raw.language ?? null,
    type: raw.type ?? null,
    pageCount: raw.files.length,
    fetchedAt: Date.now()
  }
}

export async function fetchMeta(code: string): Promise<HitomiMeta> {
  return toMeta(await fetchRawGallery(code))
}

// --- sidecar ---------------------------------------------------------------

export async function readSidecar(dir: string): Promise<HitomiMeta | null> {
  try {
    return JSON.parse(await fs.readFile(join(dir, SIDECAR), 'utf-8')) as HitomiMeta
  } catch {
    return null
  }
}

export async function writeSidecar(dir: string, meta: HitomiMeta): Promise<void> {
  await fs.writeFile(join(dir, SIDECAR), JSON.stringify(meta, null, 2), 'utf-8')
}

// --- download --------------------------------------------------------------

const BAD = /[<>:"/\\|?*\x00-\x1f]/g
export function sanitize(name: string): string {
  // Windows forbids a trailing '.' or space on a path segment — the OS silently
  // strips them at create time, so the folder on disk no longer matches the path
  // we recorded ("이 위치를 사용할 수 없음"). Strip them ourselves, after the length
  // cut (which can newly expose a trailing dot).
  return (
    name
      .replace(BAD, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150)
      .replace(/[.\s]+$/, '')
      .trim() || 'untitled'
  )
}

function folderName(meta: HitomiMeta, pattern?: string): string {
  if (pattern && pattern.trim()) {
    const groups = meta.tags.filter((t) => t.startsWith('group:')).map((t) => t.slice(6))
    return sanitize(
      fillNamePattern(pattern, {
        id: meta.code,
        title: meta.title,
        artist: meta.artists.join(', '),
        group: groups.join(', '),
        language: langCode(meta.language)
      })
    )
  }
  const artist = meta.artists.length ? meta.artists.join(', ') + ' ' : ''
  return sanitize(`${artist}[${meta.code}] ${meta.title}`)
}

export interface DownloadResult {
  dir: string
  meta: HitomiMeta
}

// Downloads every page into destRoot/<artist [code] title>/NNNN.ext and writes a
// sidecar so the scanner picks up full metadata.
export async function downloadGallery(
  code: string,
  destRoot: string,
  onProgress: (done: number, total: number, title: string) => void,
  format: 'avif' | 'webp' = 'avif',
  pattern?: string,
  signal?: AbortSignal
): Promise<DownloadResult> {
  const raw = await fetchRawGallery(code)
  const meta = toMeta(raw)
  const ctx = await getImageContext()
  const dir = join(destRoot, folderName(meta, pattern))
  await fs.mkdir(dir, { recursive: true })

  const total = raw.files.length
  const pad = String(total).length
  for (let i = 0; i < total; i++) {
    signal?.throwIfAborted()
    const f = raw.files[i]
    const ext = pickExt(f, format)
    const fname = `${String(i + 1).padStart(Math.max(pad, 3), '0')}.${ext}`
    const fpath = join(dir, fname)
    // Resume support: a stopped download leaves partial pages on disk. Skip any
    // page already written so a restart continues from where it stopped.
    try {
      const st = await fs.stat(fpath)
      if (st.size > 0) {
        onProgress(i + 1, total, meta.title)
        continue
      }
    } catch {
      // not present — fall through and download it
    }
    const url = imageUrl(f.hash, ext, ctx)
    const buf = await retry(() => getBytes(url), 3)
    await fs.writeFile(fpath, buf)
    onProgress(i + 1, total, meta.title)
  }
  await writeSidecar(dir, meta)
  return { dir, meta }
}

async function retry<T>(fn: () => Promise<T>, times: number): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < times; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastErr
}

// Extract a doujin code from a raw code or any doujin url the user pastes.
export function extractCode(input: string): string | null {
  const m = input.match(/(\d{5,})/)
  return m ? m[1] : null
}

// --- online browse (nozomi index + summaries) ------------------------------

export function thumbnailUrl(hash: string, hasAvif: boolean): string {
  const ext = hasAvif ? 'avif' : 'webp'
  return `https://tn.${CONTENT_HOST}/${ext}bigtn/${hash.slice(-1)}/${hash.slice(-3, -1)}/${hash}.${ext}`
}

// .nozomi files are flat big-endian int32 gallery ids, newest first.
function nozomiPath(source: { kind: 'index' | 'search'; language: string | null; query?: string; sort?: string }): string {
  const lang = source.language || 'all'
  if (source.kind === 'index') {
    if (source.sort && source.sort !== 'date') return `/popular/${source.sort}-${lang}.nozomi`
    return `/index-${lang}.nozomi`
  }
  const q = (source.query || '').trim().toLowerCase()
  const colon = q.indexOf(':')
  let ns = 'tag'
  let tag = q
  if (colon !== -1) {
    ns = q.slice(0, colon)
    tag = q.slice(colon + 1)
  }
  tag = tag.replace(/\s+/g, '_')
  // doujin namespaces map to top-level folders; gendered tags live under tag/.
  switch (ns) {
    case 'artist':
      return `/artist/${tag}-${lang}.nozomi`
    case 'group':
      return `/group/${tag}-${lang}.nozomi`
    case 'series':
    case 'parody':
      return `/series/${tag}-${lang}.nozomi`
    case 'character':
      return `/character/${tag}-${lang}.nozomi`
    case 'male':
      return `/tag/male:${tag}-${lang}.nozomi`
    case 'female':
      return `/tag/female:${tag}-${lang}.nozomi`
    default:
      return `/tag/${tag}-${lang}.nozomi`
  }
}

export interface NozomiPage {
  ids: number[]
  total: number
}

export async function fetchNozomi(
  source: { kind: 'index' | 'search'; language: string | null; query?: string },
  page: number,
  pageSize: number
): Promise<NozomiPage> {
  const url = ltn() + nozomiPath(source)
  const start = page * pageSize * 4
  const end = start + pageSize * 4 - 1
  const res = await httpsGetFull(url, { range: `bytes=${start}-${end}` })
  const cr = res.headers['content-range']
  const crStr = Array.isArray(cr) ? cr[0] : cr
  const total = Number(crStr?.split('/')[1] ?? '0')
  const buf = res.body
  const ids: number[] = []
  for (let i = 0; i + 3 < buf.length; i += 4) ids.push(buf.readInt32BE(i))
  return { ids, total: total ? Math.floor(total / 4) : ids.length }
}

// Index browse (latest / popular) minus excluded tags. Plain browse fetches only
// the requested page by byte range, which can't skip anything — so with
// exclusions the whole list is fetched (cached 10 min), the excluded tags' ids
// are subtracted, and the page is cut from what's left.
const fullNozomiCache = new Map<string, { ids: number[]; at: number }>()
async function cachedIds(key: string, load: () => Promise<number[]>): Promise<number[]> {
  const c = fullNozomiCache.get(key)
  if (c && Date.now() - c.at < 600_000) return c.ids
  const ids = await load()
  fullNozomiCache.set(key, { ids, at: Date.now() })
  return ids
}

export async function fetchNozomiExcluding(
  source: { kind: 'index'; language: string | null; sort?: string },
  page: number,
  pageSize: number,
  exclude: string[]
): Promise<NozomiPage> {
  const toks = exclude.map((t) => t.replace(/^-/, '').trim()).filter(Boolean)
  if (!toks.length) return fetchNozomi(source, page, pageSize)
  const path = nozomiPath(source)
  let all = await cachedIds(path, async () => idsFromBuf((await httpsGetFull(ltn() + path)).body))
  for (const tok of toks) {
    const ids = await cachedIds(`tok:${tok}`, () => fetchTokenIds(tok, 'all'))
    if (!ids.length) continue
    const set = new Set(ids)
    all = all.filter((x) => !set.has(x))
  }
  return { ids: all.slice(page * pageSize, page * pageSize + pageSize), total: all.length }
}

function idsFromBuf(buf: Buffer): number[] {
  const ids: number[] = []
  for (let i = 0; i + 3 < buf.length; i += 4) ids.push(buf.readInt32BE(i))
  return ids
}

// --- doujin full-text search index (galleriesindex B-tree) -------------------
// This is how the doujin site's own search box does free-text / title search: each search
// WORD is sha256-hashed (first 4 bytes = the key) and looked up in a B-tree
// serialized across `galleries.<version>.index` (nodes) + `.data` (posting
// lists of gallery ids). Namespaced tokens (tag:/artist:/…) still use nozomi.
const IDX_B = 16 // B-tree order
const IDX_NODE_SIZE = 464 // max bytes fetched per node

let idxVersion: { v: string; at: number } | null = null
async function galleriesIndexVersion(): Promise<string> {
  if (idxVersion && Date.now() - idxVersion.at < 60_000) return idxVersion.v
  const r = await httpsGetFull(`${ltn()}/galleriesindex/version?_=${Date.now()}`)
  const v = r.body.toString('utf-8').trim()
  idxVersion = { v, at: Date.now() }
  return v
}

function hashTerm(term: string): Buffer {
  return createHash('sha256').update(term, 'utf-8').digest().subarray(0, 4)
}

interface IdxNode {
  keys: Buffer[]
  datas: [number, number][] // [offset, length] into the .data file
  subnodes: number[]
}
function decodeIdxNode(buf: Buffer): IdxNode {
  let pos = 0
  const numKeys = buf.readInt32BE(pos)
  pos += 4
  const keys: Buffer[] = []
  for (let i = 0; i < numKeys; i++) {
    const size = buf.readInt32BE(pos)
    pos += 4
    keys.push(buf.subarray(pos, pos + size))
    pos += size
  }
  const numDatas = buf.readInt32BE(pos)
  pos += 4
  const datas: [number, number][] = []
  for (let i = 0; i < numDatas; i++) {
    const offset = Number(buf.readBigUInt64BE(pos))
    pos += 8
    const length = buf.readInt32BE(pos)
    pos += 4
    datas.push([offset, length])
  }
  const subnodes: number[] = []
  for (let i = 0; i < IDX_B + 1; i++) {
    subnodes.push(Number(buf.readBigUInt64BE(pos)))
    pos += 8
  }
  return { keys, datas, subnodes }
}

async function idxNodeAt(version: string, address: number): Promise<IdxNode> {
  const r = await httpsGetFull(`${ltn()}/galleriesindex/galleries.${version}.index`, {
    range: `bytes=${address}-${address + IDX_NODE_SIZE - 1}`
  })
  return decodeIdxNode(r.body)
}

async function idxBSearch(version: string, key: Buffer, node: IdxNode): Promise<[number, number] | null> {
  if (!node.keys.length) return null
  let where = node.keys.length
  for (let i = 0; i < node.keys.length; i++) {
    const cmp = Buffer.compare(key, node.keys[i])
    if (cmp === 0) return node.datas[i]
    if (cmp < 0) {
      where = i
      break
    }
  }
  if (node.subnodes.every((s) => s === 0)) return null // leaf
  return idxBSearch(version, key, await idxNodeAt(version, node.subnodes[where]))
}

async function idsFromIdxData(version: string, data: [number, number]): Promise<number[]> {
  const [offset, length] = data
  const r = await httpsGetFull(`${ltn()}/galleriesindex/galleries.${version}.data`, {
    range: `bytes=${offset}-${offset + length - 1}`
  })
  const buf = r.body
  if (buf.length < 4) return []
  const n = buf.readInt32BE(0)
  const ids: number[] = []
  let pos = 4
  for (let i = 0; i < n && pos + 4 <= buf.length; i++) {
    ids.push(buf.readInt32BE(pos))
    pos += 4
  }
  return ids
}

// Gallery ids that contain a single search WORD (free-text search).
async function searchTextIds(term: string): Promise<number[]> {
  const word = term.toLowerCase().trim()
  if (!word) return []
  try {
    const version = await galleriesIndexVersion()
    const data = await idxBSearch(version, hashTerm(word), await idxNodeAt(version, 0))
    return data ? idsFromIdxData(version, data) : []
  } catch {
    return []
  }
}

// Full gallery-id list for one language (for filtering text-search results).
const langIndexCache = new Map<string, { ids: number[]; at: number }>()
async function languageIndexIds(lang: string): Promise<number[]> {
  const cached = langIndexCache.get(lang)
  if (cached && Date.now() - cached.at < 600_000) return cached.ids
  try {
    const r = await httpsGetFull(`${ltn()}/index-${lang}.nozomi`)
    const ids = idsFromBuf(r.body)
    langIndexCache.set(lang, { ids, at: Date.now() })
    return ids
  } catch {
    return []
  }
}

// Candidate nozomi base paths (without `-lang.nozomi`) for a search token.
// Namespaced tokens map to their folder; a plain tag is tried as a generic tag
// and as a gendered tag, since doujin files many tags as "female:x"/"male:x".
function basesForToken(token: string): string[] {
  const q = token.toLowerCase().trim()
  const ci = q.indexOf(':')
  // doujin tag files use SPACES in the name (e.g. `female:big breasts`, URL as
  // %20), but chips/SearchBuilder emit underscores (`big_breasts`). Try the space
  // form FIRST (the real scheme), then the underscore form as a fallback.
  const forms = (s: string): string[] => {
    const t = s.trim()
    const space = t.replace(/_/g, ' ')
    const under = t.replace(/\s+/g, '_')
    return [...new Set([space, under, t].filter(Boolean))]
  }
  if (ci !== -1) {
    const ns = q.slice(0, ci)
    const rs = forms(q.slice(ci + 1))
    switch (ns) {
      case 'artist':
        return rs.map((r) => `/artist/${r}`)
      case 'group':
        return rs.map((r) => `/group/${r}`)
      case 'series':
      case 'parody':
        return rs.map((r) => `/series/${r}`)
      case 'character':
        return rs.map((r) => `/character/${r}`)
      case 'type':
        return rs.map((r) => `/type/${r}`)
      case 'male':
        return rs.map((r) => `/tag/male:${r}`)
      case 'female':
        return rs.map((r) => `/tag/female:${r}`)
      case 'tag':
        // rest may itself be "female:x" (from a clicked chip)
        return rs.flatMap((r) => [`/tag/${r}`, `/tag/female:${r}`, `/tag/male:${r}`])
      default:
        return rs.map((r) => `/tag/${ns}:${r}`)
    }
  }
  // Plain token: try it as a generic/gendered tag, and also as an artist / series
  // / character / group name, so a plainly-typed name resolves without a prefix.
  const out: string[] = []
  for (const r of forms(q)) {
    out.push(
      `/tag/${r}`,
      `/tag/female:${r}`,
      `/tag/male:${r}`,
      `/artist/${r}`,
      `/series/${r}`,
      `/character/${r}`,
      `/group/${r}`
    )
  }
  return out
}

// Full id list for one search token (language-agnostic; language is filtered
// once at the end). A namespaced token (tag:/artist:/female:/…) resolves via its
// nozomi index; a plain word uses the full-text search index (title + tags).
async function fetchTokenIds(token: string, _lang: string): Promise<number[]> {
  const q = token.toLowerCase().trim()
  if (q.includes(':')) {
    for (const base of basesForToken(q)) {
      try {
        const r = await httpsGetFull(`${ltn()}${base}-all.nozomi`)
        const ids = idsFromBuf(r.body)
        if (ids.length) return ids
      } catch {
        /* try next candidate */
      }
    }
    return []
  }
  return searchTextIds(q)
}

// Multi-token search = intersection of positive tokens (AND, space-separated),
// minus any negative tokens (prefixed with '-', e.g. "-female:netorare").
// sort='popular' reorders the matched ids by site popularity (year).
// Split a search query into tokens. When the query contains commas, they are the
// token separators (so multi-word tags like "female:sole female" stay intact —
// this is what the tag/artist chips insert). Otherwise fall back to a quote-aware
// whitespace split, keeping "quoted phrases" (incl. namespaced tag:"big breasts")
// as one token. Quotes are stripped.
function tokenizeQuery(raw: string): string[] {
  if (raw.includes(',')) {
    return raw
      .split(',')
      .map((t) => t.replace(/"/g, '').trim())
      .filter(Boolean)
  }
  const out: string[] = []
  const re = /[^\s"]*"[^"]*"|\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) out.push(m[0].replace(/"/g, ''))
  return out.filter(Boolean)
}

export async function searchNozomi(
  query: string,
  language: string | null,
  page: number,
  pageSize: number,
  sort: 'date' | 'popular' = 'date'
): Promise<NozomiPage> {
  const lang = language || 'all'
  // Quote-aware split: a "quoted phrase" (incl. a namespaced tag:"big breasts")
  // stays ONE token so multi-word tags survive. Plain whitespace still ANDs.
  const raw = tokenizeQuery(query)
  const positives = raw.filter((t) => !t.startsWith('-'))
  const negatives = raw.filter((t) => t.startsWith('-')).map((t) => t.slice(1)).filter(Boolean)
  // No positive token: nothing to anchor on — fall back to index browse (still
  // honoring the "-tag" exclusions).
  if (!positives.length) return fetchNozomiExcluding({ kind: 'index', language }, page, pageSize, negatives)

  let inter: number[] | null = null
  for (const tok of positives) {
    const ids = await fetchTokenIds(tok, lang)
    if (inter === null) inter = ids
    else {
      const set = new Set(ids)
      inter = inter.filter((x) => set.has(x))
    }
    if (inter.length === 0) break
  }
  let all = inter ?? []

  // Subtract excluded tokens.
  for (const tok of negatives) {
    if (!all.length) break
    const ids = await fetchTokenIds(tok, lang)
    if (!ids.length) continue
    const set = new Set(ids)
    all = all.filter((x) => !set.has(x))
  }

  // Language filter: text-search / all-nozomi ids are language-agnostic, so keep
  // only ids present in the chosen language index (doujin does the same).
  if (lang !== 'all' && all.length) {
    const langSet = new Set(await languageIndexIds(lang))
    if (langSet.size) all = all.filter((x) => langSet.has(x))
  }

  if (sort === 'popular' && all.length) {
    const rank = await popularRankMap('year')
    const INF = Number.MAX_SAFE_INTEGER
    all = all
      .map((id, i) => ({ id, r: rank.get(id) ?? INF, i }))
      .sort((a, b) => a.r - b.r || a.i - b.i) // ranked first, then keep date order
      .map((x) => x.id)
  }

  return { ids: all.slice(page * pageSize, page * pageSize + pageSize), total: all.length }
}

// Site popularity ranking (lower = more popular). Caches the full id->rank map
// for a period, returns just the requested codes' ranks.
const popularCache = new Map<string, Map<number, number>>()
async function popularRankMap(period: string): Promise<Map<number, number>> {
  let m = popularCache.get(period)
  if (m) return m
  const r = await httpsGetFull(`${ltn()}/popular/${period}-all.nozomi`)
  const ids = idsFromBuf(r.body)
  m = new Map()
  for (let i = 0; i < ids.length; i++) m.set(ids[i], i)
  popularCache.set(period, m)
  return m
}

export async function popularRanks(codes: string[], period = 'year'): Promise<Record<string, number>> {
  const m = await popularRankMap(period)
  const out: Record<string, number> = {}
  for (const c of codes) {
    const r = m.get(Number(c))
    if (r !== undefined) out[c] = r
  }
  return out
}

export async function summary(code: string): Promise<{
  code: string
  title: string
  artists: string[]
  tags: string[]
  language: string | null
  type: string | null
  pageCount: number
  thumbUrl: string | null
}> {
  const raw = await fetchRawGallery(code)
  const meta = toMeta(raw)
  const first = raw.files[0]
  return {
    code: meta.code,
    title: meta.title,
    artists: meta.artists,
    tags: meta.tags,
    language: meta.language,
    type: meta.type,
    pageCount: meta.pageCount,
    thumbUrl: first ? thumbnailUrl(first.hash, !!first.hasavif) : null
  }
}

export type Summary = Awaited<ReturnType<typeof summary>>

async function summaryOrNull(code: string): Promise<Summary | null> {
  try {
    return await summary(code)
  } catch {
    return null
  }
}

// Find Korean editions of a work. Precise path: the doujin site's own `languages` map on
// the coded gallery. Fallback: the artist's Korean galleries ranked by title
// similarity. Returns Korean-language summaries (raw thumb urls).
export async function findKorean(payload: {
  code: string | null
  artist: string | null
  title: string
}): Promise<Summary[]> {
  const out = new Map<string, Summary>()

  if (payload.code) {
    try {
      const raw = await fetchRawGallery(payload.code)
      const koCodes = (raw.languages ?? [])
        .filter((l) => l.name?.toLowerCase() === 'korean')
        .map((l) => String(l.galleryid))
        .filter((c) => c && c !== payload.code)
      const sums = await Promise.all(koCodes.map(summaryOrNull))
      for (const s of sums) if (s) out.set(s.code, s)
    } catch {
      /* fall through to artist search */
    }
  }

  if (out.size === 0 && payload.artist) {
    const artist = payload.artist.split(',')[0].trim()
    if (artist) {
      const ids = (await fetchTokenIds(`artist:${artist}`, 'korean')).slice(0, 40)
      const scored: { s: Summary; score: number }[] = []
      const limit = 6
      for (let i = 0; i < ids.length; i += limit) {
        const batch = ids.slice(i, i + limit)
        const sums = await Promise.all(batch.map((id) => summaryOrNull(String(id))))
        for (const s of sums) {
          if (!s) continue
          const score = titleSim(payload.title, s.title, 'loose')
          if (score >= 0.34) scored.push({ s, score })
        }
      }
      scored.sort((a, b) => b.score - a.score)
      for (const { s } of scored) out.set(s.code, s)
    }
  }

  return [...out.values()]
}

// Full-size image urls for online reading (no download).
export async function readImageUrls(code: string): Promise<string[]> {
  const raw = await fetchRawGallery(code)
  const ctx = await getImageContext()
  return raw.files.map((f) => imageUrl(f.hash, pickExt(f), ctx))
}
