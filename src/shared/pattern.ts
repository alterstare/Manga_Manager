// Folder-name pattern shared by doujin detection (parser) and download naming.
// Tokens: -id- -title- -artist- -group- -language-. Both the main process (to
// name a downloaded folder) and the renderer (to preview an example) fill a
// pattern with the same logic, so it lives in shared.

export interface NameFields {
  id?: string
  title?: string
  artist?: string
  group?: string
  language?: string
}

const FILL_RE = /-(id|title|artist|group|language)-/g

export function fillNamePattern(pattern: string, f: NameFields): string {
  return pattern
    .replace(FILL_RE, (_m, t: keyof NameFields) => f[t] ?? '')
    // Drop bracket/paren groups left empty when a token had no value.
    .replace(/\[\s*\]|\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// doujin language strings (lowercase english) → short display codes.
const LANG_CODE: Record<string, string> = {
  korean: 'KOR',
  chinese: 'CHN',
  japanese: 'JPN',
  english: 'ENG'
}

export function langCode(lang: string | null | undefined): string {
  if (!lang) return 'ETC'
  return LANG_CODE[lang.toLowerCase()] ?? 'ETC'
}

// Sample values for the live example preview in Settings.
export const SAMPLE_FIELDS: NameFields = {
  id: '1234567',
  title: '제목',
  artist: '작가',
  group: '서클',
  language: 'KOR'
}
