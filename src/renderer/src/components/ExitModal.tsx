import { useEffect } from 'react'
import type { JSX } from 'react'

// Styled exit confirmation (replaces the native dialog). Dark base + our green
// accent. Three choices: keep tabs / clear tabs / cancel.
export default function ExitModal({
  onChoose
}: {
  onChoose: (decision: 'keep' | 'clear' | 'cancel') => void
}): JSX.Element {
  // Esc cancels, Enter confirms (keep).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onChoose('cancel')
      else if (e.key === 'Enter') onChoose('keep')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onChoose])

  return (
    <div className="exit-backdrop" onClick={() => onChoose('cancel')}>
      <div className="exit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="exit-icon">⏻</div>
        <h3 className="exit-title">정말 종료하시겠습니까?</h3>
        <p className="exit-desc">
          <b>저장 &amp; 종료</b> — 지금 열린 탭을 다음 실행 때 그대로 복원
          <br />
          <b>종료</b> — 탭을 비우고 다음에는 빈 상태로 시작
        </p>
        <div className="exit-actions">
          <button className="exit-btn primary" onClick={() => onChoose('keep')}>
            저장 &amp; 종료
          </button>
          <button className="exit-btn" onClick={() => onChoose('clear')}>
            종료
          </button>
          <button className="exit-btn ghost" onClick={() => onChoose('cancel')}>
            취소
          </button>
        </div>
      </div>
    </div>
  )
}
