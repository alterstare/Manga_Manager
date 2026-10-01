import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { Api } from '../shared/ipc'

const api: Api = {
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (s) => ipcRenderer.invoke(IPC.saveSettings, s),
  scanLibrary: () => ipcRenderer.invoke(IPC.scanLibrary),
  scanFolder: (root) => ipcRenderer.invoke(IPC.scanFolder, root),
  onScanProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.scanProgress, listener)
    return () => ipcRenderer.removeListener(IPC.scanProgress, listener)
  },
  organizeLanguages: () => ipcRenderer.invoke(IPC.organizeLanguages),
  organizeByGenre: () => ipcRenderer.invoke(IPC.organizeByGenre),
  onOrganizeProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.organizeProgress, listener)
    return () => ipcRenderer.removeListener(IPC.organizeProgress, listener)
  },
  getWorks: () => ipcRenderer.invoke(IPC.getWorks),
  getWorkImages: (id) => ipcRenderer.invoke(IPC.getWorkImages, id),
  setFavorite: (id, fav) => ipcRenderer.invoke(IPC.setFavorite, id, fav),
  setNormalFav: (kind, key, fav) => ipcRenderer.invoke(IPC.setNormalFav, kind, key, fav),
  setRank: (id, rank) => ipcRenderer.invoke(IPC.setRank, id, rank),
  setCoverHash: (id, hash, w, h) => ipcRenderer.invoke(IPC.setCoverHash, id, hash, w, h),
  setWorkGroups: (id, groupIds) => ipcRenderer.invoke(IPC.setWorkGroups, id, groupIds),
  deleteGroup: (groupId) => ipcRenderer.invoke(IPC.deleteGroup, groupId),
  hitomiFindKorean: (payload) => ipcRenderer.invoke(IPC.hitomiFindKorean, payload),
  exportFavorites: () => ipcRenderer.invoke(IPC.exportFavorites),
  importFavorites: () => ipcRenderer.invoke(IPC.importFavorites),
  importOnlineFavList: () => ipcRenderer.invoke(IPC.importOnlineFavList),
  removeOnlineFavList: (name: string) => ipcRenderer.invoke(IPC.removeOnlineFavList, name),
  hitomiSummaries: (codes: string[]) => ipcRenderer.invoke(IPC.hitomiSummaries, codes),
  preloadOnlineFavLists: () => ipcRenderer.invoke(IPC.preloadOnlineFavLists),
  onOnlineFavPreload: (cb: (p: { done: number; total: number }) => void) => {
    const listener = (_e: unknown, p: any): void => cb(p)
    ipcRenderer.on(IPC.onlineFavPreloadProgress, listener)
    return () => ipcRenderer.removeListener(IPC.onlineFavPreloadProgress, listener)
  },
  mergeFavorites: () => ipcRenderer.invoke(IPC.mergeFavorites),
  getOnlineFavs: () => ipcRenderer.invoke(IPC.getOnlineFavs),
  setOnlineFav: (code, patch, meta) => ipcRenderer.invoke(IPC.setOnlineFav, code, patch, meta),
  setFavoriteByCode: (code, fav, meta) => ipcRenderer.invoke(IPC.setFavoriteByCode, code, fav, meta),
  translateImage: (imageBase64, langHint, w, h) =>
    ipcRenderer.invoke(IPC.translateImage, imageBase64, langHint, w, h),
  translateTexts: (texts, langHint) => ipcRenderer.invoke(IPC.translateTexts, texts, langHint),
  getTransEdits: () => ipcRenderer.invoke(IPC.getTransEdits),
  saveTransEdit: (src, blocks) => ipcRenderer.invoke(IPC.saveTransEdit, src, blocks),
  exportText: (title, content) => ipcRenderer.invoke(IPC.exportText, title, content),
  exportImageDir: (title) => ipcRenderer.invoke(IPC.exportImageDir, title),
  writeImageFile: (dir, name, base64) => ipcRenderer.invoke(IPC.writeImageFile, dir, name, base64),
  addManualTag: (id, tag) => ipcRenderer.invoke(IPC.addManualTag, id, tag),
  removeManualTag: (id, tag) => ipcRenderer.invoke(IPC.removeManualTag, id, tag),
  incrementView: (id) => ipcRenderer.invoke(IPC.incrementView, id),
  openInExplorer: (id) => ipcRenderer.invoke(IPC.openInExplorer, id),
  deleteWork: (id) => ipcRenderer.invoke(IPC.deleteWork, id),
  mergeSeries: (title, ids) => ipcRenderer.invoke(IPC.mergeSeries, title, ids),
  renameNormalChapters: (items) => ipcRenderer.invoke(IPC.renameNormalChapters, items),
  classifyDeleted: () => ipcRenderer.invoke(IPC.classifyDeleted),
  onClassifyProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.classifyProgress, listener)
    return () => ipcRenderer.removeListener(IPC.classifyProgress, listener)
  },
  getSession: () => ipcRenderer.invoke(IPC.getSession),
  saveSession: (s) => ipcRenderer.invoke(IPC.saveSession, s),
  parseName: (name) => ipcRenderer.invoke(IPC.parseName, name),
  hitomiFetchMeta: (code) => ipcRenderer.invoke(IPC.hitomiFetchMeta, code),
  hitomiEnrich: (id) => ipcRenderer.invoke(IPC.hitomiEnrich, id),
  hitomiEnrichAll: () => ipcRenderer.invoke(IPC.hitomiEnrichAll),
  hitomiCancelEnrich: () => ipcRenderer.invoke(IPC.hitomiCancelEnrich),
  hitomiDownload: (input) => ipcRenderer.invoke(IPC.hitomiDownload, input),
  downloadStop: (code) => ipcRenderer.invoke(IPC.downloadStop, code),
  onHitomiProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.hitomiProgress, listener)
    return () => ipcRenderer.removeListener(IPC.hitomiProgress, listener)
  },
  hitomiList: (source, page) => ipcRenderer.invoke(IPC.hitomiList, source, page),
  hitomiSuggest: (query) => ipcRenderer.invoke(IPC.hitomiSuggest, query),
  listAvifPaths: (workId) => ipcRenderer.invoke(IPC.listAvifPaths, workId),
  replaceAvifWithWebp: (avifPath, webpBase64) =>
    ipcRenderer.invoke(IPC.replaceAvifWithWebp, avifPath, webpBase64),
  hitomiReadUrls: (code) => ipcRenderer.invoke(IPC.hitomiReadUrls, code),
  hitomiRegenCover: (workId, code) => ipcRenderer.invoke(IPC.hitomiRegenCover, workId, code),
  tokiList: (source, page) => ipcRenderer.invoke(IPC.tokiList, source, page),
  tokiChapters: (seriesUrl) => ipcRenderer.invoke(IPC.tokiChapters, seriesUrl),
  tokiReadUrls: (chapterUrl) => ipcRenderer.invoke(IPC.tokiReadUrls, chapterUrl),
  tokiDownload: (seriesUrl, title) => ipcRenderer.invoke(IPC.tokiDownload, seriesUrl, title),
  tokiDownloadChapters: (seriesUrl, title, chapterUrls) =>
    ipcRenderer.invoke(IPC.tokiDownloadChapters, seriesUrl, title, chapterUrls),
  tokiRegenCover: (workIds, title) => ipcRenderer.invoke(IPC.tokiRegenCover, workIds, title),
  tokiSeriesAuthor: (seriesUrl) => ipcRenderer.invoke(IPC.tokiSeriesAuthor, seriesUrl),
  tokiSeriesTitle: (seriesUrl) => ipcRenderer.invoke(IPC.tokiSeriesTitle, seriesUrl),
  tokiFillArtist: (workIds, title) => ipcRenderer.invoke(IPC.tokiFillArtist, workIds, title),
  tokiScrapeList: () => ipcRenderer.invoke(IPC.tokiScrapeList),
  tokiDownloadGeneric: (title, chapters, only) =>
    ipcRenderer.invoke(IPC.tokiDownloadGeneric, title, chapters, only),
  tokiOpenSite: (url) => ipcRenderer.invoke(IPC.tokiOpenSite, url),
  saveThumb: (id, dataUrl) => ipcRenderer.invoke(IPC.saveThumb, id, dataUrl),
  getThumb: (id) => ipcRenderer.invoke(IPC.getThumb, id),
  pickImage: () => ipcRenderer.invoke(IPC.pickImage),
  hitomiPing: () => ipcRenderer.invoke(IPC.hitomiPing),
  hitomiPopularRanks: (codes) => ipcRenderer.invoke(IPC.hitomiPopularRanks, codes),
  openFolder: (path) => ipcRenderer.invoke(IPC.openFolder, path),
  onRequestClose: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.requestClose, listener)
    return () => ipcRenderer.removeListener(IPC.requestClose, listener)
  },
  onTokiChallenge: (cb) => {
    const listener = (_e: unknown, active: boolean): void => cb(active)
    ipcRenderer.on(IPC.tokiChallenge, listener)
    return () => ipcRenderer.removeListener(IPC.tokiChallenge, listener)
  },
  onTokiStatus: (cb) => {
    const listener = (_e: unknown, msg: string | null): void => cb(msg)
    ipcRenderer.on(IPC.tokiStatus, listener)
    return () => ipcRenderer.removeListener(IPC.tokiStatus, listener)
  },
  onUpdateStatus: (cb) => {
    const listener = (_e: unknown, s: import('../shared/ipc').UpdateStatus): void => cb(s)
    ipcRenderer.on(IPC.updateStatus, listener)
    return () => ipcRenderer.removeListener(IPC.updateStatus, listener)
  },
  installUpdate: () => ipcRenderer.send(IPC.installUpdate),
  resetApp: (deleteWorkFolders) => ipcRenderer.invoke(IPC.resetApp, deleteWorkFolders),
  onNavBack: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.navBack, listener)
    return () => ipcRenderer.removeListener(IPC.navBack, listener)
  },
  onNavForward: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.navForward, listener)
    return () => ipcRenderer.removeListener(IPC.navForward, listener)
  },
  closeWindow: (decision, session) => ipcRenderer.invoke(IPC.closeWindow, decision, session)
}

contextBridge.exposeInMainWorld('api', api)
