import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import ContextMenu from './ContextMenu'

type Field = HTMLInputElement | HTMLTextAreaElement

// Right-click menu for every text field (search boxes, settings inputs …):
// 잘라내기 / 복사 / 붙여넣기 / 전체 선택, in the app's own menu style. Electron
// shows no edit menu by default. The selection is captured when the menu opens
// (clicking the menu moves focus away), and edits go through setRangeText + an
// `input` event so React-controlled fields see the change.
const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number', ''])

export default function EditContextMenu(): JSX.Element | null {
  const [menu, setMenu] = useState<{ x: number; y: number; el: Field; start: number; end: number } | null>(null)

  useEffect(() => {
    const onMenu = (e: MouseEvent): void => {
      if (e.defaultPrevented) return // a component already shows its own menu
      const el = e.target as HTMLElement
      const field =
        el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type)) ? el : null
      if (!field || field.disabled) return
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, el: field, start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 })
    }
    document.addEventListener('contextmenu', onMenu)
    return () => document.removeEventListener('contextmenu', onMenu)
  }, [])

  if (!menu) return null
  const { el, start, end } = menu
  const selected = el.value.slice(start, end)
  const readOnly = el.readOnly
  const replace = (text: string): void => {
    el.focus()
    el.setRangeText(text, start, end, 'end')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={[
        {
          label: '잘라내기',
          disabled: !selected || readOnly,
          onClick: () => {
            void window.api.clipboardWriteText(selected)
            replace('')
          }
        },
        { label: '복사', disabled: !selected, onClick: () => void window.api.clipboardWriteText(selected) },
        {
          label: '붙여넣기',
          disabled: readOnly,
          onClick: () => void window.api.clipboardReadText().then((t) => t && replace(t))
        },
        {
          label: '전체 선택',
          disabled: !el.value,
          onClick: () => {
            el.focus()
            el.select()
          }
        }
      ]}
      onClose={() => setMenu(null)}
    />
  )
}
