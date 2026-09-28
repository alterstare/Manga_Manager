// IPC channel names + the shape of the API exposed to the renderer via preload.
import type { Work, Settings, SessionState, ParsedName, HitomiMeta, OnlineFav } from './types'

export type OnlineSort = 'date' | 'today' | 'week' | 'month' | 'year'

// Ordering for search results. 'date' = nozomi order (newest first);
// 'popular' = reorder by site popularity (year).
export type SearchSort = 'date' | 'popular'

export type HitomiListSource =
  | { kind: 'index'; language: string | null; sort?: OnlineSort }
  | { kind: 'search'; query: string; language: string | null; sort?: SearchSort }

// --- General-manga online (toki-family mirror) ---
// Genre filter chips. '전체' = no filter. The rest are sent as the site's genre
// tag; live-tune the exact tokens against the real site if they don't match.
export const TOKI_GENRES = [
  '전체',
  '학원',
  '액션',
  'SF',
  '스토리',
  '판타지',
  '드라마',
  '로맨스',
  '시대',
  '스포츠',
  '일상',
  '성인',
  '무협'
] as const
export type TokiGenre = (typeof TOKI_GENRES)[number]
export type TokiSort = 'date' | 'new' | 'bookmark' | 'view' | 'rating' | 'chapter'
export type TokiType = 'manga' | 'webtoon'
export interface TokiListSource {
  genre: string // '전체' = no filter; otherwise a genre chip label (dynamic per site)
  sort: TokiSort
  type: TokiType
  query?: string // free-text search; overrides genre/sort when present
  field?: 'title' | 'author' // which field `query` searches (default title)
}
// One series card on a toki list page.
export interface TokiSummary {
  url: string // series page url (unique id)
  title: string
  thumb: string | null // wrapped mangaimg://toki url
  artist: string | null // author — only known once the series page is scraped
  genre: string | null // genre label shown on the list card
  chapter: string | null // latest chapter label, when shown
}
// One chapter within a series.
export interface TokiChapter {
  url: string // chapter viewer url (unique id)
  title: string
  num: number // detected chapter number (for ordering)
}
export interface TokiListResult {
  items: TokiSummary[]
  page: number
  hasNext: boolean
  genres: string[] // genre chips scraped from the live page (for the filter UI)
}

export const IPC = {
  pickFolder: 'dialog:pickFolder',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  scanLibrary: 'library:scan',
  scanFolder: 'library:scanFolder', // rescan one folder, infer favorite/group from location
  scanProgress: 'library:scanProgress', // main -> renderer event
  organizeLanguages: 'library:organizeLanguages',
  organizeByGenre: 'library:organizeByGenre',
  organizeProgress: 'library:organizeProgress', // main -> renderer event
  getWorks: 'works:getAll',
  getWorkImages: 'works:getImages',
  imageUrl: 'works:imageUrl',
  setFavorite: 'works:setFavorite',
  setNormalFav: 'works:setNormalFav',
  setRank: 'works:setRank',
  setCoverHash: 'works:setCoverHash',
  setWorkGroups: 'works:setGroups',
  deleteGroup: 'works:deleteGroup',
  hitomiFindKorean: 'hitomi:findKorean',
  exportFavorites: 'fav:export',
  importFavorites: 'fav:import',
  importFavoriteList: 'fav:importList',
  removeFavoriteList: 'fav:removeList',
  importOnlineFavList: 'fav:importOnlineList',
  removeOnlineFavList: 'fav:removeOnlineList',
  hitomiSummaries: 'hitomi:summaries',
  preloadOnlineFavLists: 'fav:preloadOnline',
  onlineFavPreloadProgress: 'fav:preloadProgress',
  mergeFavorites: 'fav:merge',
  getOnlineFavs: 'online:getFavs',
  setOnlineFav: 'online:setFav',
  exportOnlineFavs: 'online:export',
  importOnlineFavs: 'online:import',
  mergeOnlineFavs: 'online:merge',
  translateImage: 'translate:image',
  translateTexts: 'translate:texts', // free engine: renderer OCRs, main translates strings
  getTransEdits: 'translate:getEdits', // load all persisted manual edits (bubble box/color/text)
  saveTransEdit: 'translate:saveEdit', // persist one page's edited blocks (keyed by image src)
  exportText: 'text:export', // OCR/translation → .txt in the export folder
  exportImageDir: 'text:exportImageDir', // create/return a fresh per-work image folder
  writeImageFile: 'text:writeImageFile', // write one rendered page image into that folder
  addManualTag: 'works:addManualTag',
  removeManualTag: 'works:removeManualTag',
  incrementView: 'works:incrementView',
  openInExplorer: 'works:openInExplorer',
  deleteWork: 'works:delete',
  mergeSeries: 'works:mergeSeries',
  renameNormalChapters: 'works:renameNormalChapters',
  classifyDeleted: 'works:classifyDeleted',
  classifyProgress: 'works:classifyProgress',
  getSession: 'session:get',
  saveSession: 'session:save',
  parseName: 'util:parseName',
  hitomiFetchMeta: 'hitomi:fetchMeta',
  hitomiEnrich: 'hitomi:enrich',
  hitomiEnrichAll: 'hitomi:enrichAll',
  hitomiCancelEnrich: 'hitomi:cancelEnrich',
  hitomiDownload: 'hitomi:download',
  hitomiProgress: 'hitomi:progress', // main -> renderer event
  downloadStop: 'download:stop', // abort a running/queued download by code
  hitomiList: 'hitomi:list',
  hitomiSuggest: 'hitomi:suggest', // online search autocomplete (artists + seen tags)
  listAvifPaths: 'convert:listAvif', // a work's .avif files (path + mangaimg url)
  replaceAvifWithWebp: 'convert:replaceWebp', // write .webp, delete the .avif
  hitomiReadUrls: 'hitomi:readUrls',
  hitomiRegenCover: 'hitomi:regenCover',
  tokiList: 'toki:list',
  tokiChapters: 'toki:chapters',
  tokiReadUrls: 'toki:readUrls',
  tokiDownload: 'toki:download',
  tokiDownloadChapters: 'toki:downloadChapters',
  tokiRegenCover: 'toki:regenCover',
  tokiSeriesAuthor: 'toki:seriesAuthor',
  tokiSeriesTitle: 'toki:seriesTitle',
  tokiFillArtist: 'toki:fillArtist',
  tokiScrapeList: 'toki:scrapeList',
  tokiDownloadGeneric: 'toki:downloadGeneric',
  tokiOpenSite: 'toki:openSite',
  tokiChallenge: 'toki:challenge', // main -> renderer: Cloudflare auth window shown/cleared
  saveThumb: 'thumb:save',
  getThumb: 'thumb:get',
  pickImage: 'dialog:pickImage',
  hitomiPing: 'hitomi:ping',
  hitomiPopularRanks: 'hitomi:popularRanks',
  openFolder: 'util:openFolder',
  requestClose: 'app:requestClose', // main -> renderer: show exit modal
  closeWindow: 'app:closeWindow', // renderer -> main: exit decision
  navBack: 'app:navBack', // main -> renderer: mouse/back-command → go back
  navForward: 'app:navForward' // main -> renderer: mouse/forward-command → go forward
} as const

// User's choice in the exit modal.
export type CloseDecision = 'keep' | 'clear' | 'cancel'

// One detected+translated text region. Coords are in original-image pixels.
export interface TransBlock {
  x: number
  y: number
  w: number
  h: number
  text: string // recognized source text
  tr: string // Korean translation
  bg?: string // manual bubble-fill colour override (hex); auto-sampled when unset
}
export interface TransResult {
  ok: boolean
  w: number // original image width (for scaling the overlay)
  h: number
  blocks: TransBlock[]
  panelText?: string // used when the engine returns text without per-box coords
  error?: string
}

export interface HitomiProgress {
  code: string
  title: string
  done: number
  total: number
  phase:
    | 'queued'
    | 'fetching'
    | 'downloading'
    | 'enriching'
    | 'converting'
    | 'done'
    | 'error'
    | 'stopped'
  message?: string
}

export interface GallerySummary {
  code: string
  title: string
  artists: string[]
  tags: string[]
  language: string | null
  type: string | null
  pageCount: number
  thumbUrl: string | null
}

export interface HitomiListResult {
  items: GallerySummary[]
  total: number
  page: number
  pageSize: number
}

export interface Api {
  pickFolder: () => Promise<string | null>
  getSettings: () => Promise<Settings>
  saveSettings: (s: Settings) => Promise<Settings>
  scanLibrary: () => Promise<Work[]>
  // Rescan a single folder; works get favorite/group inferred from their path.
  scanFolder: (root: string) => Promise<Work[]>
  onScanProgress: (cb: (p: { scanned: number; total: number; current: string; done: boolean }) => void) => () => void
  organizeLanguages: () => Promise<Work[]>
  organizeByGenre: () => Promise<{ works: Work[]; moved: number }>
  onOrganizeProgress: (cb: (p: { moved: number; current: string; done: boolean }) => void) => () => void
  getWorks: () => Promise<Work[]>
  getWorkImages: (workId: string) => Promise<string[]> // file:// urls in page order
  setFavorite: (workId: string, fav: boolean) => Promise<Work>
  // General-manga in-app favorite: toggle a series (by key) or a single chapter
  // (by work id). Returns the updated settings (holding the fav lists).
  setNormalFav: (kind: 'series' | 'chapter', key: string, fav: boolean) => Promise<Settings>
  setRank: (workId: string, rank: number) => Promise<Work>
  setCoverHash: (workId: string, hash: string, w?: number, h?: number) => Promise<Work>
  setWorkGroups: (workId: string, groupIds: string[]) => Promise<Work>
  // Delete a group: drops it from settings, moves its works out of the group
  // folder, and strips the group id from those works. Returns fresh state.
  deleteGroup: (groupId: string) => Promise<{ settings: Settings; works: Work[] }>
  hitomiFindKorean: (payload: {
    code: string | null
    artist: string | null
    title: string
  }) => Promise<GallerySummary[]>           // Korean editions of a work
  exportFavorites: () => Promise<{ ok: boolean; count: number; path?: string }>
  importFavorites: () => Promise<{ ok: boolean; matched: number; total: number }>
  // Import a favorite file as its OWN named list (favlist:<file name> tag) so it
  // can be browsed separately. Adds the tag to matched local works.
  importFavoriteList: () => Promise<{ ok: boolean; matched: number; total: number; name: string }>
  removeFavoriteList: (name: string) => Promise<{ ok: boolean }>
  // Online favorite lists: import a file as a named online list, remove one, and
  // fetch gallery summaries for a set of codes (to render the list).
  importOnlineFavList: () => Promise<{ ok: boolean; name: string; total: number }>
  removeOnlineFavList: (name: string) => Promise<{ ok: boolean }>
  hitomiSummaries: (codes: string[]) => Promise<GallerySummary[]>
  preloadOnlineFavLists: () => Promise<{ ok: boolean; total: number; cached: number }>
  onOnlineFavPreload: (cb: (p: { done: number; total: number }) => void) => () => void
  // Merge 2+ favorite files into one new file (union); no library change.
  mergeFavorites: () => Promise<{ ok: boolean; count: number; files: number; path?: string }>
  // Online (hitomi) favorites + ranks, keyed by gallery code.
  getOnlineFavs: () => Promise<OnlineFav[]>
  setOnlineFav: (
    code: string,
    patch: { favorite?: boolean; rank?: number },
    meta?: Partial<OnlineFav>
  ) => Promise<OnlineFav>
  exportOnlineFavs: () => Promise<{ ok: boolean; count: number; path?: string }>
  importOnlineFavs: () => Promise<{ ok: boolean; count: number }>
  mergeOnlineFavs: () => Promise<{ ok: boolean; count: number; files: number; path?: string }>
  // OCR + translate one page. imageBase64 = JPEG/PNG bytes (base64, no prefix);
  // the renderer re-encodes webp/avif via canvas first. langHint = ja/en/zh.
  // w/h = the sent (downscaled) image pixel size, so engines returning
  // normalized boxes (Gemini) can convert to pixels. Papago ignores them.
  translateImage: (imageBase64: string, langHint?: string, w?: number, h?: number) => Promise<TransResult>
  // Free engine: translate already-OCR'd strings (Google unofficial / DeepL).
  // Returns translations aligned to the input order ('' on per-item failure).
  translateTexts: (texts: string[], langHint?: string) => Promise<{ ok: boolean; texts: string[]; error?: string }>
  // Manual translation edits: map of image src → edited blocks. Loaded once at boot.
  getTransEdits: () => Promise<Record<string, TransBlock[]>>
  saveTransEdit: (src: string, blocks: TransBlock[]) => Promise<void>
  // Write extracted text to <textExportDir>/<title>.txt; returns the written path.
  exportText: (title: string, content: string) => Promise<string>
  // Create a fresh <textExportDir>/<title>[ (n)] folder for image export; returns its path.
  exportImageDir: (title: string) => Promise<string>
  // Write one rendered page image (base64, webp) into a folder from exportImageDir.
  writeImageFile: (dir: string, name: string, base64: string) => Promise<void>
  addManualTag: (workId: string, tag: string) => Promise<Work>
  removeManualTag: (workId: string, tag: string) => Promise<Work>
  incrementView: (workId: string) => Promise<Work>
  openInExplorer: (workId: string) => Promise<void>
  deleteWork: (workId: string) => Promise<void>
  // Merge several general-manga works into one series folder (chapters become
  // subfolders of a single <root>/<title> folder). Returns the moved works.
  mergeSeries: (title: string, workIds: string[]) => Promise<Work[]>
  // Rename general-manga chapter folders in place to the given names (the caller
  // computes "<n>화 <subtitle>" per work). Returns the updated works.
  renameNormalChapters: (items: { id: string; name: string }[]) => Promise<Work[]>
  // Sweep hitomi-coded works that 404 on hitomi (deleted) into settings.deletedDir.
  // Returns a summary + the refreshed works. Progress via onClassifyProgress.
  classifyDeleted: () => Promise<{ moved: number; checked: number; uncertain: number; works: Work[] }>
  onClassifyProgress: (
    cb: (p: { done: number; total: number; moved: number; current: string; finished: boolean }) => void
  ) => () => void
  getSession: () => Promise<SessionState>
  saveSession: (s: SessionState) => Promise<void>
  parseName: (folderName: string) => Promise<ParsedName>
  hitomiFetchMeta: (code: string) => Promise<HitomiMeta>
  hitomiEnrich: (workId: string) => Promise<Work>
  hitomiEnrichAll: () => Promise<Work[]>
  hitomiCancelEnrich: () => Promise<void>
  hitomiDownload: (input: string) => Promise<Work> // input = code or hitomi url
  // Abort a running/queued download by its progress code (hitomi code, toki
  // seriesUrl, or "backup:<title>"). No-op if that code isn't downloading.
  downloadStop: (code: string) => Promise<boolean>
  onHitomiProgress: (cb: (p: HitomiProgress) => void) => () => void
  hitomiList: (source: HitomiListSource, page: number) => Promise<HitomiListResult>
  hitomiSuggest: (query: string) => Promise<string[]>
  // avif→webp conversion (Pupil compatibility). List a work's avif files, then
  // replace each with a webp (encoded by the renderer's canvas).
  listAvifPaths: (workId: string) => Promise<{ path: string; url: string }[]>
  replaceAvifWithWebp: (avifPath: string, webpBase64: string) => Promise<void>
  hitomiReadUrls: (code: string) => Promise<string[]>
  hitomiRegenCover: (workId: string, code: string) => Promise<{ ok: boolean; error?: string }>
  // General-manga online (toki-family). Scraped via a hidden BrowserWindow.
  tokiList: (source: TokiListSource, page: number) => Promise<TokiListResult>
  tokiChapters: (seriesUrl: string) => Promise<TokiChapter[]>
  tokiReadUrls: (chapterUrl: string) => Promise<string[]> // wrapped image urls
  // Download every chapter of a series into the general-manga library. Progress
  // is reported on the hitomiProgress channel (code = seriesUrl). Returns the
  // newly scanned chapter works.
  tokiDownload: (seriesUrl: string, title: string) => Promise<Work[]>
  // Download only the given chapter urls of a series (선택 화 / 이어서 다운로드).
  tokiDownloadChapters: (seriesUrl: string, title: string, chapterUrls: string[]) => Promise<Work[]>
  // Regenerate the cover thumbnail for the given works from the online source,
  // searching by series title. Writes to each work's thumb file.
  tokiRegenCover: (workIds: string[], title: string) => Promise<{ ok: boolean; error?: string }>
  // Scrape the author(s) of a series from its page (comma-joined, or null).
  tokiSeriesAuthor: (seriesUrl: string) => Promise<string | null>
  tokiSeriesTitle: (seriesUrl: string) => Promise<string | null>
  // Fill the artist field on the given works by searching the online source for
  // `title`, taking the first result's author. Returns the updated works.
  tokiFillArtist: (workIds: string[], title: string) => Promise<Work[]>
  // Backup (gnuboard) sites: scrape the chapter list from the page currently
  // loaded in the site window (the user navigates there by hand).
  tokiScrapeList: () => Promise<TokiChapter[]>
  // Download the given scraped chapters in the background (site window not
  // needed open). `only` limits to those chapter urls. Returns new works.
  tokiDownloadGeneric: (
    title: string,
    chapters: TokiChapter[],
    only?: string[]
  ) => Promise<Work[]>
  // Open a site in a visible window so the user can clear Cloudflare / log in, or
  // navigate a backup site. Pass `url` to open a specific address.
  tokiOpenSite: (url?: string) => Promise<void>
  saveThumb: (workId: string, dataUrl: string) => Promise<string>
  getThumb: (workId: string) => Promise<string | null>
  pickImage: () => Promise<string | null> // returns a mangaimg:// url for the chosen image
  hitomiPing: () => Promise<{ dohIp: string | null; ltnOk: boolean; error: string | null }>
  hitomiPopularRanks: (codes: string[]) => Promise<Record<string, number>>
  openFolder: (path: string) => Promise<void>
  // Main asks the renderer to show the styled exit modal.
  onRequestClose: (cb: () => void) => () => void
  // Cloudflare auth window shown (true) / cleared (false) — show a banner.
  onTokiChallenge: (cb: (active: boolean) => void) => () => void
  // Mouse "back" side button / browser-backward app command → go back.
  onNavBack: (cb: () => void) => () => void
  // Mouse "forward" side button / browser-forward app command → go forward.
  onNavForward: (cb: () => void) => () => void
  // Renderer reports the exit decision. For 'keep', pass the live tab session.
  closeWindow: (decision: CloseDecision, session?: SessionState) => Promise<void>
}

declare global {
  interface Window {
    api: Api
  }
}
