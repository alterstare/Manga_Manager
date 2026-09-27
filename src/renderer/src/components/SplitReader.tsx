import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { Tab, PaneSrc } from '../store'
import Reader from './Reader'
import Thumb from './Thumb'

// Renders a split tab: two reader panes with a draggable divider. An empty right
// pane shows a picker of the other open tabs (Chrome-style).
export default function SplitReader({ tab }: { tab: Tab }): JSX.Element {
  const ratio = tab.splitRatio ?? 0.5
  const setSplitRatio = useStore((s) => s.setSplitRatio)
  const fillSplitRight = useStore((s) => s.fillSplitRight)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!dragging.current) return
      const el = containerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setSplitRatio(tab.id, (e.clientX - r.left) / r.width)
    }
    const onUp = (): void => {
      if (dragging.current) {
        dragging.current = false
        document.body.classList.remove('resizing')
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [tab.id, setSplitRatio])

  const rightHasContent = !!(tab.rightWorkId || tab.rightOnline)

  return (
    <div className="split-reader" ref={containerRef}>
      <div className="split-pane" style={{ flex: `0 0 ${ratio * 100}%` }}>
        <Reader key={`${tab.id}:left`} tabId={tab.id} side="left" />
      </div>
      <div
        className="split-divider"
        onMouseDown={() => {
          dragging.current = true
          document.body.classList.add('resizing')
        }}
      />
      <div className="split-pane" style={{ flex: '1 1 0' }}>
        {rightHasContent ? (
          <Reader key={`${tab.id}:right`} tabId={tab.id} side="right" />
        ) : (
          <SplitPicker tab={tab} onPick={(src) => fillSplitRight(tab.id, src)} />
        )}
      </div>
    </div>
  )
}

function SplitPicker({ tab, onPick }: { tab: Tab; onPick: (src: PaneSrc) => void }): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const works = useStore((s) => s.works)
  // Only offer tabs from the SAME library mode — hitomi and general manga are
  // separate collections and must not be mixed in one split.
  const mode = tab.mode ?? 'hitomi'
  const candidates = tabs.filter((t) => t.id !== tab.id && !t.split && (t.mode ?? 'hitomi') === mode)

  return (
    <div className="split-picker">
      <h3>분할 뷰에 추가할 탭을 선택하세요</h3>
      {candidates.length === 0 && (
        <div className="hint">
          열린 다른 탭이 없습니다. 작품 목록에서 우클릭 → ‘분할 뷰에서 열기’로 추가하세요.
        </div>
      )}
      <div className="split-pick-list">
        {candidates.map((t) => {
          const work = t.online ? null : works.find((w) => w.id === t.workId)
          const title = t.online ? t.online.title : work?.title ?? '(삭제됨)'
          const artist = t.online ? t.online.artist : work?.artist
          const pages = work?.pageCount
          const lang = work?.language
          const code = t.online ? t.online.code : work?.code
          return (
            <button
              key={t.id}
              className="split-pick-item"
              onClick={() => onPick(t.online ? { online: t.online } : { workId: t.workId })}
            >
              <div className="split-pick-thumb">
                {work ? <Thumb workId={work.id} /> : <div className="thumb-ph">🌐</div>}
              </div>
              <div className="split-pick-info">
                <div className="split-pick-title">{title}</div>
                <div className="split-pick-meta">
                  {artist && <span>{artist}</span>}
                  {pages != null && <span>{pages}p</span>}
                  {lang && <span className="lang">{lang}</span>}
                  {code && <span className="code">[{code}]</span>}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
