// Shared state of the Settings screen, provided by Settings.tsx to every
// section component (settings/*Section.tsx).
//
// All edits go to `draft` (via patch) and are persisted only on 저장 — except
// actions that already wrote to disk through IPC (imports, scans, reset), which
// push the stored result back with applySaved.
import { createContext, useContext } from 'react'
import type { Settings, Work } from '../../../../shared/types'

export interface SettingsCtl {
  draft: Settings
  patch: (p: Partial<Settings>) => void
  // Settings were saved by main (import/reset): adopt them as both the store's
  // settings and the draft, so nothing shows as unsaved.
  applySaved: (s: Settings) => void
  isHitomi: boolean // which library mode's settings are being edited
  works: Work[]
  // Show a "완료" result modal.
  notify: (msg: string) => void
  // Folder rescan (feature 8): re-derives favorite/group membership from where
  // works sit. `rescanning` = the path being rescanned (button shows progress).
  rescanning: string | null
  rescan: (path: string, mode: 'hitomi' | 'normal') => Promise<void>
  // Open the folder picker; `apply` runs only if the user chose a folder.
  pickDir: (apply: (dir: string) => void) => Promise<void>
}

export const SettingsContext = createContext<SettingsCtl | null>(null)

export function useSettings(): SettingsCtl {
  const ctl = useContext(SettingsContext)
  if (!ctl) throw new Error('useSettings outside <Settings>')
  return ctl
}
