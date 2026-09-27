import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'

// Match a token against the typed term by its VALUE (namespace prefix stripped),
// so "kagu" matches "artist:kagura" without "artist:" itself swallowing the query.
// A namespaced term (e.g. "female:big") restricts to that namespace and matches on
// the value only. Returns a rank: word-start (0) beats mid-word (1); non-match null.
function rankToken(token: string, term: string): number | null {
  const tc = term.indexOf(':')
  const tns = tc !== -1 ? term.slice(0, tc).toLowerCase() : null
  const tval = (tc !== -1 ? term.slice(tc + 1) : term).replace(/_/g, ' ').toLowerCase().trim()
  if (!tval) return null
  const c = token.indexOf(':')
  const kns = (c !== -1 ? token.slice(0, c) : 'tag').toLowerCase()
  if (tns && kns !== tns) return null
  const value = (c !== -1 ? token.slice(c + 1) : token).replace(/_/g, ' ').toLowerCase()
  const idx = value.indexOf(tval)
  if (idx === -1) return null
  return idx === 0 || value[idx - 1] === ' ' ? 0 : 1
}

// Search input with a dark, app-styled tag autocomplete. Suggestions complete the
// LAST whitespace-separated word of the query, so earlier tokens are kept.
// `tokens` are local (library) suggestions matched synchronously; the optional
// `fetchTokens` pulls extra suggestions async (e.g. the bundled hitomi artist list
// + browsed tags) for the online search box.
export default function TagSearchInput({
  value,
  onChange,
  onEnter,
  tokens,
  fetchTokens,
  placeholder,
  history,
  onPickHistory,
  favorites,
  onPickFavorite
}: {
  value: string
  onChange: (v: string) => void
  onEnter: () => void
  tokens: string[]
  fetchTokens?: (query: string) => Promise<string[]>
  placeholder?: string
  // When the box is focused and EMPTY, show recent searches instead of matches.
  history?: string[]
  onPickHistory?: (query: string) => void
  // Saved searches (tag/combo) pinned above the history in the empty-state dropdown.
  favorites?: string[]
  onPickFavorite?: (query: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const [remote, setRemote] = useState<string[]>([])
  // Empty-state dropdown toggles between recent searches and saved favorites.
  const [showFav, setShowFav] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  // Combos are comma-separated (hitomi's own delimiter); tag VALUES may contain
  // spaces ("big breasts"), so split on comma ONLY — never whitespace — and
  // autocomplete the last comma-segment.
  const lastWord = (value.split(',').pop() ?? '').trim()

  // Local (library) matches, value-based + ranked.
  const localMatches = useMemo(() => {
    if (!lastWord) return []
    return tokens
      .map((t) => ({ t, r: rankToken(t, lastWord) }))
      .filter((x): x is { t: string; r: number } => x.r !== null)
      .sort((a, b) => a.r - b.r || a.t.localeCompare(b.t))
      .map((x) => x.t)
  }, [tokens, lastWord])

  // Async matches (bundled artists + browsed tags) — debounced, latest-wins.
  useEffect(() => {
    if (!fetchTokens || !lastWord) {
      setRemote([])
      return
    }
    const id = ++seq.current
    const timer = setTimeout(() => {
      fetchTokens(lastWord)
        .then((r) => {
          if (id === seq.current) setRemote(r)
        })
        .catch(() => {
          if (id === seq.current) setRemote([])
        })
    }, 140)
    return () => clearTimeout(timer)
  }, [fetchTokens, lastWord])

  // Merge: local library first (already-owned), then remote, deduped, capped.
  const matches = useMemo(() => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const t of [...localMatches, ...remote]) {
      if (seen.has(t)) continue
      seen.add(t)
      out.push(t)
      if (out.length >= 30) break
    }
    return out
  }, [localMatches, remote])

  const empty = !value.trim()
  const hasFav = (favorites?.length ?? 0) > 0
  const hasHist = (history?.length ?? 0) > 0
  const favTab = showFav && hasFav
  // Favorites list stays open even with text in the box (so the user can keep
  // appending tags to compose a combo); recent history only shows when empty.
  // Even with no history, an empty box still opens (so the fav toggle is reachable).
  const showPanel = open && (favTab ? hasFav : empty && (hasHist || hasFav))
  // Suppress the autocomplete list while the favorites list is active.
  const show = open && !empty && matches.length > 0 && !favTab
  const panelItems = favTab ? favorites ?? [] : history ?? []

  const pick = (tok: string): void => {
    // Replace the last comma-segment with the picked token, keeping earlier tags.
    const idx = value.lastIndexOf(',')
    const head = idx >= 0 ? value.slice(0, idx + 1) + ' ' : ''
    onChange(head + tok)
    setHi(-1)
    inputRef.current?.focus()
  }

  return (
    <div className="search-ac">
      <input
        ref={inputRef}
        className="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHi(-1)
        }}
        onFocus={() => setOpen(true)}
        // Delay so a click on a suggestion registers before the list unmounts.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (show && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            setHi((h) => {
              const n = matches.length
              return e.key === 'ArrowDown' ? (h + 1) % n : (h - 1 + n) % n
            })
            return
          }
          if (e.key === 'Escape') {
            setOpen(false)
            setHi(-1)
            return
          }
          if (e.key === 'Enter') {
            if (show && hi >= 0) {
              e.preventDefault()
              pick(matches[hi])
            } else {
              setOpen(false)
              onEnter()
            }
          }
        }}
      />
      {show && (
        <ul className="search-ac-list">
          {matches.map((t, i) => (
            <li
              key={t}
              className={i === hi ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault() // keep input focus
                pick(t)
              }}
              onMouseEnter={() => setHi(i)}
            >
              {t}
            </li>
          ))}
        </ul>
      )}
      {showPanel && (
        <ul className="search-ac-list">
          {/* Top row: toggle between 최근 검색 and 즐겨찾는 태그 (only if favorites exist). */}
          {hasFav && (
            <li
              className="search-ac-toggle"
              onMouseDown={(e) => {
                e.preventDefault() // keep focus + dropdown open
                setShowFav((v) => !v)
              }}
            >
              {favTab ? '최근 검색 보기' : '즐겨찾는 태그 보기'}
            </li>
          )}
          {panelItems.length === 0 ? (
            <li className="search-ac-empty">{favTab ? '즐겨찾는 태그가 없습니다.' : '최근 검색이 없습니다.'}</li>
          ) : (
            panelItems.map((item) => (
              <li
                key={item}
                className={favTab ? 'search-ac-fav' : 'search-ac-hist'}
                onMouseDown={(e) => {
                  e.preventDefault() // keep input focus
                  if (favTab) {
                    // Append to the box; keep the list open to compose a combo.
                    onPickFavorite?.(item)
                  } else {
                    onPickHistory?.(item)
                    setOpen(false)
                  }
                }}
              >
                {item}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
