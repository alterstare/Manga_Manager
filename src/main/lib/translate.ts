import type { Settings } from '../../shared/types'
import type { TransResult, TransBlock } from '../../shared/ipc'

// Translation engine. Provider A (cloud) = Papago Image Translation(Text): one
// Naver Papago call does OCR + translation. Provider B (localServer) = a local
// manga-image-translator HTTP server (added later).

// Papago supports ja/en/zh-CN/zh-TW (+ko). Map our language names / hints.
function papagoSource(hint?: string): string {
  const h = (hint ?? '').toLowerCase()
  if (h.startsWith('ja') || h === 'japanese') return 'ja'
  if (h.startsWith('en') || h === 'english') return 'en'
  if (h === 'zh-tw' || h === 'chinese_traditional') return 'zh-TW'
  if (h.startsWith('zh') || h === 'chinese') return 'zh-CN'
  return 'ja' // default for manga
}

function toNum(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Collect the LT/LB/RT/RB corner points from an object (Papago vertex format).
function cornersOf(o: any, into: { x: number; y: number }[]): void {
  for (const k of ['LT', 'LB', 'RT', 'RB']) {
    const c = o?.[k]
    if (c && (c.x !== undefined || c.y !== undefined)) into.push({ x: toNum(c.x), y: toNum(c.y) })
  }
}

// Papago Image Translation(Text): data.blocks[] each {sourceText, targetText,
// lines[]}, lines/words carry LT/LB/RT/RB corner coords. One block ≈ one bubble.
function blocksFromPapago(data: any): TransBlock[] {
  const out: TransBlock[] = []
  for (const blk of data?.blocks ?? []) {
    const pts: { x: number; y: number }[] = []
    for (const line of blk.lines ?? []) {
      cornersOf(line, pts)
      for (const word of line.words ?? []) cornersOf(word, pts)
    }
    const text = String(blk.sourceText ?? '')
    const tr = String(blk.targetText ?? '')
    if (!text && !tr) continue
    let x = 0
    let y = 0
    let w = 0
    let h = 0
    if (pts.length) {
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      x = Math.min(...xs)
      y = Math.min(...ys)
      w = Math.max(...xs) - x
      h = Math.max(...ys) - y
    }
    out.push({ x, y, w, h, text, tr })
  }
  return out.filter((b) => b.w > 0 && b.h > 0)
}

async function cloudTranslate(buf: Buffer, settings: Settings, langHint?: string): Promise<TransResult> {
  if (!settings.papagoClientId || !settings.papagoClientSecret)
    throw new Error('Papago Client ID/Secret이 설정되지 않았습니다')

  const form = new FormData()
  form.append('source', papagoSource(langHint))
  form.append('target', 'ko')
  form.append('image', new Blob([new Uint8Array(buf)]), 'page.png')

  const res = await fetch(settings.papagoImageEndpoint, {
    method: 'POST',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': settings.papagoClientId,
      'X-NCP-APIGW-API-KEY': settings.papagoClientSecret
    },
    body: form
  })
  const bodyText = await res.text()
  let json: any = {}
  try {
    json = JSON.parse(bodyText)
  } catch {
    /* non-JSON body (e.g. gateway HTML) */
  }
  if (!res.ok || json.error || json.errorCode) {
    const msg =
      json.error?.message ?? json.errorMessage ?? json.message ?? (bodyText.slice(0, 300) || res.statusText)
    throw new Error(`Papago 실패 HTTP ${res.status}: ${msg}`)
  }
  const data = json.data ?? json

  const blocks = blocksFromPapago(data)
  if (blocks.length) {
    // Image dims from the document-level corners (data.LT/RB), else block extent.
    const corners: { x: number; y: number }[] = []
    cornersOf(data, corners)
    let w = corners.length ? Math.max(...corners.map((c) => c.x)) : 0
    let h = corners.length ? Math.max(...corners.map((c) => c.y)) : 0
    if (!w || !h) {
      for (const b of blocks) {
        w = Math.max(w, b.x + b.w)
        h = Math.max(h, b.y + b.h)
      }
    }
    return { ok: true, w, h, blocks }
  }
  // No per-box coordinates → fall back to a single readable panel of text.
  const t = data.targetText ?? data.translatedText ?? data.result?.targetText ?? ''
  const panelText = Array.isArray(t) ? t.join('\n') : String(t || '')
  return { ok: true, w: 0, h: 0, blocks: [], panelText }
}

// --- provider B (local server) ---------------------------------------------
async function localServerTranslate(_buf: Buffer, _settings: Settings): Promise<TransResult> {
  throw new Error('로컬 서버 번역(B안)은 아직 준비 중입니다')
}

// --- Gemini Flash: OCR + translate + boxes in one multimodal call ----------

// Resolve the source language name from a hint, or null when unknown (→ the model
// should auto-detect the page's language instead of being told a wrong one).
function sourceName(hint?: string): string | null {
  const h = (hint ?? '').toLowerCase()
  if (h.startsWith('en') || h === 'english') return 'English'
  if (h.startsWith('zh') || h === 'chinese' || h === 'chinese_traditional') return 'Chinese'
  if (h.startsWith('ja') || h === 'japanese') return 'Japanese'
  if (h.startsWith('ko') || h === 'korean') return 'Korean'
  return null
}

const GEMINI_PROMPT = (hint?: string): string => {
  const src = sourceName(hint)
  // Known language → tell the model exactly what it's reading (restricts OCR to that
  // script, cutting handwriting misreads). Unknown → let it detect per page.
  const lead = src
    ? `The image is one ${src} comic page. Recognize only the ${src} text.`
    : `The image is one comic page; detect the language of each text region (Japanese, Chinese or English) and recognize it in that language.`
  return (
    `You are a professional manga/comic translator. ${lead} ` +
    `Find the DIALOGUE and NARRATION text only — speech bubbles and caption/narration boxes. ` +
    `IGNORE sound effects, onomatopoeia and mimetic words (the large stylised text drawn into ` +
    `the artwork/background); do NOT return an object for those. ` +
    `Skip any region whose text is already Korean. ` +
    `For each separate dialogue/narration region return one object with:\n` +
    `- "box_2d": [ymin, xmin, ymax, xmax] as integers normalized to 0-1000 (tight around the text)\n` +
    `- "text": the original text (in its own language)\n` +
    `- "tr": a natural Korean translation\n` +
    `Group text that belongs to the same bubble into ONE region. Read vertical text correctly. ` +
    `Respond ONLY with a JSON array of these objects, no extra prose.`
  )
}

// Pull every balanced {...} object out of a string and parse each on its own,
// skipping any that don't parse. This salvages a usable result when the model
// returns slightly malformed JSON or a truncated array (a single bad object no
// longer kills the whole page).
function salvageObjects(t: string): any[] {
  const out: any[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(t.slice(start, i + 1)))
        } catch {
          /* skip the broken object */
        }
        start = -1
      }
    }
  }
  return out
}

// Strip ```json fences / leading prose and parse the JSON array. Falls back to
// per-object salvage when the array as a whole is malformed or truncated.
function parseJsonArray(s: string): any[] {
  let t = s.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('[')
  const end = t.lastIndexOf(']')
  const sliced = start >= 0 && end > start ? t.slice(start, end + 1) : t
  try {
    const arr = JSON.parse(sliced)
    if (Array.isArray(arr)) return arr
  } catch {
    /* fall through to salvage */
  }
  return salvageObjects(t)
}

async function geminiTranslate(
  buf: Buffer,
  settings: Settings,
  langHint: string | undefined,
  dims?: { w: number; h: number }
): Promise<TransResult> {
  if (!settings.geminiApiKey) throw new Error('Gemini API 키가 설정되지 않았습니다')
  const W = dims?.w || 0
  const H = dims?.h || 0
  const model = settings.geminiModel || 'gemini-2.0-flash'
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
    encodeURIComponent(settings.geminiApiKey)

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } },
          { text: GEMINI_PROMPT(langHint) }
        ]
      }
    ],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8000 }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const txt = await res.text()
  if (!res.ok) {
    let msg = txt.slice(0, 300)
    try {
      msg = JSON.parse(txt).error?.message ?? msg
    } catch {
      /* keep raw */
    }
    throw new Error(`Gemini 실패 HTTP ${res.status}: ${msg}`)
  }
  const data: any = JSON.parse(txt)
  const out = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? ''

  const blocks = blocksFromBoxItems(parseJsonArray(out), W, H)
  return { ok: true, w: W, h: H, blocks }
}

// Turn the model's [ymin,xmin,ymax,xmax] (0-1000) items into pixel boxes.
function blocksFromBoxItems(items: any[], W: number, H: number): TransBlock[] {
  const blocks: TransBlock[] = []
  for (const it of items) {
    const box = it?.box_2d ?? it?.box ?? []
    if (!Array.isArray(box) || box.length < 4) continue
    const [ymin, xmin, ymax, xmax] = box.map(toNum)
    const x = (Math.min(xmin, xmax) / 1000) * W
    const y = (Math.min(ymin, ymax) / 1000) * H
    const w = (Math.abs(xmax - xmin) / 1000) * W
    const h = (Math.abs(ymax - ymin) / 1000) * H
    const text = String(it?.text ?? '')
    const tr = String(it?.tr ?? it?.translation ?? '')
    if ((!text && !tr) || w <= 1 || h <= 1) continue
    blocks.push({ x, y, w, h, text, tr })
  }
  return blocks
}

// --- generic OpenAI-compatible vision engine (Groq / OpenRouter / Mistral) --

async function openaiVisionTranslate(
  buf: Buffer,
  settings: Settings,
  langHint: string | undefined,
  dims?: { w: number; h: number }
): Promise<TransResult> {
  if (!settings.llmApiKey) throw new Error('LLM API 키가 설정되지 않았습니다')
  if (!settings.llmModel) throw new Error('LLM 모델이 설정되지 않았습니다')
  const W = dims?.w || 0
  const H = dims?.h || 0
  const base = (settings.llmBaseUrl || '').replace(/\/$/, '')
  if (!base) throw new Error('LLM Base URL이 설정되지 않았습니다')

  const body = {
    model: settings.llmModel,
    temperature: 0,
    // Whole-page manga can have many bubbles; a small cap truncates the JSON
    // mid-array and breaks parsing. Give plenty of room.
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: GEMINI_PROMPT(langHint) },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` }
          }
        ]
      }
    ]
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.llmApiKey}`,
      // OpenRouter wants these (harmless for others).
      'HTTP-Referer': 'https://localhost/manga-viewer',
      'X-Title': 'MangaViewer'
    },
    body: JSON.stringify(body)
  })
  const txt = await res.text()
  if (!res.ok) {
    let msg = txt.slice(0, 300)
    try {
      msg = JSON.parse(txt).error?.message ?? msg
    } catch {
      /* keep raw */
    }
    throw new Error(`LLM 실패 HTTP ${res.status}: ${msg}`)
  }
  const data: any = JSON.parse(txt)
  const content = data?.choices?.[0]?.message?.content
  const out = Array.isArray(content)
    ? content.map((c: any) => c?.text ?? '').join('')
    : String(content ?? '')
  const blocks = blocksFromBoxItems(parseJsonArray(out), W, H)
  return { ok: true, w: W, h: H, blocks }
}

// --- free engine: translate OCR'd strings (renderer does the OCR) -----------

function googleLang(hint?: string): string {
  const h = (hint ?? '').toLowerCase()
  if (h.startsWith('en') || h === 'english') return 'en'
  if (h === 'zh-tw' || h === 'chinese_traditional') return 'zh-TW'
  if (h.startsWith('zh') || h === 'chinese') return 'zh-CN'
  return 'ja'
}

function deeplLang(hint?: string): string {
  const h = (hint ?? '').toLowerCase()
  if (h.startsWith('en') || h === 'english') return 'EN'
  if (h.startsWith('zh') || h === 'chinese' || h === 'chinese_traditional') return 'ZH'
  return 'JA'
}

// Google's unofficial, key-less endpoint. Free but ToS-gray and may break.
async function googleTranslateOne(text: string, hint?: string): Promise<string> {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t' +
    `&sl=${googleLang(hint)}&tl=ko&q=${encodeURIComponent(text)}`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Google 번역 HTTP ${res.status}`)
  const data: any = await res.json()
  // data[0] = [ [translatedChunk, original, ...], ... ]
  const chunks = Array.isArray(data?.[0]) ? data[0] : []
  return chunks.map((c: any) => (Array.isArray(c) ? c[0] : '')).join('')
}

// DeepL Free API. 500k chars/month free; needs a key. Batches all texts in one
// call (multiple text= params), translations come back in order.
async function deeplTranslate(texts: string[], settings: Settings, hint?: string): Promise<string[]> {
  if (!settings.deeplApiKey) throw new Error('DeepL API 키가 설정되지 않았습니다')
  const body = new URLSearchParams()
  body.set('source_lang', deeplLang(hint))
  body.set('target_lang', 'KO')
  for (const t of texts) body.append('text', t)
  const res = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${settings.deeplApiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`DeepL HTTP ${res.status}: ${txt.slice(0, 200)}`)
  const data: any = JSON.parse(txt)
  const arr = Array.isArray(data?.translations) ? data.translations : []
  return texts.map((_, i) => String(arr[i]?.text ?? ''))
}

export async function translateTexts(
  texts: string[],
  settings: Settings,
  langHint?: string
): Promise<{ ok: boolean; texts: string[]; error?: string }> {
  if (!texts.length) return { ok: true, texts: [] }
  try {
    if (settings.freeTranslator === 'deepl') {
      return { ok: true, texts: await deeplTranslate(texts, settings, langHint) }
    }
    // Google: per-string with limited concurrency (few blocks per page).
    const out: string[] = new Array(texts.length).fill('')
    const limit = 4
    for (let i = 0; i < texts.length; i += limit) {
      const batch = texts.slice(i, i + limit)
      const rs = await Promise.allSettled(batch.map((t) => googleTranslateOne(t, langHint)))
      rs.forEach((r, j) => {
        if (r.status === 'fulfilled') out[i + j] = r.value
      })
    }
    return { ok: true, texts: out }
  } catch (err: any) {
    return { ok: false, texts: [], error: String(err?.message ?? err) }
  }
}

export async function translateImage(
  buf: Buffer,
  settings: Settings,
  langHint?: string,
  dims?: { w: number; h: number }
): Promise<TransResult> {
  if (settings.translateEngine === 'gemini') return geminiTranslate(buf, settings, langHint, dims)
  if (settings.translateEngine === 'llm') return openaiVisionTranslate(buf, settings, langHint, dims)
  if (settings.translateProvider === 'localServer') return localServerTranslate(buf, settings)
  return cloudTranslate(buf, settings, langHint)
}
