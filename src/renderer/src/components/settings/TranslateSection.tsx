// 번역: the in-reader page translation engine and its credentials.
//   llm    — any OpenAI-compatible vision API (OCR + translate + layout at once)
//   gemini — Google Gemini (same, one call)
//   papago — Naver Papago image translation
//   free   — on-device Tesseract OCR + a free text translator
import type { JSX } from 'react'
import type { Settings } from '../../../../shared/types'
import Dropdown from '../Dropdown'
import SettingRow from '../SettingRow'
import { useSettings } from './context'
import { ExportDirRow } from './FolderSection'

// Base URL + a default vision model for each preset OpenAI-compatible provider
// (custom = keep whatever the user typed).
const LLM_PRESETS: Record<string, { llmBaseUrl: string; llmModel: string } | null> = {
  groq: { llmBaseUrl: 'https://api.groq.com/openai/v1', llmModel: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  openrouter: { llmBaseUrl: 'https://openrouter.ai/api/v1', llmModel: 'meta-llama/llama-4-maverick:free' },
  mistral: { llmBaseUrl: 'https://api.mistral.ai/v1', llmModel: 'pixtral-12b-2409' },
  custom: null
}

// Labeled single-line input bound to one string setting (trimmed).
function Field({
  title,
  k,
  secret
}: {
  title: string
  k: 'llmBaseUrl' | 'llmModel' | 'llmApiKey' | 'geminiApiKey' | 'geminiModel' | 'papagoClientId' | 'papagoClientSecret' | 'papagoImageEndpoint' | 'deeplApiKey'
  secret?: boolean
}): JSX.Element {
  const { draft, patch } = useSettings()
  return (
    <>
      <SettingRow title={title} />
      <input
        type={secret ? 'password' : 'text'}
        className="field-input"
        value={draft[k]}
        onChange={(e) => patch({ [k]: e.target.value.trim() })}
      />
    </>
  )
}

export default function TranslateSection(): JSX.Element {
  const { draft, patch } = useSettings()
  return (
    <section data-cat="translate">
      <h2>번역</h2>
      <p className="hint">
        한국어가 아닌 작품을 볼 때 뷰어 하단 “🌐 번역”으로 현재 페이지 말풍선 원문을 지우고 그 자리에
        한국어를 덧씌웁니다. 보고 있는 페이지만 번역하며 결과는 캐시됩니다.
      </p>
      <ExportDirRow />

      <SettingRow title="번역 엔진" desc="글자 인식·번역을 처리할 엔진.">
        <Dropdown<Settings['translateEngine']>
          className="field"
          value={draft.translateEngine}
          onChange={(v) => patch({ translateEngine: v })}
          options={[
            ['llm', 'Vision LLM (무료)'],
            ['gemini', 'Gemini Flash (유료)'],
            ['papago', 'Papago (유료)'],
            ['free', '기본 (무료 · Tesseract)']
          ]}
        />
      </SettingRow>

      {draft.translateEngine === 'llm' && (
        <div className="set-block">
          <p className="hint" style={{ marginTop: 8 }}>
            OpenAI 호환 비전 API로 인식+번역+위치를 한 번에. 대부분 카드 없이 무료 한도가 있습니다.
            제공자를 고르면 주소/모델이 자동 채워지며, 키만 발급해 넣으면 됩니다.
          </p>
          <SettingRow title="제공자">
            <Dropdown<Settings['llmProvider']>
              className="field prov-field"
              value={draft.llmProvider}
              onChange={(p) => patch({ llmProvider: p, ...(LLM_PRESETS[p] ?? {}) })}
              options={[
                ['groq', 'Groq'],
                ['openrouter', 'OpenRouter'],
                ['mistral', 'Mistral'],
                ['custom', '커스텀']
              ]}
            />
          </SettingRow>
          <Field title="Base URL" k="llmBaseUrl" />
          <Field title="모델" k="llmModel" />
          <Field title="API 키" k="llmApiKey" secret />
          <p className="hint">
            키 발급: Groq=console.groq.com · OpenRouter=openrouter.ai/keys · Mistral=console.mistral.ai.
            모델은 비전(이미지) 지원 모델이어야 합니다.
          </p>
        </div>
      )}

      {draft.translateEngine === 'gemini' && (
        <div className="set-block">
          <p className="hint" style={{ marginTop: 8 }}>
            Gemini가 글자 인식+번역+위치를 한 번에 처리합니다. Google AI Studio에서 무료 API 키를
            발급(aistudio.google.com → Get API key)해 입력하세요. (이미지가 Google로 전송)
          </p>
          <Field title="Gemini API 키" k="geminiApiKey" secret />
          <Field title="모델" k="geminiModel" />
          <p className="hint">
            기본 <code>gemini-2.0-flash</code>. 더 정확한 최신 모델이 있으면 바꿔도 됩니다.
          </p>
        </div>
      )}

      {draft.translateEngine === 'papago' && (
        <div className="set-block">
          <p className="hint" style={{ marginTop: 8 }}>
            네이버 클라우드 Papago Image Translation(Text) 하나로 글자 인식+번역. NCP에서 해당 API를
            켜고 Client ID/Secret을 입력하세요. (이미지가 Papago로 전송, 사용량 과금)
          </p>
          <Field title="Papago Client ID" k="papagoClientId" />
          <Field title="Papago Client Secret" k="papagoClientSecret" secret />
          <Field title="이미지 번역 엔드포인트" k="papagoImageEndpoint" />
          <p className="hint">※ 콘솔의 API Gateway 호출 URL과 다르면 위 주소를 맞춰주세요.</p>
        </div>
      )}

      {draft.translateEngine === 'free' && (
        <div className="set-block">
          <p className="hint" style={{ marginTop: 8 }}>
            글자 인식은 기기에서 Tesseract로 무료 처리(페이지당 0원). 번역만 아래 무료 번역기를 씁니다.
            인식 정확도는 파파고보다 낮을 수 있고, 첫 페이지는 인식 엔진 로딩으로 조금 느립니다.
          </p>
          <SettingRow title="무료 번역기">
            <Dropdown<Settings['freeTranslator']>
              className="field"
              value={draft.freeTranslator}
              onChange={(v) => patch({ freeTranslator: v })}
              options={[
                ['google', 'Google 비공식 (키 없음 · 불안정할 수 있음)'],
                ['deepl', 'DeepL Free (키 필요 · 월 50만자 무료 · 품질↑)']
              ]}
            />
          </SettingRow>
          {draft.freeTranslator === 'deepl' && (
            <>
              <Field title="DeepL API 키" k="deeplApiKey" secret />
              <p className="hint">DeepL 계정 → API(Free) 키 발급 후 입력. 엔드포인트는 api-free.deepl.com을 씁니다.</p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
