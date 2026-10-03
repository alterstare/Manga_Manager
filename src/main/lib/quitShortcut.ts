import { app, globalShortcut } from 'electron'
import type { Settings } from '../../shared/types'
import { shortcutCombos, toAccelerator } from '../../shared/shortcuts'

// Emergency force-quit (global, so it works even when the renderer is a black
// screen). Combo is user-editable (설정 › 단축키 › 강제 종료); re-applied on save.
export function applyQuitShortcut(s: Settings): void {
  globalShortcut.unregisterAll()
  for (const c of shortcutCombos(s.shortcuts, 'forceQuit')) {
    try {
      globalShortcut.register(toAccelerator(c), () => app.exit(0))
    } catch {
      /* invalid / taken accelerator — skip */
    }
  }
}
