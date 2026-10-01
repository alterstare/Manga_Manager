// Fit modes — how a page is sized inside the reader pane — and the size math
// shared by the scroll virtualizer and the paged/spread renderers.
import type { CSSProperties, JSX } from 'react'
import type { FitMode } from '../../../../shared/types'
import { ArrowRangeIcon, HeightIcon, FullscreenIcon, FullscreenExitIcon } from '../icons'

// Fit modes: how a page is sized in the pane. The bottom button cycles them.
export const FIT_TEXT: Record<FitMode, string> = {
  width: '폭 맞춤',
  height: '길이 맞춤',
  contain: '화면 맞춤',
  cover: '화면 채움'
}
export const FIT_ICON: Record<FitMode, JSX.Element> = {
  width: <ArrowRangeIcon />,
  height: <HeightIcon />,
  contain: <FullscreenExitIcon />,
  cover: <FullscreenIcon />
}
export const FIT_ORDER: FitMode[] = ['contain', 'width', 'height', 'cover']
// Scroll mode: only width/height fit — contain ≈ height fit there, and cover just
// crops pages that width fit already shows whole.
export const SCROLL_FIT_ORDER: FitMode[] = ['width', 'height']

// <img> style for a fit mode given the (zoom-scaled) pane box. `sw`/`sh` are the
// available width/height in px. width/height fit one axis; contain fits inside
// the box (letterbox); cover fills it (cropping the overflow).
export function fitStyle(fit: FitMode, sw: number, sh: number): CSSProperties {
  switch (fit) {
    case 'width':
      return { width: sw, height: 'auto', maxWidth: 'none', maxHeight: 'none' }
    case 'height':
      return { height: sh, width: 'auto', maxWidth: 'none', maxHeight: 'none' }
    case 'cover':
      return { width: sw, height: sh, objectFit: 'cover' }
    default:
      return { maxWidth: sw, maxHeight: sh, width: 'auto', height: 'auto' }
  }
}

// Displayed page height for the virtualizer, from the decoded aspect ratio
// r = naturalHeight / naturalWidth and the fit mode.
export function fitHeight(fit: FitMode, r: number, sw: number, sh: number): number {
  switch (fit) {
    case 'width':
      return sw * r
    case 'height':
    case 'cover':
      return sh
    default:
      return Math.min(sh, sw * r)
  }
}
