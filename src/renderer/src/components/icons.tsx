import type { JSX } from 'react'

// Small, uniform-stroke line icons for card/list action buttons. They inherit
// `color` via `currentColor` and size to `1em`, so the surrounding span's font
// color/size drives them (see `.seg-ico` in styles.css).

interface IconProps {
  className?: string
}

// Clean, even-weight check — replaces the ✓ glyph on finished downloads.
export function CheckIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12.5l5.2 5.2L20 6.5" />
    </svg>
  )
}

// Pause — shown while a download is in flight (click to stop/pause it).
export function PauseIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" />
    </svg>
  )
}

// Play — shown on a paused download (click to resume from where it stopped).
export function PlayIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <path d="M7.5 5.6c0-.9 1-1.5 1.8-1L18 9.9c.8.5.8 1.7 0 2.2l-8.7 5.3c-.8.5-1.8-.1-1.8-1V5.6z" />
    </svg>
  )
}

// Two circular arrows — the "converting" (avif→webp) indicator.
export function ConvertIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11a8 8 0 0 0-14.9-3.5" />
      <path d="M4.5 4.5v3.5H8" />
      <path d="M4 13a8 8 0 0 0 14.9 3.5" />
      <path d="M19.5 19.5V16H16" />
    </svg>
  )
}

// --- Material Symbols (filled, 24px). Inherit color via currentColor, size 1em. ---
function mkIcon(path: string) {
  return function Icon({ className }: IconProps): JSX.Element {
    return (
      <svg className={`micon ${className ?? ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    )
  }
}

export const EditLineIcon = mkIcon('m10.05 21l2-2H22v2zM3 21v-4.25L16.2 3.575q.275-.275.65-.425t.775-.15t.763.162t.662.438L20.425 5q.275.3.425.663T21 6.4q0 .4-.137.762t-.438.663L7.25 21zM17.6 7.8L19 6.4L17.6 5l-1.4 1.4z')
export const ShieldIcon = mkIcon('M12 22q-3.475-.875-5.738-3.988T4 11.1V5l8-3l8 3v6.1q0 3.8-2.262 6.913T12 22')
export const HomeIcon = mkIcon('M4 21V9l8-6l8 6v12h-6v-7h-4v7z')
export const LanguageIcon = mkIcon(
  'M8.125 21.213q-1.825-.788-3.187-2.15t-2.15-3.188T2 11.988t.788-3.875t2.15-3.175t3.187-2.15T12.013 2t3.875.788t3.175 2.15t2.15 3.175t.787 3.875t-.787 3.887t-2.15 3.188t-3.175 2.15t-3.875.787t-3.888-.787M12 19.95q.65-.9 1.125-1.875T13.9 16h-3.8q.3 1.1.775 2.075T12 19.95m-2.6-.4q-.45-.825-.787-1.713T8.05 16H5.1q.725 1.25 1.813 2.175T9.4 19.55m5.2 0q1.4-.45 2.488-1.375T18.9 16h-2.95q-.225.95-.562 1.838T14.6 19.55M4.25 14h3.4q-.075-.5-.112-.987T7.5 12t.038-1.012T7.65 10h-3.4q-.125.5-.187.988T4 12t.063 1.013t.187.987m5.4 0h4.7q.075-.5.113-.987T14.5 12t-.038-1.012T14.35 10h-4.7q-.075.5-.112.988T9.5 12t.038 1.013t.112.987m6.7 0h3.4q.125-.5.188-.987T20 12t-.062-1.012T19.75 10h-3.4q.075.5.113.988T16.5 12t-.038 1.013t-.112.987m-.4-6h2.95q-.725-1.25-1.812-2.175T14.6 4.45q.45.825.788 1.713T15.95 8M10.1 8h3.8q-.3-1.1-.775-2.075T12 4.05q-.65.9-1.125 1.875T10.1 8m-5 0h2.95q.225-.95.563-1.838T9.4 4.45Q8 4.9 6.912 5.825T5.1 8'
)
export const MenuIcon = mkIcon('M3 18v-2h18v2zm0-5v-2h18v2zm0-5V6h18v2z')
export const SettingsIcon = mkIcon(
  'm9.25 22l-.4-3.2q-.325-.125-.612-.3t-.563-.375L4.7 19.375l-2.75-4.75l2.575-1.95Q4.5 12.5 4.5 12.338v-.675q0-.163.025-.338L1.95 9.375l2.75-4.75l2.975 1.25q.275-.2.575-.375t.6-.3l.4-3.2h5.5l.4 3.2q.325.125.613.3t.562.375l2.975-1.25l2.75 4.75l-2.575 1.95q.025.175.025.338v.674q0 .163-.05.338l2.575 1.95l-2.75 4.75l-2.95-1.25q-.275.2-.575.375t-.6.3l-.4 3.2zm2.8-6.5q1.45 0 2.475-1.025T15.55 12t-1.025-2.475T12.05 8.5q-1.475 0-2.488 1.025T8.55 12t1.013 2.475T12.05 15.5'
)
export const SearchIcon = mkIcon(
  'm19.6 21l-6.3-6.3q-.75.6-1.725.95T9.5 16q-2.725 0-4.612-1.888T3 9.5t1.888-4.612T9.5 3t4.613 1.888T16 9.5q0 1.1-.35 2.075T14.7 13.3l6.3 6.3zM9.5 14q1.875 0 3.188-1.312T14 9.5t-1.312-3.187T9.5 5T6.313 6.313T5 9.5t1.313 3.188T9.5 14'
)
export const SyncIcon = mkIcon(
  'M4 20v-2h2.75l-.4-.35q-1.225-1.225-1.787-2.662T4 12.05q0-2.775 1.663-4.937T10 4.25v2.1Q8.2 7 7.1 8.563T7 12.05q0 1.125.425 2.188T7.75 16.2l.25.25V14h2v6zm10-.25v-2.1q1.8-.65 2.9-2.212T18 11.95q0-1.125-.425-2.187T16.25 7.8L16 7.55V10h-2V4h6v2h-2.75l.4.35q1.225 1.225 1.788 2.663T20 11.95q0 2.775-1.662 4.938T14 19.75'
)
export const DownloadIcon = mkIcon(
  'm12 16l-5-5l1.4-1.45l2.6 2.6V4h2v8.15l2.6-2.6L17 11zm-6 4q-.825 0-1.412-.587T4 18v-3h2v3h12v-3h2v3q0 .825-.587 1.413T18 20z'
)
export const GridIcon = mkIcon('M2 10V2h8v8zm0 12v-8h8v8zm12-12V2h8v8zm0 12v-8h8v8z')
export const Download2Icon = mkIcon('M4 22v-2h16v2zm8-4L5 9h4V2h6v7h4z')
export const DescriptionIcon = mkIcon(
  'M8 18h8v-2H8zm0-4h8v-2H8zm-2 8q-.825 0-1.412-.587T4 20V4q0-.825.588-1.412T6 2h8l6 6v12q0 .825-.587 1.413T18 22zm7-13h5l-5-5z'
)
export const ScanIcon = mkIcon(
  'M2 6V1h5v2H4v3zm18 0V3h-3V1h5v5zM2 23v-5h2v3h3v2zm15 0v-2h3v-3h2v5zM7 20q-.825 0-1.412-.587T5 18V6q0-.825.588-1.412T7 4h10q.825 0 1.413.588T19 6v12q0 .825-.587 1.413T17 20zm2-10h6V8H9zm0 3h6v-2H9zm0 3h6v-2H9z'
)
export const AddPhotoIcon = mkIcon(
  'M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h9q-.5.65-.75 1.425T13 6q0 2.075 1.463 3.538T18 11q.8 0 1.575-.25T21 10v9q0 .825-.587 1.413T19 21zm1-4h12l-3.75-5l-3 4L9 13zm11-8V7h-2V5h2V3h2v2h2v2h-2v2z'
)
export const FolderIcon = mkIcon(
  'M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h6l2 2h8q.825 0 1.413.588T22 8v10q0 .825-.587 1.413T20 20z'
)
export const EditIcon = mkIcon(
  'M3 21v-4.25L16.2 3.575q.3-.275.663-.425t.762-.15t.775.15t.65.45L20.425 5q.3.275.438.65T21 6.4q0 .4-.137.763t-.438.662L7.25 21zM17.6 7.8L19 6.4L17.6 5l-1.4 1.4z'
)
export const AssignmentIcon = mkIcon(
  'M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h4.2q.325-.9 1.088-1.45T12 1t1.713.55T14.8 3H19q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm2-4h7v-2H7zm0-4h10v-2H7zm0-4h10V7H7zm5.538-4.962q.212-.213.212-.538t-.213-.537T12 2.75t-.537.213t-.213.537t.213.538t.537.212t.538-.213'
)
export const HistoryIcon = mkIcon(
  'M12 21q-3.45 0-6.012-2.287T3.05 13H5.1q.35 2.6 2.313 4.3T12 19q2.925 0 4.963-2.037T19 12t-2.037-4.962T12 5q-1.725 0-3.225.8T6.25 8H9v2H3V4h2v2.35q1.275-1.6 3.113-2.475T12 3q1.875 0 3.513.713t2.85 1.924t1.925 2.85T21 12t-.712 3.513t-1.925 2.85t-2.85 1.925T12 21m2.8-4.8L11 12.4V7h2v4.6l3.2 3.2z'
)
export const CompareArrowsIcon = mkIcon(
  'm8 20l-1.4-1.425L9.175 16H2v-2h7.175L6.6 11.425L8 10l5 5zm8-6l-5-5l5-5l1.4 1.425L14.825 8H22v2h-7.175l2.575 2.575z'
)
export const ArrowRangeIcon = mkIcon(
  'm7 17l-5-5l5-5l1.4 1.4L5.825 11h12.35L15.6 8.4L17 7l5 5l-5 5l-1.4-1.4l2.575-2.6H5.825L8.4 15.6z'
)
export const HeightIcon = mkIcon(
  'm12 21l-4-4l1.4-1.4l1.6 1.575V6.825L9.4 8.4L8 7l4-4l4 4l-1.4 1.425l-1.6-1.6v10.35l1.6-1.575L16 17z'
)
export const FullscreenIcon = mkIcon('M3 21v-5h2v3h3v2zm13 0v-2h3v-3h2v5zM3 8V3h5v2H5v3zm16 0V5h-3V3h5v5z')
export const FullscreenExitIcon = mkIcon('M6 21v-3H3v-2h5v5zm10 0v-5h5v2h-3v3zM3 8V6h3V3h2v5zm13 0V3h2v3h3v2z')
// Material Symbols "auto_stories" (outlined) — series marker in the reader list.
export function AutoStoriesIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={`micon ${className ?? ''}`} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
      <path d="M480-160q-48-38-104-59t-116-21q-42 0-82.5 11T100-198q-21 11-40.5-1T40-234v-482q0-11 5.5-21T62-752q46-24 96-36t102-12q58 0 113.5 15T480-740v484q51-32 107-48t113-16q36 0 70.5 6t69.5 18v-480q15 5 29.5 10.5T898-752q11 5 16.5 15t5.5 21v482q0 23-19.5 35t-40.5 1q-37-20-77.5-31T700-240q-60 0-116 21t-104 59Zm80-200v-380l200-200v400L560-360Zm-160 65v-396q-33-14-68.5-21.5T260-720q-37 0-72 7t-68 21v397q35-13 69.5-19t70.5-6q36 0 70.5 6t69.5 19Zm0 0v-396 396Z" />
    </svg>
  )
}

export const AddIcon = mkIcon('M11 13H5v-2h6V5h2v6h6v2h-6v6h-2z')
export const CloseIcon = mkIcon('M6.4 19L5 17.6l5.6-5.6L5 6.4L6.4 5l5.6 5.6L17.6 5L19 6.4L13.4 12l5.6 5.6l-1.4 1.4l-5.6-5.6z')

const FAV_FILLED =
  'm12 21l-1.45-1.3q-2.525-2.275-4.175-3.925T3.75 12.812T2.388 10.4T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.3 0 2.475.55T12 4.75q.85-1 2.025-1.55t2.475-.55q2.35 0 3.925 1.575T22 8.15q0 1.15-.387 2.25t-1.363 2.412t-2.625 2.963T13.45 19.7z'
const FAV_OUTLINE =
  'm12 21l-1.45-1.3q-2.525-2.275-4.175-3.925T3.75 12.812T2.388 10.4T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.3 0 2.475.55T12 4.75q.85-1 2.025-1.55t2.475-.55q2.35 0 3.925 1.575T22 8.15q0 1.15-.387 2.25t-1.363 2.412t-2.625 2.963T13.45 19.7zm0-2.7q2.4-2.15 3.95-3.687t2.45-2.675t1.25-2.026T20 8.15q0-1.5-1-2.5t-2.5-1q-1.175 0-2.175.662T12.95 7h-1.9q-.375-1.025-1.375-1.687T7.5 4.65q-1.5 0-2.5 1t-1 2.5q0 .875.35 1.763t1.25 2.025t2.45 2.675T12 18.3'
// Favorite heart — outline by default; `filled` swaps to the solid glyph (colour
// it red via the caller/CSS for the favorited state).
export function FavoriteIcon({ className, filled }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <svg className={`micon fav-heart ${className ?? ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={filled ? FAV_FILLED : FAV_OUTLINE} />
    </svg>
  )
}

// A clean X for cancel/remove.
export function XIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
