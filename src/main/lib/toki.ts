// General-manga online source: 뉴토끼(newtoki)-style mirror, default sbxh9.com.
//
// The site is a React SPA behind a Cloudflare bot challenge. The CF "Just a
// moment" / Turnstile check can NOT be solved headlessly — so when we hit it we
// SHOW the window and let the user clear it by hand once; the clearance cookie
// then persists in our `persist:toki` session, so later loads stay hidden.
//
// Real structure (verified against saved pages, 2026-07):
//   manga list   : /manhwa            webtoon list : /ing
//   search       : /search?q=<kw>&field=title&match=contains
//   series page  : /manhwa/<id>  or  /webtoon/<id>
//   chapter page : /<type>/<id>/<chapterId>
// Sort / genre / page on a list are client-side React buttons (no URL params),
// so we drive them by clicking in-page, then scrape `a.card`. Chapter rows are
// `li.ep-row-v2 > a.ep-row-v2-link`; chapter images are tuned live (no saved
// viewer page).
import { BrowserWindow, session, app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { dohAnswers } from './doh'
import type {
  TokiListSource,
  TokiSort,
  TokiType,
  TokiChapter,
  TokiListResult,
  TokiSummary
} from '../../shared/ipc'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
// Persistent session of the scraper window (keeps the Cloudflare clearance).
export const TOKI_PARTITION = 'persist:toki'
const PARTITION = TOKI_PARTITION

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Sort tab labels as they appear on the site (we click the matching button).
const SORT_LABEL: Record<TokiSort, string> = {
  date: '최신순',
  new: '신작순',
  bookmark: '북마크순',
  view: '조회순',
  rating: '평점순',
  chapter: '화수순'
}

// --- hidden window (lazy, reused, serialized) ---
let win: BrowserWindow | null = null
let chain: Promise<unknown> = Promise.resolve()

// Notified when a Cloudflare challenge needs the user (window popped) and when it
// clears, so the app can show/hide an "인증이 필요합니다" banner. Set by main.
let onChallenge: ((active: boolean) => void) | null = null
export function setTokiChallengeHandler(fn: (active: boolean) => void): void {
  onChallenge = fn
}

// The scraper window's 'close' handler vetoes close (keeps the session alive), but
// that veto would also cancel app.quit() and strand the process in the background.
// Force-destroy it as soon as the app starts quitting so shutdown is clean.
app.on('before-quit', () => {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
})

function getWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 880,
    title: '일반 만화 온라인 — 인증',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      javascript: true,
      backgroundThrottling: false,
      sandbox: false,
      // Main-world preload that kills WebRTC/STUN + automation tells so the
      // Cloudflare / block.js challenge stops looping. (out/preload/toki.mjs)
      contextIsolation: false,
      preload: join(__dirname, '../preload/toki.mjs')
    }
  })
  win.webContents.setUserAgent(UA)
  blockHiddenMedia()
  // Don't actually destroy on user close — just hide, so the session survives.
  win.on('close', (e) => {
    e.preventDefault()
    win?.hide()
  })
  // If the scrape window's renderer actually crashes, drop it so getWindow()
  // rebuilds a fresh one on the next call. NB: do NOT hook 'unresponsive' — the
  // Cloudflare/SPA page goes briefly unresponsive while it works, and destroying
  // the window mid-navigation was leaving the first list load talking to a blank
  // recreated window (empty results).
  win.webContents.on('render-process-gone', () => {
    try {
      win?.destroy()
    } catch {
      /* already gone */
    }
    win = null
  })
  return win
}

// The hidden scraper only reads DOM attributes (card links, data-src urls) — it
// never needs the pixels. Skip images/media/fonts it would load (covers, ads,
// banners): on a slow connection those dominated page-load time. Only for the
// scraper window while HIDDEN — when shown (Cloudflare check, backup site) the
// page loads normally. Cover/page fetches via session.fetch carry no
// webContentsId, so they're unaffected.
let mediaBlockOn = false
function blockHiddenMedia(): void {
  if (mediaBlockOn) return
  mediaBlockOn = true
  session.fromPartition(PARTITION).webRequest.onBeforeRequest((d, cb) => {
    const w = win && !win.isDestroyed() ? win : null
    const block =
      !!w &&
      !w.isVisible() &&
      d.webContentsId === w.webContents.id &&
      (d.resourceType === 'image' || d.resourceType === 'media' || d.resourceType === 'font')
    cb({ cancel: block })
  })
}

// True once the user has a Cloudflare clearance cookie for the toki domain.
async function hasClearance(): Promise<boolean> {
  try {
    const cookies = await session.fromPartition(PARTITION).cookies.get({ name: 'cf_clearance' })
    return cookies.length > 0
  } catch {
    return false
  }
}

// Compare urls ignoring trailing slash + hash (SPA route fragments).
function sameUrl(a: string, b: string): boolean {
  const norm = (u: string): string => u.replace(/#.*$/, '').replace(/\/+$/, '')
  return !!a && !!b && norm(a) === norm(b)
}

function queue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}

interface Probe {
  challenge: boolean
  ready: boolean
  url: string
}
// Detect a Cloudflare interstitial vs. real content.
const PROBE = `(() => {
  const t = (document.title || '')
  const cf = document.querySelector('#challenge-form,#challenge-running,#challenge-stage,.cf-browser-verification,#cf-please-wait,iframe[src*="challenges.cloudflare"]')
  const challenge = !!cf || /just a moment|just amoment|잠시만|확인 중|attention required|사람인지 확인/i.test(t)
  const ready = !!document.querySelector('a.card, .ep-row-v2-link, .ep-list-v2, .vw-imgs, img.viewer-lazy-img, .filter .chips, .view-content img, .toon-content img, #viewer img, .viewer img')
  return { challenge, ready, url: location.href }
})()`

// executeJavaScript can hang forever if the page navigates and destroys the JS
// context mid-eval (the promise then never settles). Since all scraping is
// serialized through one queue, a single hang would freeze every later call
// ("불러오는 중…" forever). Race every eval against a timeout so the queue can
// always make progress.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((r) => setTimeout(() => r(fallback), ms))
  ])
}

const probe = async (w: BrowserWindow): Promise<Probe | null> => {
  return withTimeout(
    w.webContents.executeJavaScript(PROBE, true) as Promise<Probe | null>,
    6000,
    null
  )
}

// Navigate, settle, and clear any CF challenge (showing the window so the user
// can solve it by hand). Resolves once real content is present.
//
// Key anti-loop rule: if we're ALREADY on this url with content rendered, do not
// reload — reloading re-arms the managed challenge and makes the bot window pop
// over and over when several scrape calls queue up. The cf_clearance cookie
// covers the whole domain, so once solved, later same-host loads pass silently.
// --- blocked-domain fallback ---------------------------------------------------
// Some networks reset every TLS connection that names the site's domain (SNI
// filtering: ERR_CONNECTION_RESET while DNS is fine). The site is served by a
// CDN under its own hostname — the domain's CNAME (e.g. sbxh9.com →
// sbxh9f.b-cdn.net) — which isn't filtered and serves the same site. So on a
// reset we look the CNAME up over DoH and load the page via that host instead.
// URLs handed back to the app are mapped to the original domain again, so
// favorites / history keep one canonical form.
const altHost = new Map<string, string>() // blocked host → CDN host
const altTried = new Set<string>()

const mapHost = (url: string, from: (h: string) => string | undefined): string => {
  try {
    const u = new URL(url)
    const to = from(u.hostname)
    if (!to) return url
    u.hostname = to
    return u.href
  } catch {
    return url
  }
}
// Address actually used to reach `url` (the CDN host once its domain is blocked).
const toAlt = (url: string): string => mapHost(url, (h) => altHost.get(h))
// Back to the canonical domain for anything returned to the app.
const fromAlt = (url: string): string =>
  mapHost(url, (h) => [...altHost].find(([, alt]) => alt === h)?.[0])

// After a reset on `url`'s host: switch it to its CDN alias (once per host).
// True when a switch happened (the caller reloads via toAlt).
async function switchToAlt(url: string): Promise<boolean> {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  if (altHost.has(host) || altTried.has(host)) return false
  altTried.add(host)
  const cname = (await dohAnswers(host, 'CNAME')).find((a) => a.type === 5)?.data.replace(/\.$/, '')
  if (!cname || cname === host) return false
  altHost.set(host, cname)
  return true
}

// Only ERR_CONNECTION_RESET is retried: some networks reset the connection
// intermittently (in a browser you'd just hit refresh a few times). Other
// failures fail fast as before.
const RETRY_CODES = new Set([-101])
const MAX_RETRIES = 10
const retryDelay = (n: number): number => Math.min(400 * n, 2000)

async function ensure(url: string, needContent: boolean): Promise<void> {
  const w = getWindow()
  let target = toAlt(url)
  if (sameUrl(w.webContents.getURL(), target)) {
    const p = await probe(w)
    if (p && !p.challenge && (p.ready || !needContent)) return // already good — no reload
  }
  // Don't wait for the full load (every ad/script/subresource — slow links made
  // this take many seconds): start probing as soon as the new document's DOM is
  // ready. Client redirects reject loadURL → ignore; the 45s cap keeps a stuck
  // navigation from blocking the shared queue.
  let failCode = 0
  const onFail = (_e: unknown, code: number, _d: string, _u: string, isMain: boolean): void => {
    if (isMain && RETRY_CODES.has(code)) failCode = code
  }
  w.webContents.on('did-fail-load', onFail)
  let nav: Promise<undefined> = Promise.resolve(undefined)
  const load = async (): Promise<void> => {
    failCode = 0
    const domReady = new Promise<void>((r) => w.webContents.once('dom-ready', () => r()))
    nav = withTimeout(w.loadURL(target).then(() => undefined), 45000, undefined)
    await Promise.race([domReady, nav])
  }
  // Initial load, re-tried while the connection itself fails.
  let retries = 0
  await load()
  while (failCode && retries < MAX_RETRIES) {
    retries++
    // First reset on this host → go through its CDN alias right away.
    if (await switchToAlt(url)) target = toAlt(url)
    else await delay(retryDelay(retries))
    await load()
  }
  let shown = false
  const start = Date.now()
  for (let first = true; ; first = false) {
    if (!first) await delay(300)
    // Connection reset after DOM-ready (late failure) → reload.
    if (failCode && retries < MAX_RETRIES) {
      retries++
      if (await switchToAlt(url)) target = toAlt(url)
      else await delay(retryDelay(retries))
      await load()
      continue
    }
    const p = await probe(w)
    if (!p) {
      if (Date.now() - start > 8000 && !needContent) break
      if (Date.now() - start > 30000) break
      continue
    }
    if (p.challenge && !(await hasClearance())) {
      // Still being challenged and no clearance cookie yet → let the user solve.
      if (!shown) {
        shown = true
        w.show()
        w.focus()
        onChallenge?.(true) // tell the app to show the "인증 필요" banner
      }
      if (Date.now() - start > 180000) break // give up after 3 min
      continue
    }
    if (p.ready) break
    // No content selector needed → done once the page has fully loaded.
    if (!needContent && (await Promise.race([nav.then(() => true), delay(0).then(() => false)]))) break
    if (!needContent && Date.now() - start > 8000) break
    if (Date.now() - start > 30000) break // content never matched selectors → scrape anyway
  }
  // Only hide if we popped it open for a challenge AND it's now resolved, so the
  // user isn't left staring at a blank window — but don't thrash on every call.
  w.webContents.removeListener('did-fail-load', onFail)
  if (shown && win && !win.isDestroyed() && (await hasClearance())) win.hide()
  if (shown) onChallenge?.(false) // clear the banner (solved, or gave up)
}

async function evalPage<T>(script: string, fallback: T): Promise<T> {
  const w = getWindow()
  // 30s cap: the in-page list script clicks + waits (≤~10s normally); a longer
  // wait means the context was torn down by a navigation → bail to the fallback.
  return withTimeout(w.webContents.executeJavaScript(script, true) as Promise<T>, 30000, fallback)
}

// Sort tab → the site's `sort` query value (verified 2026-10; 최신순 = none).
const SORT_PARAM: Record<TokiSort, string> = {
  date: '',
  new: 'fresh',
  bookmark: 'hot',
  view: 'views',
  rating: 'rating',
  chapter: 'episodes'
}

// The list now mirrors its state in the URL (?g=<genre>&sort=<key>&page=<n>,
// search: &page=<n>), so open the exact page directly instead of loading page 1
// and clicking through genre/sort/pager (that took seconds per call and forced
// a reload whenever the previous click had changed the URL). 1-based `page`.
function listUrl(base: string, src: TokiListSource, page: number): string {
  const b = base.replace(/\/+$/, '')
  const u = new URL(
    src.query && src.query.trim() ? `${b}/search` : src.type === 'webtoon' ? `${b}/ing` : `${b}/manhwa`
  )
  if (src.query && src.query.trim()) {
    u.searchParams.set('q', src.query.trim())
    // Author search matches the site's author links (exact); title = contains.
    u.searchParams.set('field', src.field === 'author' ? 'author' : 'title')
    u.searchParams.set('match', src.field === 'author' ? 'exact' : 'contains')
  } else {
    if (src.genre && src.genre !== '전체') u.searchParams.set('g', src.genre)
    if (SORT_PARAM[src.sort]) u.searchParams.set('sort', SORT_PARAM[src.sort])
  }
  if (page > 1) u.searchParams.set('page', String(page))
  return u.href
}

// In-page: apply genre + sort + page (client-side React buttons), then scrape
// the cards and the available genre chips. Runs async (awaits re-renders).
function listScript(genre: string, sortLabel: string, page: number): string {
  const G = JSON.stringify(genre)
  const S = JSON.stringify(sortLabel)
  return `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const abs = (u) => { try { return new URL(u, location.href).href } catch { return u } }
  const txt = (el) => (el ? el.textContent : '').replace(/\\s+/g, ' ').trim()
  const chipText = (c) => { const f = c.querySelector('.chip-name-full'); return f ? txt(f) : txt(c) }
  // Wait until the card list re-renders (first card href changes), max ~2.5s,
  // instead of a fixed sleep after every click.
  const cardsSig = () => [...document.querySelectorAll('a.card')].slice(0, 3).map((a) => a.getAttribute('href')).join('|')
  const afterClick = async (before) => {
    for (let i = 0; i < 25; i++) { await sleep(100); if (cardsSig() !== before) { await sleep(150); return } }
  }
  // genre
  if (${G} && ${G} !== '전체') {
    const chips = [...document.querySelectorAll('.filter .chips button.chip, .chips button.chip')]
    const g = chips.find((c) => chipText(c) === ${G} || (c.title || '').includes(${G}))
    if (g && !g.classList.contains('active')) { const b = cardsSig(); g.click(); await afterClick(b) }
  }
  // sort
  if (${S}) {
    const tabs = [...document.querySelectorAll('.sort-tabs button')]
    const s = tabs.find((b) => txt(b).includes(${S}))
    if (s && !s.classList.contains('active')) { const b = cardsSig(); s.click(); await afterClick(b) }
  }
  // page: the pager shows a 10-number window (desktop; mobile = 5) plus
  // "이전/다음 10페이지" buttons. Click the number when visible, else shift the
  // window toward it. Only the DESKTOP pager is used — the old code took the last
  // .pager-btn in the document, which is the mobile "끝" edge → jumped to the
  // last page, so nothing past page 10 was reachable.
  const target = ${page}
  const pager = () => document.querySelector('.pager-window--desktop') || document.querySelector('.pager')
  const curPage = () => { const a = pager() && pager().querySelector('.pager-num.is-active'); return a ? parseInt(txt(a)) || 1 : 1 }
  const nums = () => [...((pager() && pager().querySelectorAll('.pager-num')) || [])].map((b) => parseInt(txt(b))).filter((n) => !isNaN(n))
  const sig = () => curPage() + ':' + nums().join(',')
  // Wait for the React pager to re-render (active page or window changed).
  const settle = async (before) => {
    for (let i = 0; i < 50; i++) { await sleep(150); if (sig() !== before) { await sleep(350); return true } }
    return false
  }
  for (let guard = 0; guard < 200; guard++) {
    if (curPage() === target) break
    const p = pager(); if (!p) break
    const before = sig()
    const direct = [...p.querySelectorAll('.pager-num')].find((b) => parseInt(txt(b)) === target)
    if (direct) { direct.click(); await settle(before); continue }
    const ns = nums()
    const fwd = !ns.length || target > Math.max(...ns)
    const btn = p.querySelector(fwd ? '.pager-btn[aria-label^="다음"]' : '.pager-btn[aria-label^="이전"]')
    if (!btn || btn.disabled) {
      // Past the end → land on the last visible page instead of stopping mid-window.
      if (fwd && ns.length && curPage() !== Math.max(...ns)) {
        const lastBtn = [...p.querySelectorAll('.pager-num')].find((b) => parseInt(txt(b)) === Math.max(...ns))
        if (lastBtn) { lastBtn.click(); await settle(before) }
      }
      break
    }
    btn.click()
    if (!(await settle(before))) break
  }
  // scrape
  const out = []
  const seen = new Set()
  // Coerce a card link to the SERIES page (/type/id). Search-result cards often
  // point at the latest chapter (/type/id/chapter); opening that would scrape a
  // viewer with no chapter list → "화 목록을 찾지 못했습니다".
  const seriesUrl = (raw) => {
    try {
      const u = new URL(raw)
      const p = u.pathname.split('/').filter(Boolean)
      if (p.length > 2) { u.pathname = '/' + p.slice(0, 2).join('/'); u.search = ''; u.hash = '' }
      return u.href
    } catch { return raw }
  }
  for (const a of document.querySelectorAll('a.card')) {
    let url = abs(a.getAttribute('href')); if (!url) continue
    url = seriesUrl(url); if (seen.has(url)) continue
    // The first .thumb img is the source-platform logo (naver/kakao …); the real
    // cover is the img without the .platform-icon class.
    const img = a.querySelector('.thumb img:not(.platform-icon)') || a.querySelector('.thumb img')
    let thumb = img ? (img.getAttribute('data-src') || img.getAttribute('src')) : null
    if (thumb) thumb = abs(thumb)
    const title = txt(a.querySelector('.info .subject')) || (img && img.alt) || txt(a)
    if (!title) continue
    const genre = txt(a.querySelector('.info .genre')) || null
    const chapter = txt(a.querySelector('.info .ep .ep-no')) || null
    // Author isn't on the list card (only the series page) → artist stays null.
    seen.add(url); out.push({ url, title, thumb, artist: null, genre, chapter })
  }
  const genres = [...document.querySelectorAll('.filter .chips button.chip')].map(chipText).filter(Boolean)
  const vis = nums()
  const maxNum = vis.length ? Math.max(...vis) : 1
  const cur = curPage()
  // More pages beyond the visible window → the "다음 10페이지" button is enabled.
  const nextWin = pager() && pager().querySelector('.pager-btn[aria-label^="다음"]')
  const hasNext = cur < maxNum || (!!nextWin && !nextWin.disabled)
  return { items: out, hasNext, genres, page: cur }
})()`
}

const CHAPTERS_SCRIPT = `(() => {
  const abs = (u) => { try { return new URL(u, location.href).href } catch { return u } }
  const txt = (el) => (el ? el.textContent : '').replace(/\\s+/g, ' ').trim()
  // Strip a leading "UP"/"NEW"/"N" badge word that got glued to the title.
  const clean = (t) => t.replace(/^\\s*(?:UP|NEW)\\s*/i, '').replace(/^N(?=\\d)/, '').trim()
  let rows = [...document.querySelectorAll('a.ep-row-v2-link, li.ep-row-v2 a[href], .ep-list-v2 a[href]')]
  // Fallback (site class names change over time): every link whose path is the
  // series path + one more segment is a chapter (e.g. /webtoon/123 → /webtoon/123/xyz).
  if (rows.length === 0) {
    const base = location.pathname.replace(/\\/+$/, '')
    rows = [...document.querySelectorAll('a[href]')].filter((a) => {
      try {
        const p = new URL(abs(a.getAttribute('href'))).pathname.replace(/\\/+$/, '')
        return p.indexOf(base + '/') === 0 && p.slice(base.length + 1).indexOf('/') < 0
      } catch { return false }
    })
  }
  const out = []
  const seen = new Set()
  for (const a of rows) {
    const url = abs(a.getAttribute('href')); if (!url || seen.has(url)) continue
    // Query <strong> directly (not '.ep-row-v2-title', which in tree order
    // precedes its own <strong> and would swallow the "UP"/"N" badge span).
    const strong = a.querySelector('.ep-row-v2-title strong') || a.querySelector('.ep-row-v2-title')
    const noEl = a.querySelector('.ep-row-v2-no')
    let title = clean(txt(strong) || txt(a))
    if (!title || /^(이전|다음|목록|처음|댓글|맨위|공유)$/.test(title)) continue
    let num = 0
    const m = title.match(/(\\d+(?:\\.\\d+)?)\\s*(?:화|회|장|권)/) || title.match(/(\\d+)/)
    if (m) num = parseFloat(m[1])
    if (!num && noEl) num = parseInt((noEl.textContent || '').replace(/[^0-9]/g, '')) || 0
    seen.add(url); out.push({ url, title, num })
  }
  // Episode list is paged (?epage=N, newest first). Report the last page so the
  // caller can walk the rest; reversal to reading order happens after merging.
  let last = 1
  for (const l of document.querySelectorAll('.episode-pager a[href*="epage="], a.pager-num[href*="epage="], a.pager-edge[href*="epage="]')) {
    try { const n = parseInt(new URL(abs(l.getAttribute('href'))).searchParams.get('epage') || '1'); if (n > last) last = n } catch {}
  }
  return { items: out, last }
})()`

// Chapter viewer → image urls. Verified (2026-07): page images are
// <img class="viewer-lazy-img" data-src="<real cdn url>" alt="page N"> inside
// .vw-imgs; the real URL is in data-src (present at load, no scroll needed).
// Ad images have no viewer-lazy-img class, so this never picks them up. Image
// host varies per chapter (booktoki/…); referer = the toki domain (set by
// fetchTokiBuffer). img_list kept as a legacy fallback.
const READ_SCRIPT = `(() => {
  const abs = (u) => { if (!u) return null; if (u.startsWith('//')) return 'https:' + u; try { return new URL(u, location.href).href } catch { return u } }
  const out = []
  const seen = new Set()
  // Reject obvious non-content images (logos, icons, avatars, ads, blank pixels).
  const uiBad = /logo|icon|sprite|banner|avatar|profile|button|btn|blank|loading|spinner|placeholder|\\/ads?[\\/_.]|adsby|1x1|pixel/i
  const push = (s) => { s = abs(s); if (s && !seen.has(s) && /^https?:/.test(s) && !uiBad.test(s)) { seen.add(s); out.push(s) } }
  // A viewer <img>'s real source can hide behind any of several lazy-load attrs.
  const lazy = (img) => img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-echo') || img.getAttribute('data-lazy') || img.getAttribute('data-url') || img.getAttribute('src')
  // 1) Known + likely viewer containers (site keeps renaming these).
  const conts = ['.vw-imgs', '.view-content', '.view-padding', '#view-content', '.toon-content', '.viewer', '.viewer-img', '#viewer', '.chapter-content', '.page-content', '.view-wrap', '.read-content', '.image-content', '.comic-page', 'article']
  let imgs = []
  for (const c of conts) { const f = document.querySelectorAll(c + ' img'); if (f.length) imgs = imgs.concat(Array.from(f)) }
  imgs = imgs.concat(Array.from(document.querySelectorAll('img.viewer-lazy-img, img[data-src], img[data-original], img[data-lazy]')))
  for (const img of imgs) push(lazy(img))
  // 2) JS array of urls embedded in a <script> (img_list / images / all_imgs / …).
  if (out.length === 0) {
    for (const s of document.querySelectorAll('script')) {
      const h = s.innerHTML
      const m = h.match(/(?:img_list|image_list|images|all_imgs|photos)\\s*=\\s*(\\[[\\s\\S]*?\\])/)
      if (m) {
        try { const p = JSON.parse(m[1]); if (Array.isArray(p)) p.forEach((x) => push(typeof x === 'string' ? x : (x && (x.src || x.url)))) }
        catch { (m[1].match(/["']([^"']+)["']/g) || []).forEach((u) => push(u.replace(/["']/g, ''))) }
        if (out.length) break
      }
    }
  }
  // 3) Last resort: every image on the page that looks like a content page file.
  if (out.length === 0) {
    for (const img of document.querySelectorAll('img')) {
      const u = lazy(img)
      if (u && /\\.(jpe?g|png|webp|gif)(\\?|$)/i.test(u)) push(u)
    }
  }
  return out
})()`

export async function tokiList(base: string, src: TokiListSource, page: number): Promise<TokiListResult> {
  return queue(async () => {
    // URL already selects genre/sort/page; the in-page script then finds them
    // active and does nothing (its clicking stays as a fallback).
    await ensure(listUrl(base, src, page + 1), true)
    // On a search results page there are no genre/sort tabs to drive — passing
    // '전체'/'' skips those in-page clicks (which would otherwise no-op or churn).
    const r = await evalPage<{ items: TokiListResult['items']; hasNext: boolean; genres: string[]; page?: number }>(
      listScript(src.query ? '전체' : src.genre, src.query ? '' : SORT_LABEL[src.sort], page + 1),
      { items: [], hasNext: false, genres: [] }
    )
    // r.page = where the site actually landed (a jump past the end stops at the
    // last page) → report it so the UI shows the real page.
    const landed = r.page && r.page > 0 ? r.page - 1 : page
    const items = (r.items ?? []).map((it) => ({ ...it, url: fromAlt(it.url) }))
    return { items, page: landed, hasNext: !!r.hasNext, genres: r.genres ?? [] }
  })
}

export async function tokiChapters(seriesUrl: string): Promise<TokiChapter[]> {
  return queue(async () => {
    type R = { items: TokiChapter[]; last: number }
    await ensure(seriesUrl, true)
    const first = await evalPage<R>(CHAPTERS_SCRIPT, { items: [], last: 1 })
    const all = [...(first.items ?? [])]
    const seen = new Set(all.map((c) => c.url))
    // Walk every other episode page (?epage=2..last). Built from seriesUrl, not
    // the scraped href, so a mirror-domain link can't send us elsewhere.
    const last = Math.min(first.last || 1, 200)
    for (let p = 2; p <= last; p++) {
      const u = new URL(seriesUrl)
      u.searchParams.set('epage', String(p))
      await ensure(u.href, true)
      const r = await evalPage<R>(CHAPTERS_SCRIPT, { items: [], last: 1 })
      for (const c of r.items ?? []) if (!seen.has(c.url)) { seen.add(c.url); all.push(c) }
    }
    // Site lists newest-first → ascending reading order; canonical domain.
    return all.reverse().map((c) => ({ ...c, url: fromAlt(c.url) }))
  })
}

// Author(s) of a series, from the "작가 … 다른 작품 검색" links on its page.
const AUTHOR_SCRIPT = `(() => {
  const seen = new Set(); const out = []
  for (const a of document.querySelectorAll('a[href*="field=author"]')) {
    const t = (a.textContent || '').replace(/\\s+/g, ' ').trim()
    if (t && !seen.has(t)) { seen.add(t); out.push(t) }
  }
  return out.length ? out.join(', ') : null
})()`

export async function tokiSeriesAuthor(seriesUrl: string): Promise<string | null> {
  return queue(async () => {
    await ensure(seriesUrl, true)
    return evalPage<string | null>(AUTHOR_SCRIPT, null)
  })
}

// Series title from its page: the main heading. Selectors change over time, so
// try several, then fall back to document.title with the site suffix trimmed.
const TITLE_SCRIPT = `(() => {
  const txt = (el) => (el ? el.textContent : '').replace(/\\s+/g, ' ').trim()
  for (const sel of ['.view-title', '.view-content .title', '.toon-title', '.series-title', '.board-title', '.view-info .subject', 'h1.title', 'h1', '.subject']) {
    const t = txt(document.querySelector(sel))
    if (t) return t
  }
  const d = (document.title || '').replace(/\\s*[-|·—][^-|·—]*$/, '').trim()
  return d || null
})()`

export async function tokiSeriesTitle(seriesUrl: string): Promise<string | null> {
  return queue(async () => {
    await ensure(seriesUrl, true)
    return evalPage<string | null>(TITLE_SCRIPT, null)
  })
}

// Normalize a title for comparison: drop bracketed groups / decoration tags /
// separators, collapse spaces, lowercase.
function normTitle(s: string): string {
  return s
    .replace(/[[(【<{（][^\][)】>}）]*[\])】>}）]/g, ' ') // bracketed groups
    .replace(/[_~～〜·・|/\\]+/g, ' ') // separators
    .replace(/(완결|미리보기|단행본|연재|합본|무삭제|성인|시즌\s*\d+)/g, ' ') // decoration tags
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// Two search-query variants for a local title: the raw name and a bracket/tag-
// stripped version. Site search is `field=title&match=contains`, so a noisy
// local folder name ([작가], (완결), 단행본…) may only match once stripped.
// NOTE: no word-truncation variants — a generic short head matches the wrong
// series and, when trusted, mislabels every work's author.
function titleQueries(title: string): string[] {
  const raw = title.trim()
  const stripped = normTitle(raw)
  return stripped && stripped !== raw.toLowerCase() ? [raw, stripped] : [raw]
}

// Confirm a search result really is the queried work before trusting its
// metadata (author/cover). A loose `contains` search can return an unrelated
// first hit; requiring the normalized titles to contain one another guards
// against applying a wrong author to a whole library.
function titleMatches(query: string, resultTitle: string): boolean {
  const a = normTitle(query)
  const b = normTitle(resultTitle)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

// Run the title search over the query variants and return the first result that
// both satisfies `pick` AND whose title matches the query (so we never accept an
// arbitrary hit from a broad search).
async function firstMatch(
  base: string,
  title: string,
  pick: (it: TokiSummary) => boolean
): Promise<TokiSummary | null> {
  // Search both manga AND webtoon listings — a webtoon's cover/author lives in the
  // webtoon type, so a manga-only search never finds it (covers stayed empty).
  for (const q of titleQueries(title)) {
    for (const type of ['manga', 'webtoon'] as const) {
      const r = await tokiList(base, { genre: '전체', sort: 'date', type, query: q }, 0).catch(
        () => null
      )
      const hit = r?.items.find((it) => pick(it) && titleMatches(title, it.title))
      if (hit) return hit
    }
  }
  return null
}

// Best-guess author for a local work by its title: search → confirm the result
// is the same title → its page → author. Returns null (leave artist empty)
// unless a confident title match is found — never guesses.
export async function tokiAuthorForTitle(base: string, title: string): Promise<string | null> {
  if (!title.trim()) return null
  const hit = await firstMatch(base, title, (it) => !!it.url)
  if (!hit?.url) return null
  return tokiSeriesAuthor(hit.url)
}

export async function tokiReadUrls(chapterUrl: string): Promise<string[]> {
  return queue(async () => {
    await ensure(chapterUrl, true)
    return evalPage<string[]>(READ_SCRIPT, [])
  })
}

// Manually open a site in the visible window (default the configured base) so
// the user can clear Cloudflare, log in, or navigate a backup site by hand.
export async function tokiOpenSite(base: string, url?: string): Promise<void> {
  return queue(async () => {
    const w = getWindow()
    const target = url && url.trim() ? url.trim() : base.replace(/\/+$/, '') + '/'
    // Show first: the hidden-window media block must not strip the page the
    // user is about to browse by hand.
    w.show()
    w.focus()
    await w.loadURL(toAlt(target)).catch(() => {})
  })
}

// --- Generic (gnuboard-style backup site) adapter ---
// These sites aren't the newtoki React SPA: the user opens the site by hand,
// navigates to a chapter-LIST page, and we scrape whatever is currently loaded.
// Selectors mirror the user's tokidownloader.txt (list + viewer variants).

// Scrape the chapter list from the page CURRENTLY loaded in the window (no
// navigation) — the user must be on a list page. Returns ascending chapters.
const GENERIC_LIST_SCRIPT = `(() => {
  const cur = location.href
  const domain = (cur.match(/^https?:\\/\\/[^\\/]+/) || [''])[0]
  const numOf = (el) => {
    const n = el.querySelector('.ep-row-v2-no, .wr-num, .td_num, .num, .no, .episode-num, .list-num')
    if (n) return parseInt((n.innerText || '').replace(/[^0-9]/g, '')) || 0
    const t = el.querySelector('.ep-row-v2-title strong, .title span, .episode-title, .subject')
    if (t) { const x = t.innerText.trim(); const m = x.match(/(\\d+)\\s*(?:화|회|장)/) || x.match(/^(\\d+)/); if (m) return parseInt(m[1]) }
    const x = (el.innerText || '').trim(); const m = x.match(/(\\d+)\\s*(?:화|회|장)/) || x.match(/^(\\d+)/); return m ? parseInt(m[1]) : 0
  }
  const linkOf = (el) => {
    const tn = el.querySelector('.ep-row-v2-title strong, .title span, .episode-title, .subject')
    const ct = tn ? tn.innerText.trim() : null
    const a = el.querySelector('a')
    if (a && a.getAttribute('href')) return { href: a.href, text: ct || (a.innerText || '').replace(/\\s+/g, ' ').trim() }
    const cn = el.hasAttribute('onclick') ? el : el.querySelector('[onclick]')
    if (cn) {
      const o = cn.getAttribute('onclick')
      if (o && o.includes('location.href')) {
        const m = o.match(/location\\.href\\s*=\\s*['"]([^'"]+)['"]/)
        if (m) { let h = m[1]; try { h = new URL(h, cur).href } catch (e) { if (!h.startsWith('http')) h = domain + (h.startsWith('/') ? '' : '/') + h } return { href: h, text: ct || (el.innerText || '').trim() } }
      }
    }
    return null
  }
  const sels = ['.ep-list-v2 .ep-row-v2', '.list-episode-card .episode-card', '.episode-list li', '.list-body li', '#bo_list tbody tr', '.list-board li', '.list-wrap li', '.list-item', 'table.table tbody tr']
  let list = []
  for (const s of sels) { const f = document.querySelectorAll(s); if (f.length) { list = Array.from(f); break } }
  list = list.reverse() // DOM is newest-first → ascending reading order
  const out = []
  const seen = new Set()
  for (const el of list) {
    const ld = linkOf(el); if (!ld || !ld.href || seen.has(ld.href)) continue
    if (/#$|javascript:/i.test(ld.href)) continue
    seen.add(ld.href); out.push({ url: ld.href, title: ld.text || '', num: numOf(el) })
  }
  return { items: out }
})()`

export async function tokiScrapeList(): Promise<TokiChapter[]> {
  return queue(async () => {
    const r = await evalPage<{ items: TokiChapter[] }>(GENERIC_LIST_SCRIPT, { items: [] })
    return r.items ?? []
  })
}

// Viewer-page image extraction for the backup sites (img_list script + a wide
// set of viewer <img> containers).
const GENERIC_READ_SCRIPT = `(() => {
  const abs = (u) => { if (!u) return null; if (u.startsWith('//')) return 'https:' + u; try { return new URL(u, location.href).href } catch { return u } }
  const out = []; const seen = new Set()
  const push = (s) => { s = abs(s); if (s && !seen.has(s) && /^https?:/.test(s)) { seen.add(s); out.push(s) } }
  for (const sc of document.querySelectorAll('script')) {
    if (sc.innerHTML.includes('img_list')) {
      const m = sc.innerHTML.match(/img_list\\s*=\\s*(\\[[^\\]]+\\])/)
      if (m) { try { const p = JSON.parse(m[1]); if (Array.isArray(p)) p.forEach(push) } catch { (m[1].match(/["']([^"']+)["']/g) || []).forEach((u) => push(u.replace(/["']/g, ''))) } }
    }
  }
  for (const img of document.querySelectorAll('.vw-imgs img, .view-padding div img, #bo_v_con img, .bo_v_con img, .view-content img, .viewer-img img, #viewer img, .toon-img img, .webtoon-body img, .view-wrap img, img.viewer-lazy-img')) {
    push(img.getAttribute('data-src') || img.getAttribute('src'))
  }
  return out
})()`

// Fetch an image through the persistent session with an explicit referer (the
// backup sites 403 a bare <img> and need referer = their own domain).
async function fetchImg(url: string, referer: string): Promise<Buffer> {
  // Retry thrown network errors (connection resets); HTTP errors fail at once.
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await session.fromPartition(PARTITION).fetch(url, {
        headers: { 'User-Agent': UA, Referer: referer }
      })
    } catch (e) {
      // Only connection resets are retried; anything else fails as before.
      if (attempt >= 4 || !/ERR_CONNECTION_RESET/.test(String(e))) throw e
      await delay(300 * (attempt + 1))
      continue
    }
    if (!res.ok) throw new Error(`img ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
}

// Download a list of already-scraped chapters (from a backup site) to disk. Each
// chapter page is loaded in the (hidden) window and its images extracted, so it
// runs in the background — the user need not keep the site window open.
export async function downloadGenericChapters(
  chapters: TokiChapter[],
  title: string,
  destRoot: string,
  onProgress: (done: number, total: number, label: string) => void,
  only?: string[],
  signal?: AbortSignal
): Promise<string> {
  const pick = only ? new Set(only) : null
  const targets = pick ? chapters.filter((c) => pick.has(c.url)) : chapters
  if (!targets.length) throw new Error('다운로드할 화가 없습니다')
  const seriesDir = join(destRoot, safeName(title))
  await fs.mkdir(seriesDir, { recursive: true })
  const total = targets.length
  for (let i = 0; i < targets.length; i++) {
    signal?.throwIfAborted()
    const ch = targets[i]
    onProgress(i, total, ch.title)
    const urls = await queue(async () => {
      await ensure(ch.url, true)
      return evalPage<string[]>(GENERIC_READ_SCRIPT, [])
    })
    if (!urls.length) continue
    let referer = ch.url
    try {
      referer = new URL(ch.url).origin + '/'
    } catch {
      /* keep chapter url */
    }
    const n = Math.floor(ch.num || i + 1)
    const chDir = join(seriesDir, safeName(chapterFolderName(title, ch.title, n)))
    await fs.mkdir(chDir, { recursive: true })
    await saveChapterImages(chDir, urls, (u) => fetchImg(u, referer))
  }
  onProgress(total, total, '완료')
  return seriesDir
}

// Best-guess cover image url for a series title (search → first card thumb).
// Returns the raw CDN url (unwrapped); the caller fetches it via the toki
// session. Used by the offline library's "cover regen from online" feature.
export async function tokiCoverForTitle(base: string, title: string): Promise<string | null> {
  if (!title.trim()) return null
  // Take the first result that actually carries a cover (the first card's thumb
  // can be null when only the platform-icon img is present).
  const hit = await firstMatch(base, title, (it) => !!it.thumb)
  return hit?.thumb ?? null
}

// Fetch a toki image through the persistent session + site referer (a bare
// <img> would get a 403). Used by the mangaimg://toki protocol host.
export async function fetchTokiBuffer(base: string, url: string): Promise<Buffer> {
  const ses = session.fromPartition(PARTITION)
  // Same intermittent connection resets hit image requests → retry network
  // errors (thrown) a few times; HTTP errors (403/404) fail immediately.
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await ses.fetch(toAlt(url), {
        headers: { 'User-Agent': UA, Referer: base.replace(/\/+$/, '') + '/' }
      })
    } catch (e) {
      // Only connection resets are retried; anything else fails as before.
      if (attempt >= 4 || !/ERR_CONNECTION_RESET/.test(String(e))) throw e
      await delay(300 * (attempt + 1))
      continue
    }
    if (!res.ok) throw new Error(`toki img ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
}

// --- download a whole series into the local general-manga library ---
function safeName(s: string): string {
  // Also strip a trailing '.'/space — Windows forbids them on a path segment and
  // silently drops them, breaking the recorded path.
  return (
    s
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
      .replace(/[.\s]+$/, '')
      .trim() || 'untitled'
  )
}
function extOf(url: string): string {
  const m = url.split('?')[0].match(/\.(png|jpe?g|gif|webp|avif)$/i)
  return m ? '.' + m[1].toLowerCase() : '.jpg'
}

// Save a chapter's page images into chDir as img0000.ext, img0001.ext …, four
// at a time. Resumable: an image already on disk (non-empty) is skipped, so a
// retry continues where a stopped/failed download left off. A failing image
// is skipped; the rest still download.
async function saveChapterImages(chDir: string, urls: string[], fetchBuf: (url: string) => Promise<Buffer>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const j = next++
      if (j >= urls.length) return
      const fp = join(chDir, `img${String(j).padStart(4, '0')}${extOf(urls[j])}`)
      try {
        const st = await fs.stat(fp)
        if (st.size > 0) continue
      } catch {
        /* not present — download it */
      }
      try {
        await fs.writeFile(fp, await fetchBuf(urls[j]))
      } catch {
        /* skip a bad image, keep the rest */
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
}


// Chapter folder name = "<n>화 <subtitle>" (or just "<n>화" when the chapter has
// no title of its own). The series name lives on the parent folder only, so it's
// stripped from the chapter title along with any chapter tokens / leading index.
// Mirrors the renderer's analyzeSeries/chapterSubtitle output so a freshly
// downloaded folder and a batch-renamed one land on the same name.
const CH_TOKEN_G = /(\d+(?:[.\-]\d+)?)(?:화|회|권|화차|話|장)/g
export function chapterFolderName(seriesTitle: string, chTitle: string, n: number): string {
  const label = `${n}화`
  // Strip chapter tokens first, THEN the leading index run, then a lone 화 unit
  // orphaned by the token removal (fixes "N화 화"). Finally drop the series name.
  let s = (chTitle || '').replace(CH_TOKEN_G, ' ')
  s = s.replace(/^[\s\d.\-_]+/, ' ')
  s = s.replace(/^[\s,·…\-_]*[화회장권話](?=\s|$)/, ' ')
  s = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (seriesTitle.trim()) {
    const pre = seriesTitle.trim().split(/\s+/)
    const w = s.split(/\s+/).filter(Boolean)
    let k = 0
    while (k < pre.length && k < w.length && w[k] === pre[k]) k++
    s = w.slice(k).join(' ').replace(/^[\s,·…\-_]+/, '').trim()
  }
  return s ? `${label} ${s}` : label
}

export async function tokiDownloadSeries(
  base: string,
  seriesUrl: string,
  title: string,
  destRoot: string,
  onProgress: (done: number, total: number, label: string) => void,
  only?: string[], // when set, download only these chapter urls (선택/이어서)
  signal?: AbortSignal
): Promise<string> {
  const all = await tokiChapters(seriesUrl)
  if (!all.length) throw new Error('화 목록을 찾지 못했습니다')
  const pick = only ? new Set(only) : null
  const chapters = pick ? all.filter((c) => pick.has(c.url)) : all
  if (!chapters.length) throw new Error('다운로드할 화가 없습니다')
  const seriesDir = join(destRoot, safeName(title))
  await fs.mkdir(seriesDir, { recursive: true })
  const total = chapters.length
  for (let i = 0; i < chapters.length; i++) {
    signal?.throwIfAborted()
    const ch = chapters[i]
    onProgress(i, total, ch.title)
    const urls = await tokiReadUrls(ch.url)
    if (!urls.length) continue
    // Folder = "<n>화 <subtitle>" (series name is only on the parent). The chapter
    // number sorts/merges subset & 이어서 downloads correctly on its own.
    const n = Math.floor(ch.num || i + 1)
    const chDir = join(seriesDir, safeName(chapterFolderName(title, ch.title, n)))
    await fs.mkdir(chDir, { recursive: true })
    await saveChapterImages(chDir, urls, (u) => fetchTokiBuffer(base, u))
  }
  onProgress(total, total, '완료')
  return seriesDir
}

export type { TokiType, TokiSort }
