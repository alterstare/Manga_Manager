import { useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import { useStore } from '../store'
import ContextMenu from './ContextMenu'

// Right-click menu shared by every tag / artist chip in the app:
//   • cross-search — a local card searches the term ONLINE, an online card
//     searches it in the LOCAL library (`target` picks which side),
//   • "복사" — the tag / artist text as shown,
//   • "즐겨찾는 태그로 추가" — highlight the raw tag everywhere,
//   • (doujin only) "검색 제외 태그로 추가/에서 빼기" — 설정 › 검색 제외 태그,
//     hidden from online browse/search.
//
// Usage:
//   const { openTagMenu, tagMenu } = useTagMenu('online')
//   <span onContextMenu={(e) => openTagMenu(e, tagToken(t), t)}>…</span>
//   …
//   {tagMenu}   ← render once, anywhere inside the component
//
// `query` is the search token (e.g. "artist:foo", "female:bar"); `raw` is the
// tag text as shown, used for the favorite-tag list.
export function useTagMenu(target: 'online' | 'local'): {
  openTagMenu: (e: MouseEvent, query: string, raw: string) => void
  tagMenu: JSX.Element | null
} {
  const [menu, setMenu] = useState<{ x: number; y: number; query: string; raw: string } | null>(null)
  const searchOnline = useStore((s) => s.searchOnline)
  const searchLocal = useStore((s) => s.searchLocal)
  const addFavoriteTag = useStore((s) => s.addFavoriteTag)
  const toggleExcludeTag = useStore((s) => s.toggleExcludeTag)
  const excludeTags = useStore((s) => s.settings.onlineExcludeTags)
  const hitomiMode = useStore((s) => s.libraryMode !== 'normal')

  const openTagMenu = (e: MouseEvent, query: string, raw: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, query, raw })
  }

  const tagMenu = menu && (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={[
        target === 'online'
          ? { label: '온라인에서 검색', onClick: () => searchOnline(menu.query) }
          : { label: '로컬에서 검색', onClick: () => searchLocal(menu.query) },
        { label: '복사', onClick: () => void window.api.clipboardWriteText(menu.raw) },
        { label: '즐겨찾는 태그로 추가', onClick: () => addFavoriteTag(menu.raw) },
        ...(hitomiMode
          ? [
              {
                label: (excludeTags ?? []).includes(menu.query) ? '검색 제외 태그에서 빼기' : '검색 제외 태그로 추가',
                onClick: () => toggleExcludeTag(menu.query)
              }
            ]
          : [])
      ]}
      onClose={() => setMenu(null)}
    />
  )

  return { openTagMenu, tagMenu }
}
