// Process-wide state shared by the app lifecycle (index.ts) and every IPC
// module (ipc/*.ts): the persisted store, the main window handle, and the
// close/quit flags that tell window-close vetoes to stand down.
import type { BrowserWindow } from 'electron'
import { Store } from './lib/store'

// Library, settings, session and online favorites (loaded once at startup).
export const store = new Store()

// Lifecycle flags.
//  closing  — the user confirmed the in-app exit modal; let the window close.
//  quitting — the app is quitting (quit, relaunch after reset, update install);
//             every close veto (main window + toki scraper) must stand down.
export const appState = { closing: false, quitting: false }

let mainWindow: BrowserWindow | null = null

export function setMainWindow(w: BrowserWindow | null): void {
  mainWindow = w
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

// Push an event to the renderer. Safe to call at any time: progress callbacks of
// downloads/scrapes can still fire after the window was closed.
export function sendToRenderer(channel: string, payload?: unknown): void {
  getMainWindow()?.webContents.send(channel, payload)
}

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
