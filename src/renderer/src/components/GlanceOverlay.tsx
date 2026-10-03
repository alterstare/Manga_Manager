import { useEffect } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import Reader from './Reader'
import { MaximizeIcon, CloseIcon, NoteStackIcon } from './icons'

// Zen-style "Glance" peek: shows a work/online gallery in a floating reader over
// the current view without creating a real tab. Esc or a backdrop click closes it;
// "새 탭으로" promotes it into a normal tab.
export default function GlanceOverlay(): JSX.Element | null {
  const glanceTabId = useStore((s) => s.glanceTabId)
  const closeGlance = useStore((s) => s.closeGlance)
  const promoteGlance = useStore((s) => s.promoteGlance)

  useEffect(() => {
    if (!glanceTabId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        closeGlance()
      }
    }
    // Capture phase so the glance closes before other Esc handlers (search, etc.).
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [glanceTabId, closeGlance])

  if (!glanceTabId) return null

  return createPortal(
    <div
      className="glance-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeGlance()
      }}
    >
      <div className="glance-window" onMouseDown={(e) => e.stopPropagation()}>
        <div className="glance-bar">
          <span className="glance-title">
            <NoteStackIcon /> Overview
          </span>
          <div className="glance-actions flat-group">
            <button className="mini icon" onClick={promoteGlance} title="새 탭으로 열기">
              <MaximizeIcon />
            </button>
            <button className="mini icon" onClick={closeGlance} title="닫기 (Esc)">
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="glance-body">
          <Reader tabId={glanceTabId} />
        </div>
      </div>
    </div>,
    document.body
  )
}
