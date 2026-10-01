import { useState } from 'react'
import type { JSX } from 'react'
import type { Work } from '../../../shared/types'
import { useStore } from '../store'
import { allTags, tagToken } from '../util'
import { invalidate } from '../images'
import Thumb from './Thumb'
import { ArtistLinks } from './ArtistLinks'
import Stars from './Stars'
import TagList from './TagList'
import KoreanFinder from './KoreanFinder'
import FavGroup from './FavGroup'
import ContextMenu from './ContextMenu'
import ConfirmModal from './ConfirmModal'

export default function WorkCard({ work }: { work: Work }): JSX.Element {
  const openTab = useStore((s) => s.openTab)
  const openTabBackground = useStore((s) => s.openTabBackground)
  const openGlance = useStore((s) => s.openGlance)
  const openSplit = useStore((s) => s.openSplit)
  const startDownload = useStore((s) => s.startDownload)
  const searchOnline = useStore((s) => s.searchOnline)
  const addFavoriteTag = useStore((s) => s.addFavoriteTag)
  const splitOpen = useStore((s) => !!s.tabs.find((t) => t.id === s.activeTabId)?.split)
  const setFilter = useStore((s) => s.setFilter)
  const addSearchToken = useStore((s) => s.addSearchToken)
  const upsertWork = useStore((s) => s.upsertWork)
  const toggleUnifiedFav = useStore((s) => s.toggleUnifiedFav)
  const onlineFavs = useStore((s) => s.onlineFavs)
  const removeWork = useStore((s) => s.removeWork)
  const favoriteTags = useStore((s) => s.settings.favoriteTags)
  const [adding, setAdding] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [findKo, setFindKo] = useState(false)
  const [copied, setCopied] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [crossMenu, setCrossMenu] = useState<{ x: number; y: number; query: string; raw: string } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [noFolder, setNoFolder] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const exportWorkJob = useStore((s) => s.exportWorkJob)
  const exportImagesJob = useStore((s) => s.exportImagesJob)
  const goSettings = useStore((s) => s.goSettings)

  // Guard: exports need a destination folder. Show a popup up-front if it's unset.
  const ensureFolder = (): boolean => {
    if (useStore.getState().settings.textExportDir) return true
    setNoFolder(true)
    return false
  }
  // Text export (OCR via the current translate engine) → .txt. Image export renders
  // each translated page and saves it. Both run as global jobs (progress in the
  // bottom activity bar, survives navigating away).
  const runExport = (withTr: boolean): void => {
    setExportOpen(false)
    if (ensureFolder()) void exportWorkJob(work.id, withTr)
  }
  const runImageExport = (): void => {
    setExportOpen(false)
    if (ensureFolder()) void exportImagesJob(work.id)
  }

  const copyCode = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!work.code) return
    navigator.clipboard.writeText(work.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  const tags = allTags(work)

  const toggleFav = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    // Coded (hitomi) works share ONE favorite with the online side.
    if (work.code && !/^https?:/.test(work.code)) {
      await toggleUnifiedFav(work.code, { title: work.title, artist: work.artist, language: work.language, pageCount: work.pageCount })
    } else {
      upsertWork(await window.api.setFavorite(work.id, !work.favorite))
    }
    invalidate(work.id)
  }
  const isFav = work.favorite || !!(work.code && onlineFavs[work.code]?.favorite)

  const setRank = async (rank: number): Promise<void> => {
    upsertWork(await window.api.setRank(work.id, rank))
  }

  const addTag = async (): Promise<void> => {
    const t = newTag.trim()
    if (t) upsertWork(await window.api.addManualTag(work.id, t))
    setNewTag('')
    setAdding(false)
  }

  const removeTag = async (tag: string): Promise<void> => {
    upsertWork(await window.api.removeManualTag(work.id, tag))
  }

  return (
    <div className="work-card-wrap">
    <div
      className="work-card"
      // Alt+click anywhere (capture) → Glance, before child (artist/tag) handlers.
      onClickCapture={(e) => {
        // Dragging to select/copy text (e.g. the title) must not open a tab.
        if (window.getSelection()?.toString()) return e.stopPropagation()
        if (e.altKey) {
          e.preventDefault()
          e.stopPropagation()
          openGlance({ workId: work.id })
        }
      }}
      onClick={() => openTab(work.id)}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault() // block middle-click autoscroll
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          openTabBackground(work.id)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <Thumb workId={work.id} />
      <div className="work-info">
        <div className="work-title-row">
          <span className="work-title selectable">{work.title}</span>
          <FavGroup favorite={isFav} onToggle={toggleFav} work={work} />
        </div>

        <div className="work-meta">
          {work.pageCount}p
          {work.code && (
            <>
              {' · '}
              <span className="code copyable" onClick={copyCode}>
                [{work.code}]{copied ? ' ✓복사됨' : ''}
              </span>
            </>
          )}
          {work.language && ` · ${work.language}`}
          {work.artist && (
            <>
              {' · '}
              <ArtistLinks
                artist={work.artist}
                onPick={(a) => setFilter({ kind: 'artist', value: a })}
                onMenu={(a, e) => setCrossMenu({ x: e.clientX, y: e.clientY, query: tagToken(`artist:${a}`), raw: a })}
              />
            </>
          )}
        </div>

        <div className="work-tags">
          <TagList
            tags={tags}
            favoriteTags={favoriteTags}
            manualTags={work.manualTags}
            onTagClick={(t) => addSearchToken(tagToken(t))}
            onTagContext={(t, e) =>
              setCrossMenu({ x: e.clientX, y: e.clientY, query: tagToken(t), raw: t })
            }
            onRemove={removeTag}
            onAddClick={adding ? undefined : () => setAdding(true)}
          />
          {adding && (
            <input
              autoFocus
              className="tag-input"
              value={newTag}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNewTag(e.target.value)}
              onBlur={addTag}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              placeholder="태그…"
            />
          )}
        </div>

        <div className="work-actions">
          <Stars rank={work.rank} onChange={setRank} />
          {work.code && (
            <button
              className="mini"
              onClick={async (e) => {
                e.stopPropagation()
                try {
                  upsertWork(await window.api.hitomiEnrich(work.id))
                } catch (err: any) {
                  alert(String(err?.message ?? err))
                }
              }}
            >
              메타 채우기
            </button>
          )}
          <button
            className="mini"
            onClick={(e) => {
              e.stopPropagation()
              window.api.openInExplorer(work.id)
            }}
          >
            폴더 열기
          </button>
          <button
            className="mini danger"
            onClick={(e) => {
              e.stopPropagation()
              setConfirmDel(true)
            }}
          >
            삭제
          </button>
          <button
            className={`mini ko-toggle ${findKo ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              setFindKo((v) => !v)
            }}
          >
            한국어 {findKo ? '▴' : '▾'}
          </button>
          <div className="export-wrap" onClick={(e) => e.stopPropagation()}>
            <button
              className={`mini ${exportOpen ? 'on' : ''}`}
              onClick={() => setExportOpen((v) => !v)}
            >
              내보내기 {exportOpen ? '▴' : '▾'}
            </button>
            {exportOpen && (
              <div className="export-menu">
                <button className="export-opt" onClick={() => runExport(false)}>
                  원문만
                </button>
                <button className="export-opt" onClick={() => runExport(true)}>
                  원문 + 한국어 번역
                </button>
                <button className="export-opt" onClick={runImageExport}>
                  이미지로 내보내기
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    {findKo && <KoreanFinder work={work} />}
    {noFolder && (
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmModal
          title="내보낼 폴더가 없습니다"
          desc="설정에서 내보내기 폴더를 먼저 지정하세요. (텍스트·이미지 내보내기 공통)"
          icon="📁"
          confirmLabel="설정 열기"
          cancelLabel="닫기"
          onConfirm={() => {
            setNoFolder(false)
            goSettings()
          }}
          onCancel={() => setNoFolder(false)}
        />
      </div>
    )}
    {confirmDel && (
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmModal
          danger
          icon="🗑"
          title="작품을 삭제할까요?"
          desc={<><b>{work.title}</b> 폴더를 영구 삭제합니다. 되돌릴 수 없습니다.</>}
          confirmLabel="삭제"
          cancelLabel="취소"
          onConfirm={async () => {
            setConfirmDel(false)
            await window.api.deleteWork(work.id)
            removeWork(work.id)
          }}
          onCancel={() => setConfirmDel(false)}
        />
      </div>
    )}
    {menu && (
      <ContextMenu
        x={menu.x}
        y={menu.y}
        items={[
          { label: '새 탭에서 열기', onClick: () => openTab(work.id) },
          { label: '백그라운드에서 열기', onClick: () => openTabBackground(work.id) },
          { label: splitOpen ? '오른쪽 뷰에서 열기' : '분할 뷰에서 열기', onClick: () => openSplit(work.id) },
          ...(work.code && (work.library ?? 'hitomi') === 'hitomi'
            ? [{ label: '다시 다운로드', onClick: () => startDownload({ kind: 'hitomi' as const, input: work.code! }) }]
            : [])
        ]}
        onClose={() => setMenu(null)}
      />
    )}
    {crossMenu && (
      <ContextMenu
        x={crossMenu.x}
        y={crossMenu.y}
        items={[
          { label: '온라인에서 검색', onClick: () => searchOnline(crossMenu.query) },
          { label: '즐겨찾는 태그로 추가', onClick: () => addFavoriteTag(crossMenu.raw) }
        ]}
        onClose={() => setCrossMenu(null)}
      />
    )}
    </div>
  )
}
