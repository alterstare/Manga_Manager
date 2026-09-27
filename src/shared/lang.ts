// Language categorization shared by main (organize) and renderer (filters).
// Korean is the default language; anything not ko/en/ja falls under 'other'.
export type LangCat = 'korean' | 'english' | 'japanese' | 'other'

export function langCategory(lang: string | null): LangCat | null {
  if (!lang) return null
  const l = lang.toLowerCase()
  if (l === 'korean') return 'korean'
  if (l === 'english') return 'english'
  if (l === 'japanese') return 'japanese'
  return 'other'
}

export const LANG_CAT_LABELS: Record<LangCat, string> = {
  korean: '한국어',
  english: '영어',
  japanese: '일본어',
  other: '기타'
}
