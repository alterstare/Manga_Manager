// 폴더·저장: library roots, download/language/export folders, and the doujin
// download folder-name patterns. Also exports the folder rows reused by other
// sections (download, translation). The favorites folder lives in the 즐겨찾기
// box (TagSection).
import type { JSX } from 'react'
import { fillNamePattern, SAMPLE_FIELDS } from '../../../../shared/pattern'
import SettingRow from '../SettingRow'
import { useSettings } from './context'
import { RootList, FolderRow } from './parts'

// Download folder of the current mode.
export function DownloadDirRow(): JSX.Element {
  const { draft, patch, isHitomi, pickDir } = useSettings()
  return isHitomi ? (
    <FolderRow
      title="다운로드 폴더"
      desc="받은 작품을 저장할 폴더. 비우면 라이브러리 폴더에 저장합니다."
      path={draft.downloadDir}
      onPick={() => pickDir((d) => patch({ downloadDir: d }))}
      onClear={() => patch({ downloadDir: null })}
      mode="hitomi"
    />
  ) : (
    <FolderRow
      title="다운로드 폴더"
      desc="온라인에서 받은 일반 만화를 저장할 폴더."
      path={draft.normalDownloadDir}
      onPick={() => pickDir((d) => patch({ normalDownloadDir: d }))}
      onClear={() => patch({ normalDownloadDir: null })}
      mode="normal"
    />
  )
}

// Where text/image translation exports are written (shared by both modes).
export function ExportDirRow(): JSX.Element {
  const { draft, patch, pickDir } = useSettings()
  return (
    <FolderRow
      title="번역 내보내기 폴더"
      desc="작품 “내보내기”로 저장한 텍스트·이미지 번역이 이 폴더에 저장됩니다."
      path={draft.textExportDir}
      onPick={() => pickDir((d) => patch({ textExportDir: d }))}
      onClear={() => patch({ textExportDir: null })}
      mode={null}
    />
  )
}

// Download folder-name patterns (-id-, -title-, -artist-, -group-, -language-);
// the checked one names new downloads.
function NamePatterns(): JSX.Element {
  const { draft, patch } = useSettings()
  const patterns = draft.hitomiNamePatterns ?? []
  const setAt = (i: number, v: string): void => {
    const arr = [...patterns]
    arr[i] = v
    patch({ hitomiNamePatterns: arr })
  }
  const removeAt = (i: number): void => {
    const arr = patterns.filter((_, x) => x !== i)
    const idx = draft.hitomiDownloadPatternIdx
    // Keep the checked pattern pointing at the same entry (or the last one).
    patch({
      hitomiNamePatterns: arr,
      hitomiDownloadPatternIdx: idx > i ? idx - 1 : idx >= arr.length ? Math.max(0, arr.length - 1) : idx
    })
  }
  return (
    <div className="set-block">
      <SettingRow
        title="폴더명 패턴"
        desc="지원되는 변수는 [-id-, -title-, -artist-, -group-, -language-] 입니다. 체크된 형식으로 다운로드합니다."
      >
        <button className="mini" onClick={() => patch({ hitomiNamePatterns: [...patterns, ''] })}>
          + 형식 추가
        </button>
      </SettingRow>
      {patterns.map((p, i) => (
        <div className="pat-row" key={i}>
          <div className="pat-line">
            <button
              type="button"
              className={`pat-check ${draft.hitomiDownloadPatternIdx === i ? 'on' : ''}`}
              title="다운로드에 사용할 형식"
              onClick={() => patch({ hitomiDownloadPatternIdx: i })}
            />
            <input
              type="text"
              className="field-input"
              value={p}
              placeholder="-artist- [-id-] -title-"
              onChange={(e) => setAt(i, e.target.value)}
            />
            <button className="mini danger" onClick={() => removeAt(i)}>
              삭제
            </button>
          </div>
          {p.trim() && (
            <div className="pat-example">
              예시: <span>{fillNamePattern(p, SAMPLE_FIELDS)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// Folders non-Korean works are moved into by "언어 정리".
function LanguageDirs(): JSX.Element {
  const { draft, patch, pickDir, rescanning, rescan } = useSettings()
  const LABEL = { english: '영어', japanese: '일본어', other: '기타' } as const
  return (
    <div className="set-block">
      <div className="set-sub">언어별 폴더</div>
      {(['english', 'japanese', 'other'] as const).map((k) => {
        const dir = draft.langDirs[k]
        return (
          <div className="path-item" key={k}>
            <span className="path-label">{LABEL[k]}</span>
            <code>{dir ?? '(미지정)'}</code>
            {dir && (
              <>
                <button className="mini" onClick={() => window.api.openFolder(dir)}>
                  열기
                </button>
                <button className="mini" disabled={rescanning === dir} onClick={() => rescan(dir, 'hitomi')}>
                  {rescanning === dir ? '갱신 중…' : '갱신'}
                </button>
                <button className="mini danger" onClick={() => patch({ langDirs: { ...draft.langDirs, [k]: null } })}>
                  해제
                </button>
              </>
            )}
            <button className="mini" onClick={() => pickDir((d) => patch({ langDirs: { ...draft.langDirs, [k]: d } }))}>
              선택
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function FolderSection(): JSX.Element {
  const { draft, patch, isHitomi, pickDir } = useSettings()
  const addTo = (key: 'libraryRoots' | 'normalRoots' | 'flattenRoots') => () =>
    pickDir((d) => patch({ [key]: [...new Set([...(draft[key] ?? []), d])] }))
  const removeFrom = (key: 'libraryRoots' | 'normalRoots' | 'flattenRoots') => (r: string) =>
    patch({ [key]: (draft[key] ?? []).filter((x) => x !== r) })

  return (
    <section data-cat="folder">
      <h2>폴더</h2>
      {isHitomi ? (
        <>
          <RootList
            title="라이브러리 폴더"
            desc="만화가 들어 있는 폴더들. 각 하위 폴더가 한 작품으로 인식됩니다."
            roots={draft.libraryRoots}
            onAdd={addTo('libraryRoots')}
            onRemove={removeFrom('libraryRoots')}
            mode="hitomi"
          />
          <NamePatterns />
          <RootList
            title="작가 폴더"
            desc="지정 폴더 바로 아래의 폴더 이름을 그 아래 모든 작품의 작가명으로 넣습니다 (지정 폴더 / 작가 폴더 / 작품 폴더 / 이미지)."
            roots={draft.flattenRoots ?? []}
            onAdd={addTo('flattenRoots')}
            onRemove={removeFrom('flattenRoots')}
            mode="hitomi"
            addLabel="+ 위치 추가"
          />
          <DownloadDirRow />
          <LanguageDirs />
          <ExportDirRow />
        </>
      ) : (
        <>
          <RootList
            title="일반 만화 폴더"
            desc="일반 만화가 들어 있는 폴더들. 보통 작품마다 여러 화 폴더로 나뉩니다."
            roots={draft.normalRoots}
            onAdd={addTo('normalRoots')}
            onRemove={removeFrom('normalRoots')}
            mode="normal"
          />
          <DownloadDirRow />
          <ExportDirRow />
        </>
      )}
    </section>
  )
}
