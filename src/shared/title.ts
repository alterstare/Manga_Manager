// Title normalization + similarity for cross-language matching (used by the
// Korean-edition finder in main and the duplicate / translation-pair finders
// in the renderer).

// Bracket groups — [circle], (event), 【…】, 「…」 … — dropped before matching.
const TITLE_BRACKET = /[[(（【「『〔［{][^\])）】」』〕］}]*[\])）】」』〕］}]/g

// Lowercase; keep only alphanumerics, Japanese kana/kanji and Hangul; collapse spaces.
export function titleNorm(t: string): string {
  return t
    .replace(TITLE_BRACKET, ' ')
    .toLowerCase()
    .replace(/[^0-9a-z぀-ヿ一-鿿가-힯]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleTokens(t: string): Set<string> {
  return new Set(titleNorm(t).split(' ').filter((w) => w.length >= 2))
}

// 0..1 similarity. Containment (원제 ⊂ 원제+한글제목) scores 1, else the share
// of common words.
//   'loose'  — any containment (≥4 chars) counts; words shared / the SMALLER
//              set. For finding candidates (Korean editions of one artist).
//   'strict' — containment only if the shorter title is ≥60% of the longer;
//              words shared / the LARGER set, so a few common words don't
//              pass. For auto-detected duplicates / translation pairs.
export function titleSim(a: string, b: string, mode: 'loose' | 'strict'): number {
  const na = titleNorm(a)
  const nb = titleNorm(b)
  if (!na || !nb) return 0
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na]
  if (short.length >= 4 && long.includes(short) && (mode === 'loose' || short.length / long.length >= 0.6))
    return 1
  const ta = titleTokens(a)
  const tb = titleTokens(b)
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const w of ta) if (tb.has(w)) inter++
  return inter / (mode === 'loose' ? Math.min(ta.size, tb.size) : Math.max(ta.size, tb.size))
}
