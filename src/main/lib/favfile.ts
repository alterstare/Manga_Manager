// Favorite-file (JSON) format helpers, compatible with Pupil and its variants.
//
// Shape we write:  { favorites: [ids], favorite_tags: [{ area, tag }], ranks? }
// Shapes we read:  a bare id array, or an object holding the ids under any of
//                  favorites / favorite / bookmark(s) / ids / galleries / items /
//                  list; elements may be numbers, strings, or objects carrying
//                  id / galleryid / gallery_id / gallery.id.

// Tolerant extractor for doujin gallery ids (deduped, numeric strings only).
export function parseIds(raw: any): string[] {
  const out: string[] = []
  const pushFrom = (arr: any[]): void => {
    for (const x of arr) {
      const v = x && typeof x === 'object' ? (x.id ?? x.galleryid ?? x.gallery_id ?? x.gallery?.id) : x
      const s = String(v)
      if (s && s !== 'undefined' && s !== 'null' && /^\d+$/.test(s)) out.push(s)
    }
  }
  if (Array.isArray(raw)) pushFrom(raw)
  else if (raw && typeof raw === 'object') {
    for (const k of ['favorites', 'favorite', 'bookmark', 'bookmarks', 'ids', 'galleries', 'items', 'list']) {
      if (Array.isArray(raw[k])) pushFrom(raw[k])
    }
  }
  return [...new Set(out)]
}

// Pupil favorite_tags ↔ our flat favoriteTags strings. Pupil stores
// { area: 'artist' | 'tag' | 'female' | …, tag: 'name' }; we store 'name' (plain
// tag) or 'area:name'.
export function tagToEntry(t: string): { area: string; tag: string } {
  const i = t.indexOf(':')
  return i > 0 ? { area: t.slice(0, i), tag: t.slice(i + 1) } : { area: 'tag', tag: t }
}

function entryToTag(e: any): string {
  if (!e || typeof e !== 'object') return ''
  const tag = String(e.tag ?? '').trim()
  if (!tag) return ''
  return e.area && e.area !== 'tag' ? `${e.area}:${tag}` : tag
}

export function parseFavoriteTags(raw: any): string[] {
  const arr = raw && Array.isArray(raw.favorite_tags) ? raw.favorite_tags : []
  return [...new Set(arr.map(entryToTag).filter(Boolean))] as string[]
}

// Name of a favorite list imported from a file: the file name without its
// extension (':' and ',' replaced — list names are also shown as filter chips).
export function listNameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[:,]/g, ' ').trim() || '목록'
}
