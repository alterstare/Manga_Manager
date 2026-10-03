// Keyboard shortcuts: the full list (shown + editable in 설정 › 단축키) and the
// helpers that turn a key event into a combo string. Shared by the renderer
// (all in-app shortcuts) and main (the global force-quit accelerator).
//
// A combo is "Ctrl+Shift+T"-style: modifiers in the fixed order Ctrl, Alt,
// Shift, then one key. Letter/digit keys use the physical key (KeyboardEvent
// .code), so shortcuts keep working with the Korean IME on.

export type ShortcutId =
  | 'focusSearch'
  | 'switchMode'
  | 'goLibrary'
  | 'goOnline'
  | 'navBack'
  | 'navForward'
  | 'closeTab'
  | 'reopenTab'
  | 'nextTab'
  | 'prevTab'
  | 'tab3'
  | 'tab4'
  | 'tab5'
  | 'tab6'
  | 'tab7'
  | 'tab8'
  | 'tabLast'
  | 'reload'
  | 'nextPage'
  | 'prevPage'
  | 'transUndo'
  | 'transRedo'
  | 'forceQuit'

export interface ShortcutDef {
  id: ShortcutId
  label: string
  group: string
  defaults: string[]
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'focusSearch', group: '일반', label: '검색창으로 이동', defaults: ['Ctrl+K', 'Alt+D'] },
  { id: 'switchMode', group: '일반', label: '동인지 ⇄ 일반 만화 모드 전환', defaults: ['Ctrl+G'] },
  { id: 'goLibrary', group: '일반', label: '라이브러리 열기', defaults: ['Ctrl+1'] },
  { id: 'goOnline', group: '일반', label: '온라인 열기', defaults: ['Ctrl+2'] },
  { id: 'navBack', group: '일반', label: '뒤로', defaults: ['Alt+ArrowLeft'] },
  { id: 'navForward', group: '일반', label: '앞으로', defaults: ['Alt+ArrowRight'] },
  { id: 'reload', group: '일반', label: '새로고침', defaults: ['F5'] },
  { id: 'forceQuit', group: '일반', label: '강제 종료 (화면이 멈췄을 때도 동작)', defaults: ['Ctrl+Shift+Q'] },
  { id: 'closeTab', group: '탭', label: '현재 탭 닫기', defaults: ['Ctrl+W'] },
  { id: 'reopenTab', group: '탭', label: '닫은 탭 다시 열기', defaults: ['Ctrl+Shift+T'] },
  { id: 'nextTab', group: '탭', label: '다음 탭', defaults: ['Ctrl+Tab'] },
  { id: 'prevTab', group: '탭', label: '이전 탭', defaults: ['Ctrl+Shift+Tab'] },
  { id: 'tab3', group: '탭', label: '첫 번째 탭', defaults: ['Ctrl+3'] },
  { id: 'tab4', group: '탭', label: '두 번째 탭', defaults: ['Ctrl+4'] },
  { id: 'tab5', group: '탭', label: '세 번째 탭', defaults: ['Ctrl+5'] },
  { id: 'tab6', group: '탭', label: '네 번째 탭', defaults: ['Ctrl+6'] },
  { id: 'tab7', group: '탭', label: '다섯 번째 탭', defaults: ['Ctrl+7'] },
  { id: 'tab8', group: '탭', label: '여섯 번째 탭', defaults: ['Ctrl+8'] },
  { id: 'tabLast', group: '탭', label: '마지막 탭', defaults: ['Ctrl+9'] },
  { id: 'nextPage', group: '감상', label: '다음 페이지', defaults: ['ArrowRight', 'PageDown'] },
  { id: 'prevPage', group: '감상', label: '이전 페이지', defaults: ['ArrowLeft', 'PageUp'] },
  { id: 'transUndo', group: '번역 편집', label: '실행 취소', defaults: ['Ctrl+Z'] },
  { id: 'transRedo', group: '번역 편집', label: '다시 실행', defaults: ['Ctrl+Shift+Z', 'Ctrl+Y'] }
]

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'HangulMode', 'Process'])

// Key part of a combo from an event: physical letter/digit (IME-proof), else
// the named key ("ArrowLeft", "F5", "Tab", "PageDown" …). null = modifier only.
function keyName(e: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const m = /^(?:Key([A-Z])|Digit([0-9])|Numpad([0-9]))$/.exec(e.code)
  if (m) return m[1] ?? m[2] ?? m[3]
  if (e.key === ' ') return 'Space'
  return e.key.length === 1 ? e.key.toUpperCase() : e.key
}

// "Ctrl+Shift+T" for a key event (Cmd counts as Ctrl), or null for a lone modifier.
export function comboFromEvent(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>
): string | null {
  const k = keyName(e)
  if (!k) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(k)
  return parts.join('+')
}

// Effective combos of a shortcut: the user's override, else the defaults.
export function shortcutCombos(overrides: Partial<Record<string, string[]>> | undefined, id: ShortcutId): string[] {
  return overrides?.[id] ?? SHORTCUTS.find((s) => s.id === id)?.defaults ?? []
}

// Display form ("Ctrl + ←").
const PRETTY: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓'
}
export function prettyCombo(c: string): string {
  return c
    .split('+')
    .map((p) => PRETTY[p] ?? p)
    .join(' + ')
}

// Electron accelerator for a combo (main's global force-quit).
export function toAccelerator(c: string): string {
  return c
    .split('+')
    .map((p) => (p === 'Ctrl' ? 'CommandOrControl' : p === 'ArrowLeft' ? 'Left' : p === 'ArrowRight' ? 'Right' : p === 'ArrowUp' ? 'Up' : p === 'ArrowDown' ? 'Down' : p))
    .join('+')
}
