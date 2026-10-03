// Settings screen (per library mode). This file owns the editing lifecycle —
// the draft, unsaved-change tracking, save / leave-confirm, result notices —
// and the category tabs. Each category's boxes live in settings/*Section.tsx
// and read/edit the draft through SettingsContext.
//
// Categories are all rendered at once; CSS shows only the active one
// (.settings-inner[data-show] hides the other <section data-cat>s), so a
// section's local state and running tasks survive tab switches.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { Settings as SettingsT } from '../../../shared/types'
import { SPLIT_SETTING_KEYS } from '../../../shared/types'
import { setExcluded } from '../exclude'
import { clearTranslation } from '../translate'
import ConfirmModal from './ConfirmModal'
import SearchClear from './SearchClear'
import { SearchIcon } from './icons'
import { SettingsContext, type SettingsCtl } from './settings/context'
import FolderSection from './settings/FolderSection'
import TagSection from './settings/TagSection'
import ShortcutSection from './settings/ShortcutSection'
import StyleSection from './settings/StyleSection'
import TranslateSection from './settings/TranslateSection'
import NetworkSection from './settings/NetworkSection'
import ManageSection from './settings/ManageSection'

type Cat = 'folder' | 'fav' | 'style' | 'translate' | 'network' | 'keys' | 'manage'
const CATS: { id: Cat; label: string }[] = [
  { id: 'folder', label: '폴더·저장' },
  { id: 'fav', label: '태그·검색' },
  { id: 'style', label: '스타일·정렬' },
  { id: 'translate', label: '번역' },
  { id: 'network', label: '네트워크·다운로드' },
  { id: 'keys', label: '단축키' },
  { id: 'manage', label: '관리' }
]

export default function Settings(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const libraryMode = useStore((s) => s.libraryMode)
  const works = useStore((s) => s.works)
  const goHome = useStore((s) => s.goHome)
  const setSettingsDirty = useStore((s) => s.setSettingsDirty)
  const pendingNav = useStore((s) => s.pendingNav)
  const clearPendingNav = useStore((s) => s.clearPendingNav)
  const [draft, setDraft] = useState<SettingsT>(settings)
  const [cat, setCat] = useState<Cat>('folder')
  const [rescanning, setRescanning] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Transient floating confirmation ("저장되었습니다") after a manual save.
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  // The theme is previewed live while editing; on leaving, restore the saved
  // theme so an unsaved change doesn't stick.
  useEffect(() => {
    return () => document.documentElement.setAttribute('data-theme', settings.theme ?? 'light')
  }, [settings.theme])

  // Unsaved edits → the store's navigation guard asks before leaving.
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  useEffect(() => {
    setSettingsDirty(dirty)
    return () => setSettingsDirty(false)
  }, [dirty, setSettingsDirty])

  const ctl: SettingsCtl = {
    draft,
    patch: (p) => setDraft((d) => ({ ...d, ...p })),
    applySaved: (s) => {
      setSettings(s)
      setDraft(s)
    },
    isHitomi: libraryMode === 'hitomi',
    works,
    notify: setNotice,
    rescanning,
    rescan: async (path, mode) => {
      setRescanning(path)
      try {
        // Global job (updates works itself) → progress in the activity bar.
        await useStore.getState().scanFolderJob(path, mode)
        setNotice('폴더 갱신 완료 — 하단 작업 바에서 결과 확인.')
      } finally {
        setRescanning(null)
      }
    },
    pickDir: async (apply) => {
      const dir = await window.api.pickFolder()
      if (dir) apply(dir)
    }
  }

  // Persist the draft. Per-mode keys (SPLIT_SETTING_KEYS) go into this mode's
  // overlay so the other library mode keeps its own values.
  const persist = async (): Promise<SettingsT> => {
    const overlay = Object.fromEntries(SPLIT_SETTING_KEYS.map((k) => [k, draft[k]])) as Partial<SettingsT>
    const saved = await window.api.saveSettings({
      ...draft,
      perMode: { ...(draft.perMode ?? {}), [libraryMode]: overlay }
    })
    setSettings(saved)
    // Re-sync the draft to the effective settings (overlay applied) so the dirty
    // check settles instead of flagging the perMode difference.
    setDraft(useStore.getState().settings)
    setExcluded(saved.excludedImageHashes)
    clearTranslation() // engine/translator may have changed → drop cached pages
    setSettingsDirty(false)
    return saved
  }
  const save = async (): Promise<void> => {
    await persist()
    setToast('저장되었습니다')
  }
  // Leave-confirm modal (a navigation was attempted with unsaved edits).
  const leaveSave = async (): Promise<void> => {
    const nav = pendingNav
    await persist()
    clearPendingNav()
    nav?.()
  }
  const leaveDiscard = (): void => {
    const nav = pendingNav
    setDraft(settings)
    setSettingsDirty(false)
    clearPendingNav()
    nav?.()
  }

  // Settings search: while there's a query, every category is shown and each
  // setting (a .set-block, or a standalone .set-row / hint) is kept only if its
  // text — title, description, labels — contains the query. Sections left with
  // no hits disappear. Matches are highlighted with the CSS Custom Highlight API
  // (no DOM edits, so React's nodes stay untouched).
  const [q, setQ] = useState('')
  const innerRef = useRef<HTMLDivElement>(null)
  const [noHits, setNoHits] = useState(false)
  useLayoutEffect(() => {
    const root = innerRef.current
    if (!root) return
    const query = q.trim().toLowerCase()
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    root.querySelectorAll('.srch-hide').forEach((e) => e.classList.remove('srch-hide'))
    hl?.delete('settings-search')
    if (!query) return setNoHits(false)
    const ranges: Range[] = []
    let total = 0
    for (const sec of Array.from(root.querySelectorAll<HTMLElement>('section[data-cat]'))) {
      const units: HTMLElement[] = []
      for (const ch of Array.from(sec.children) as HTMLElement[]) {
        if (ch.tagName === 'H2') continue
        if (ch.matches('.set-block, .set-row') || !ch.querySelector('.set-block, .set-row')) units.push(ch)
        else
          units.push(
            ...(Array.from(ch.querySelectorAll<HTMLElement>('.set-block, .set-row')).filter(
              (u) => !u.parentElement?.closest('.set-block')
            ) as HTMLElement[])
          )
      }
      const secHit = (sec.querySelector('h2')?.textContent ?? '').toLowerCase().includes(query)
      let hits = 0
      for (const u of units) {
        const hit = secHit || (u.textContent ?? '').toLowerCase().includes(query)
        if (hit) hits++
        else u.classList.add('srch-hide')
      }
      if (!hits) sec.classList.add('srch-hide')
      total += hits
      // Highlight every occurrence inside the visible units.
      const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.textContent ?? '').toLowerCase()
        if ((n.parentElement as HTMLElement | null)?.closest('.srch-hide')) continue
        for (let i = text.indexOf(query); i >= 0; i = text.indexOf(query, i + query.length)) {
          const r = new Range()
          r.setStart(n, i)
          r.setEnd(n, i + query.length)
          ranges.push(r)
        }
      }
    }
    const HL = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
    if (hl && HL && ranges.length) hl.set('settings-search', new HL(...ranges))
    setNoHits(total === 0)
  }, [q, draft])

  const modeName = ctl.isHitomi ? '동인지' : '일반 만화'
  return (
    <SettingsContext.Provider value={ctl}>
      <div className="settings">
        <div className={`settings-inner ${q.trim() ? 'searching' : ''}`} data-show={q.trim() ? 'search' : cat} ref={innerRef}>
          <h1>설정 · {modeName}</h1>
          <p className="hint">
            이 화면은 현재 <b>{modeName}</b> 모드 설정입니다. 모드는 ☰ 메뉴에서 전환할 수 있습니다.
          </p>

          <div className="settings-search">
            <SearchIcon />
            <div className="search-ac">
              <input
                className="search"
                value={q}
                placeholder="설정 검색 (예: 프록시, 썸네일, 다운로드)"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQ('')}
              />
              <SearchClear value={q} onClear={() => setQ('')} />
            </div>
          </div>
          {noHits && <div className="empty settings-noresult">검색 결과가 없습니다.</div>}

          <div className="settings-tabs">
            {CATS.map((c) => (
              <button
                key={c.id}
                className={`settings-tab ${cat === c.id ? 'active' : ''}`}
                onClick={() => setCat(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <FolderSection />
          <TagSection />
          <StyleSection />
          <TranslateSection />
          <NetworkSection />
          <ShortcutSection />
          <ManageSection />

          <div className="settings-actions">
            <button className="btn" onClick={goHome}>
              취소
            </button>
            <button className="btn primary" onClick={save}>
              저장
            </button>
          </div>
        </div>

        {toast && <div className="settings-toast">✓ {toast}</div>}
        {notice && (
          <ConfirmModal
            icon="✓"
            title="완료"
            desc={notice}
            confirmLabel="확인"
            hideCancel
            onConfirm={() => setNotice(null)}
            onCancel={() => setNotice(null)}
          />
        )}
        {pendingNav && (
          <ConfirmModal
            icon="💾"
            title="저장하지 않은 변경이 있습니다"
            desc="설정을 저장하고 나갈까요?"
            confirmLabel="저장"
            altLabel="저장 안 함"
            cancelLabel="닫기"
            onConfirm={leaveSave}
            onAlt={leaveDiscard}
            onCancel={clearPendingNav}
          />
        )}
      </div>
    </SettingsContext.Provider>
  )
}
