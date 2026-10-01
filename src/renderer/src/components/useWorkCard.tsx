import { useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import type { Work } from '../../../shared/types'
import { useStore } from '../store'
import { invalidate } from '../images'
import ContextMenu from './ContextMenu'
import { useTagMenu } from './useTagMenu'

// Everything a local work card (list WorkCard / grid WorkGridCard) does besides
// its layout:
//   • cardEvents — spread onto the card root: click opens a tab, middle-click
//     opens it in the background, Alt+click opens Glance, right-click opens the
//     work menu, and a text selection (drag-to-copy) never opens anything
//   • isFav / toggleFav — the unified favorite (local + online)
//   • setRank, removeTag, and the inline "+ 태그" editor (startAddTag / tagInput)
//   • workMenu / tagMenu — the two context menus; render both once in the card
//   • openTagMenu — right-click handler for tag/artist chips
export function useWorkCard(work: Work): {
  cardEvents: {
    onClickCapture: (e: MouseEvent) => void
    onClick: () => void
    onMouseDown: (e: MouseEvent) => void
    onAuxClick: (e: MouseEvent) => void
    onContextMenu: (e: MouseEvent) => void
  }
  isFav: boolean
  toggleFav: (e: MouseEvent) => Promise<void>
  setRank: (rank: number) => Promise<void>
  removeTag: (tag: string) => Promise<void>
  adding: boolean
  startAddTag: () => void
  tagInput: JSX.Element | null
  workMenu: JSX.Element | null
  openTagMenu: (e: MouseEvent, query: string, raw: string) => void
  tagMenu: JSX.Element | null
} {
  const openTab = useStore((s) => s.openTab)
  const openTabBackground = useStore((s) => s.openTabBackground)
  const openGlance = useStore((s) => s.openGlance)
  const openSplit = useStore((s) => s.openSplit)
  const startDownload = useStore((s) => s.startDownload)
  const splitOpen = useStore((s) => !!s.tabs.find((t) => t.id === s.activeTabId)?.split)
  const upsertWork = useStore((s) => s.upsertWork)
  const setWorkFavorite = useStore((s) => s.setWorkFavorite)
  const onlineFav = useStore((s) => !!(work.code && s.onlineFavs[work.code]?.favorite))
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [adding, setAdding] = useState(false)
  const [newTag, setNewTag] = useState('')
  const { openTagMenu, tagMenu } = useTagMenu('online')

  const cardEvents = {
    // Capture phase so Alt+click works anywhere on the card, even over children
    // (artist/tag chips) that stop propagation.
    onClickCapture: (e: MouseEvent): void => {
      if (window.getSelection()?.toString()) return e.stopPropagation()
      if (e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        openGlance({ workId: work.id })
      }
    },
    onClick: (): void => openTab(work.id),
    onMouseDown: (e: MouseEvent): void => {
      if (e.button === 1) e.preventDefault() // block middle-click autoscroll
    },
    onAuxClick: (e: MouseEvent): void => {
      if (e.button !== 1) return
      e.preventDefault()
      openTabBackground(work.id)
    },
    onContextMenu: (e: MouseEvent): void => {
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY })
    }
  }

  // The heart is the unified favorite: coded hitomi works share it with the
  // online side (main moves the folder per settings). Cached page urls are
  // dropped because a move changes the work's path.
  const isFav = work.favorite || onlineFav
  const toggleFav = async (e: MouseEvent): Promise<void> => {
    e.stopPropagation()
    await setWorkFavorite(work, !isFav)
    invalidate(work.id)
  }

  const setRank = async (rank: number): Promise<void> => {
    upsertWork(await window.api.setRank(work.id, rank))
  }

  const addTag = async (): Promise<void> => {
    const t = newTag.trim()
    if (t) upsertWork(await window.api.addManualTag(work.id, t))
    setNewTag('')
    setAdding(false)
  }
  const removeTag = async (tag: string): Promise<void> => {
    upsertWork(await window.api.removeManualTag(work.id, tag))
  }
  const tagInput = adding ? (
    <input
      autoFocus
      className="tag-input"
      value={newTag}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setNewTag(e.target.value)}
      onBlur={addTag}
      onKeyDown={(e) => e.key === 'Enter' && addTag()}
      placeholder="태그…"
    />
  ) : null

  const workMenu = menu && (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={[
        { label: '새 탭에서 열기', onClick: () => openTab(work.id) },
        { label: '백그라운드에서 열기', onClick: () => openTabBackground(work.id) },
        { label: splitOpen ? '오른쪽 뷰에서 열기' : '분할 뷰에서 열기', onClick: () => openSplit(work.id) },
        ...(work.code && (work.library ?? 'hitomi') === 'hitomi'
          ? [{ label: '다시 다운로드', onClick: () => startDownload({ kind: 'hitomi' as const, input: work.code! }) }]
          : [])
      ]}
      onClose={() => setMenu(null)}
    />
  )

  return {
    cardEvents,
    isFav,
    toggleFav,
    setRank,
    removeTag,
    adding,
    startAddTag: () => setAdding(true),
    tagInput,
    workMenu,
    openTagMenu,
    tagMenu
  }
}
