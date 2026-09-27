import { useEffect } from 'react'
import type { JSX } from 'react'

// Generic styled confirm dialog (shares the exit-modal look). Used for group
// move (유지/옮김) and group delete (삭제/취소).
export default function ConfirmModal({
  title,
  desc,
  icon = '？',
  confirmLabel,
  cancelLabel = '취소',
  altLabel,
  danger = false,
  hideCancel = false,
  onConfirm,
  onCancel,
  onAlt
}: {
  title: string
  desc?: React.ReactNode
  icon?: string
  confirmLabel: string
  cancelLabel?: string
  altLabel?: string // optional middle action (e.g. "저장 안 함")
  danger?: boolean
  hideCancel?: boolean // single-button info dialog
  onConfirm: () => void
  onCancel: () => void
  onAlt?: () => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div className="exit-backdrop" onClick={onCancel}>
      <div className="exit-modal" onClick={(e) => e.stopPropagation()}>
        <div className={`exit-icon ${danger ? 'danger' : ''}`}>{icon}</div>
        <h3 className="exit-title">{title}</h3>
        {desc && <p className="exit-desc">{desc}</p>}
        <div className="exit-actions">
          <button
            className={`exit-btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          {altLabel && onAlt && (
            <button className="exit-btn ghost" onClick={onAlt}>
              {altLabel}
            </button>
          )}
          {!hideCancel && (
            <button className="exit-btn ghost" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
