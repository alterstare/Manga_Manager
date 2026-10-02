// 스타일·정렬: theme / hover preview / margins (library), reader behavior and
// page exclusion (viewer), and sorting / page size.
import type { JSX } from 'react'
import type { SortMode } from '../../../../shared/types'
import { SORT_LABELS } from '../../util'
import { dHashFromImage } from '../../exclude'
import Dropdown from '../Dropdown'
import SettingRow from '../SettingRow'
import Stepper from '../Stepper'
import Toggle from '../Toggle'
import { useSettings } from './context'

export default function StyleSection(): JSX.Element {
  const { draft, patch } = useSettings()

  // Register a sample image: pages perceptually similar to it (dHash) are hidden
  // from thumbnails and the reader.
  const addExcludeSample = async (): Promise<void> => {
    const url = await window.api.pickImage()
    if (!url) return
    const img = new Image()
    img.onload = async () => {
      const hash = await dHashFromImage(img)
      if (!draft.excludedImageHashes.includes(hash)) patch({ excludedImageHashes: [...draft.excludedImageHashes, hash] })
    }
    img.src = url
  }

  return (
    <>
      <section data-cat="style">
        <h2>라이브러리 스타일</h2>
        <SettingRow title="다크 테마" desc="켜면 어두운 화면 테마, 끄면 밝은 테마를 사용합니다.">
          <Toggle
            checked={(draft.theme ?? 'light') === 'dark'}
            onChange={(on) => {
              const t = on ? 'dark' : 'light'
              patch({ theme: t })
              // Live preview; Settings restores the saved theme if left unsaved.
              document.documentElement.setAttribute('data-theme', t)
            }}
          />
        </SettingRow>
        <SettingRow title="마우스 오버 미리보기" desc="썸네일에 마우스를 올리면 크게 미리보고 휠로 페이지를 넘깁니다.">
          <Toggle checked={draft.thumbHoverPreview !== false} onChange={(v) => patch({ thumbHoverPreview: v })} />
        </SettingRow>
        <SettingRow title="여백 너비" desc="목록이 표시되는 최대 폭. 좌우 여백을 조절합니다.">
          <Stepper value={draft.marginWidth} onChange={(v) => patch({ marginWidth: v })} min={400} step={20} />
          <span>px</span>
        </SettingRow>
      </section>

      <section data-cat="style">
        <h2>뷰어 스타일</h2>
        <SettingRow title="이어보기" desc="일반 만화 시리즈를 열면 1화 대신 마지막으로 본 화를 엽니다. 화 목록에서는 마지막으로 본 화가 보라색 테두리로 표시됩니다.">
          <Toggle checked={draft.resumeReading !== false} onChange={(v) => patch({ resumeReading: v })} />
        </SettingRow>
        <SettingRow title="스크롤 넘김에서 페이지 간격" desc="스크롤 감상 시 페이지 사이에 간격을 둡니다.">
          <Toggle checked={draft.readerPageGap} onChange={(v) => patch({ readerPageGap: v })} />
        </SettingRow>
        <SettingRow title="클릭 넘김에서 휠 스크롤로 페이지 넘기기" desc="클릭 넘김 모드에서 휠 스크롤로도 페이지를 넘깁니다.">
          <Toggle checked={draft.pagedWheelFlip} onChange={(v) => patch({ pagedWheelFlip: v })} />
        </SettingRow>
        <SettingRow title="두 쪽 보기에서 오른쪽을 다음 페이지로" desc="끄면 왼쪽이 다음(만화식) 페이지가 됩니다.">
          <Toggle checked={draft.spreadNextSide === 'right'} onChange={(v) => patch({ spreadNextSide: v ? 'right' : 'left' })} />
        </SettingRow>
        <SettingRow title="왼쪽을 클릭해서 페이지 넘기기" desc="끄면 오른쪽을 클릭해 다음 페이지로 넘깁니다.">
          <Toggle checked={draft.pagedFlipSide === 'left'} onChange={(v) => patch({ pagedFlipSide: v ? 'left' : 'right' })} />
        </SettingRow>
        <SettingRow title="페이지 제외" desc="각 작품의 앞쪽 N장을 썸네일·뷰어에서 건너뜁니다 (표지·광고 스킵).">
          <Stepper value={draft.excludeLeadingPages} onChange={(v) => patch({ excludeLeadingPages: v })} min={0} />
          <span>장</span>
        </SettingRow>
        <div className="set-block">
          <SettingRow title="제외 이미지 추가" desc="샘플 이미지를 등록하면 비슷한 페이지가 목록·뷰어에서 자동 제외됩니다.">
            <button className="mini" onClick={addExcludeSample}>
              + 이미지 추가
            </button>
          </SettingRow>
          {draft.excludedImageHashes.map((h) => (
            <div className="path-item" key={h}>
              <code>{h}</code>
              <button
                className="mini danger"
                onClick={() => patch({ excludedImageHashes: draft.excludedImageHashes.filter((x) => x !== h) })}
              >
                제거
              </button>
            </div>
          ))}
        </div>
      </section>

      <section data-cat="style">
        <h2>정렬</h2>
        <SettingRow title="제목순 정렬에서 괄호 무시" desc="() / [] 로 묶인 태그를 무시하고 실제 제목으로 정렬합니다.">
          <Toggle checked={draft.ignoreBracketTagsInSort} onChange={(v) => patch({ ignoreBracketTagsInSort: v })} />
        </SettingRow>
        <SettingRow title="페이지당 작품 수" desc="홈·온라인·즐겨찾기 목록에 한 페이지에 보여줄 작품 수.">
          <Stepper value={draft.pageSize} onChange={(v) => patch({ pageSize: Math.max(1, v) })} min={1} />
          <span>개</span>
        </SettingRow>
        <SettingRow title="기본 정렬" desc="라이브러리를 열 때 사용할 기본 정렬 방식.">
          <Dropdown<SortMode>
            className="field"
            value={draft.defaultSort}
            onChange={(v) => patch({ defaultSort: v })}
            options={(Object.keys(SORT_LABELS) as SortMode[]).map((m) => [m, SORT_LABELS[m]])}
          />
        </SettingRow>
      </section>
    </>
  )
}
