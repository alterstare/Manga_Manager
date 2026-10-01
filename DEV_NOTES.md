# manga-viewer-2 — Developer / AI Handoff Notes

Windows Electron manga viewer. Two independent library modes: **hitomi** (coded
doujinshi galleries, downloaded from hitomi.la) and **normal** (general manga /
webtoons scraped from "toki"-family sites + a gnuboard "backup" site). This file
documents the conventions, architecture, and design tokens needed to keep coding
in a fresh context without re-deriving everything.

---

## 1. Stack & build

- **electron-vite** project.
  - `src/main` → main process (Node, CJS at runtime).
  - `src/preload` → preload bridge (`.mjs`).
  - `src/renderer` → React 19 + TypeScript, ESM.
  - `src/shared` → types + IPC contract shared by main & renderer.
- Language: **TypeScript, strict**. `tsc` with `noUnusedLocals` — remove unused
  imports/vars or the typecheck fails.
- Commands (run from the project dir — **cwd resets to `C:\Users\noth2\Desktop\code`
  which has no package.json**, so always `cd` in first):
  ```bash
  cd /c/Users/noth2/Desktop/code/manga-viewer-2 && npm run typecheck
  cd /c/Users/noth2/Desktop/code/manga-viewer-2 && npm run build
  ```
  - `typecheck` = `tsc --noEmit` for both `tsconfig.node.json` (main/preload) and
    `tsconfig.web.json` (renderer). **Run it after every change.**
  - `build` = electron-vite production build (fast, ~900ms). Use to sanity-check.
  - Packaging: `npm run dist` (electron-builder). winCodeSign symlink step needs
    Developer Mode or admin — not needed for normal dev.
- App `userData`: `%APPDATA%/MangaManager/` (packaged) — holds `works.json` (scanned library)
  and `settings.json`.

---

## 2. Main process layout & IPC pattern

`src/main/index.ts` is ONLY app lifecycle (window, single-instance lock,
auto-update, startup migrations) and registers the IPC modules:

| file | handles |
|---|---|
| `main/context.ts` | shared `store`, `appState` (closing/quitting), `getMainWindow`, `sendToRenderer` |
| `main/ipc/library.ts` | settings, scan, works (rank/groups/tags/views), folders, thumbnails, translation, exports, exit/reset |
| `main/ipc/favorites.ts` | hearts by code, favorites file (export/import/merge), favorite lists, gallery summaries |
| `main/ipc/hitomi.ts` | hitomi browse/search, metadata enrich, deleted-sweep, cover regen, download |
| `main/ipc/toki.ts` | general-manga online: list/chapters/images/author/cover, downloads |
| `main/downloads.ts` | `runDownload(code, title, task)` — slot gate, stop, progress for ALL downloads |
| `main/lib/media.ts` | `mangaimg://` protocol, url encoders, thumbnail cache files |
| `main/lib/favoriteSync.ts` | the favorites model (see §10) |

Adding a channel — three files move in lockstep:

1. **`src/shared/ipc.ts`** — channel string in the `IPC` map (`myThing: 'ns:myThing'`)
   and the typed method in the `Api` interface. Shared DTOs live here too.
2. **`src/preload/index.ts`** — `myThing: (arg) => ipcRenderer.invoke(IPC.myThing, arg)`.
   Events main→renderer use the `on...` + returned-unsubscribe pattern.
3. **`src/main/ipc/<domain>.ts`** — `ipcMain.handle(IPC.myThing, (_e, arg) => ...)`
   inside that module's `register…Ipc()`. Push events with `sendToRenderer`.

Renderer calls everything via `window.api.*` (typed by `Api`).

---

## 3. Renderer state — zustand store (`src/renderer/src/store.ts`)

- Single `useStore` zustand store. State interface + action signatures declared at
  the top half of the file; implementations in the `create(...)` body.
- **`settings` in the store is EFFECTIVE settings** (per-mode overlay already
  merged). `effectiveSettings(raw, mode)` overlays `settings.perMode[mode]` onto the
  base. Keys listed in `SPLIT_SETTING_KEYS` are per-mode; everything else is shared.
  - When adding a setting: if it should differ between hitomi/normal, add its key to
    `SPLIT_SETTING_KEYS`; otherwise it's shared (the common case).
- `works: Work[]`, `downloads: DownloadItem[]`, `jobs: Job[]`, `tabs`, etc.
- `addWork(w)` upserts into `works`. `mergeScanPartial` (main side) merges scan
  results.
- Defaults live in `DEFAULT_SETTINGS` (`src/shared/types.ts`). **Every new Settings
  field MUST get a default there**, or older `settings.json` loads with `undefined`
  (guard reads with `?? fallback` anyway).

### Download dispatch is centralized (recent refactor — keep it that way)

All downloads go through **`store.startDownload(spec)`** — never call
`window.api.hitomiDownload/tokiDownload/...` directly from a component.
```ts
type DownloadSpec =
  | { kind: 'hitomi'; input: string; title?: string }
  | { kind: 'toki'; seriesUrl: string; title: string; chapterUrls?: string[] }
  | { kind: 'generic'; title: string; chapters: TokiChapter[]; only?: string[] }
```
- `specCode(spec)` derives the progress code (hitomi numeric code / toki seriesUrl /
  `backup:<title>`) — must match the `code` main emits on the progress channel.
- `startDownload` seeds a `DownloadItem` (phase `queued`, stores `spec` for
  retry), invokes the right IPC, `addWork`s results, returns `Work[]` — or **`null`
  if the user stopped it** (detected via the `DOWNLOAD_STOPPED` message; callers
  should early-return on null, no error alert).
- Related actions: `stopDownload(code)`, `retryDownload(code)`,
  `stopAllDownloads(mode)`, `startAllDownloads(mode)`.
- Progress events land in `pushDownloadProgress` (wired once in `App.tsx` via
  `onHitomiProgress`). It rebuilds the item from the event but **preserves `spec`**
  from the previous item — keep that when editing.

---

## 4. Downloads: queue, concurrency, cancellation (main)

- Every download (hitomi gallery, toki series, backup-site chapters) runs through
  **`runDownload(code, title, task)`** in `main/downloads.ts`: waits for a slot
  (`settings.maxConcurrentDownloads`, 0 = unlimited, read per acquire, FIFO),
  wires the stop button to an `AbortSignal`, and reports `queued → fetching →
  (task reports downloading/done) | stopped | error` on the hitomiProgress channel.
  The task only reports its own `downloading`/`done`.
- Stop = `stopDownload(code)` (IPC `download:stop`) → abort → `stopped` + rejects
  with `STOP_MSG` (`'DOWNLOAD_STOPPED'`), which the renderer treats as non-error.
- Lib functions take `signal?` and `signal?.throwIfAborted()` per loop step
  (hitomi per image, toki per chapter). Toki chapter images save 4 at a time
  and are resumable (files already on disk are skipped).
- `HitomiProgress.phase`: `'queued' | 'fetching' | 'downloading' | 'enriching' |
  'done' | 'error' | 'stopped'`. Code = hitomi code / toki seriesUrl / `backup:<title>`.

---

## 5. Scanner & classification (main)

- `scanRoot` / `scanOne` stamp `work.library = 'hitomi' | 'normal'` based on **which
  root the folder lives under** (`normalRoots(settings)`), NOT by code presence.
- Hitomi gallery-id detection is **pattern-driven** (`src/main/lib/parser.ts`
  `parseName(folderName, patterns)`):
  - User patterns in `settings.hitomiNamePatterns` (shared setting), tokens
    `-id-` `-title-` `-artist-` `-group-` `-language-`. `-id-` compiles to `(\d{4,})`
    and is **required** — a folder is a hitomi work only if a pattern matches AND the
    id slot has digits. Prevents incidental 7-digit numbers in titles being read as
    codes.
  - `DEFAULT_HITOMI_PATTERNS` is the fallback list. Patterns tried in order.
  - Only applied when `library === 'hitomi'`; normal mode never parses an id.
- Shared pattern util `src/shared/pattern.ts`: `fillNamePattern(pattern, fields)`
  (used for download folder naming + the settings live preview), `langCode(lang)`
  → `KOR/CHN/JPN/ENG/ETC`, `SAMPLE_FIELDS`.
- Download folder naming uses the pattern at `hitomiNamePatterns[hitomiDownloadPatternIdx]`.

---

## 6. Design system / CSS conventions

- **Single stylesheet**: `src/renderer/src/styles.css`. No CSS modules, no
  Tailwind. Class names are plain kebab-case, component-scoped by prefix
  (`.dl-item-*`, `.pat-row`, `.lib-item`, `.gcard-*`, `.settings .field-input`…).
- **Everything reads CSS variables** — never hard-code a hex. Dark theme flips only
  the tokens via `:root[data-theme='dark']` (set on `<html>` from `settings.theme`).
  Adding a new color = use an existing token.

### Color tokens (light / dark)
| token | light | dark | use |
|---|---|---|---|
| `--bg` | `#f4f5f8` | `#0b0d13` | page background |
| `--bg-1` | `#ffffff` | `#14161d` | primary surface (cards, bars) |
| `--bg-2` | `#f0f1f5` | `#1b1e27` | subtle raised / hover / input bg |
| `--bg-3` | `#e7e9f0` | `#262a35` | deeper fill / thumbnails / track |
| `--line` | `#dedee5` | `#2b3040` | divider / borders |
| `--text` | `#101114` | `#eceef4` | primary text |
| `--text-dim` | `#686b82` | `#9aa0b2` | secondary text |
| `--muted` | `#9497a9` | `#6f7484` | muted / placeholder |
| `--accent` | `#7132f5` | `#8b5cf6` | **brand / primary CTA / links** (Kraken purple) |
| `--accent-2` | `#5741d8` | `#7132f5` | darker purple, secondary accent/border |
| `--accent-deep` | `#5b1ecf` | `#5b1ecf` | deepest purple |
| `--accent-soft` | `rgba(133,91,251,.16)` | `.22` | subtle purple fill |
| `--success` | `#149e61` | `#2fbd80` | positive |
| `--danger` | `#e5484d` | `#ff5d6c` | errors / destructive |
| `--gold` | `#f5a623` | `#ffcc4d` | warning / paused / stars |
| `--panel` | `#ffffff` | `#14161d` | modal/panel surface |

- Shadows: `--shadow-subtle`, `--shadow-micro`. Radius scale: `--r1`=4 `--r2`=6
  `--r3`=8 `--r4`/`--r5`=12 `--r6`=16. **Buttons cap at 12px radius — no pills.**

### Shared UI components (reuse — do NOT hand-roll native controls)
In `src/renderer/src/components/`:
- **`Dropdown<T extends string>`** — styled select. `value`, `options: [val,label][]`,
  `onChange`, `className` (use `"field"` / `"field sm"`). For numeric options, store
  as string and `Number(v)` in onChange. Native `<select>` is not used.
- **`Toggle`** — `checked` / `onChange` switch.
- **`Stepper`** — numeric +/- input.
- **`SettingRow`** — `title` + `desc` + children (the control). Standard settings row.
- **`RadioCards`** (`settings/parts.tsx`) — mutually-exclusive description cards.
- **`Pager`**, **`ContextMenu`**, **`ConfirmModal`**, **`Stars`**, **`CopyCode`**,
  **`Caret`**, **`TagPickInput`**.
- Buttons: `.btn` (`.btn.primary`, `.btn.block`, `.btn.danger`) and `.mini` (compact,
  e.g. list actions). **Custom checkboxes** use the `.pat-check` pattern (a `<button>`
  styled as a box with `.on` state + `::after` checkmark) — never a native checkbox
  when UI consistency matters.

### Korean UI copy
All user-facing strings are Korean. Match surrounding tone (terse, `…` for
in-progress, `✓`/`✗`/`■`/`▶`/`⏸`/`⬇` glyph prefixes for status/actions).

---

## 7. Settings screen

- `components/Settings.tsx` = shell only: draft, unsaved-change guard, save /
  leave-confirm, category tabs. Sections live in `components/settings/`:
  `FolderSection`, `TagSection` (incl. 즐겨찾기 box), `StyleSection`,
  `TranslateSection`, `NetworkSection`, `ManageSection`; shared rows in
  `settings/parts.tsx` (`RadioCards`, `RootList`, `FolderRow`, `ChipList`).
- Sections read/edit through `useSettings()` (`settings/context.ts`):
  `draft`, `patch`, `applySaved`, `isHitomi`, `notify`, `pickDir`, `rescan`.
- All categories render at once; CSS (`.settings-inner[data-show]`) shows the
  active one, so section state and running jobs survive tab switches.

---

## 8. Gotchas / house rules

- **No direct download IPC calls in components** — always `store.startDownload`.
- **Preserve `spec` / fields** when rebuilding items in reducers (progress handler).
- **Every Settings field → add to `DEFAULT_SETTINGS`**; guard reads with `?? default`.
- **`cd` into the project** before npm (cwd resets outside it).
- Typecheck is strict about unused locals — when replacing a selector (e.g. swapping
  `addWork` for `startDownload`), remove the old one.
- Sandbox blocks hitomi network in some contexts; real downloads run in the packaged
  app / normal dev run.
- Online list pagination: clear items (`setItems([])`) before fetching the next page
  so the previous page doesn't linger under the loader (Browse.tsx, TokiBrowse.tsx,
  OnlineList.tsx).
- Electron main is CJS at runtime; shared/renderer are ESM. Keep imports path-correct
  (`../../shared/...`).

---

## 9. Key files map

| area | file |
|---|---|
| IPC contract + DTOs | `src/shared/ipc.ts` |
| Settings type + defaults | `src/shared/types.ts` |
| Folder-name pattern util / title matching | `src/shared/pattern.ts`, `src/shared/title.ts` |
| App lifecycle | `src/main/index.ts` |
| IPC handlers | `src/main/ipc/*.ts` (§2) |
| Favorites model | `src/main/lib/favoriteSync.ts` |
| Hitomi client (DoH, gg.js, download) | `src/main/lib/hitomi.ts` |
| Toki scraper (hidden window) | `src/main/lib/toki.ts` |
| Scanner / parser | `src/main/lib/scanner.ts`, `src/main/lib/parser.ts` |
| Renderer store (sections marked) | `src/renderer/src/store.ts` |
| Favorites list builders | `src/renderer/src/favorites.ts` |
| Card behavior hooks | `components/useWorkCard.tsx`, `useSeriesCard.tsx`, `useTagMenu.tsx` |
| Thumbnails | `src/renderer/src/thumbs.ts`, `components/Thumb.tsx` |
| Reader | `components/Reader.tsx` + `components/reader/` |
| Settings | `components/Settings.tsx` + `components/settings/` |
| Styles + theme tokens | `src/renderer/src/styles.css` |

---

## 10. Favorites model (2026-10)

- ONE heart per gallery: works with a hitomi code → the favorites list
  (`store.onlineFavs`, keyed by code); every local copy's `Work.favorite`
  mirrors it. Uncoded works keep `Work.favorite`. General manga uses in-app
  lists (`settings.normalFavSeries` / `normalFavChapters`), linked to online toki
  favorites (keyed by series url) by normalized title (`titleKey`).
- All heart changes go through main `setFavoriteByCode` / `setWorkFavorite`
  (renderer: `store.toggleUnifiedFav`, `setWorkFavorite`).
- `settings.favoriteMoveToFolder` (default on): heart moves the folder into
  `favoritesDir` (remembers `homePath`), unheart moves it back. A scan only
  ADDS a heart for a work newly found inside `favoritesDir`; it never removes one.
- Favorite lists = `settings.onlineFavLists` ({name, codes}); one favorites
  file format (Pupil-compatible `{favorites, favorite_tags, ranks}`).

## 11. Verifying changes

No test suite. Typecheck + build, then drive the built app over the Chrome
DevTools Protocol: `./node_modules/.bin/electron . --remote-debugging-port=9333`
(if the user's packaged app is running, also set
`ELECTRON_RENDERER_URL=file:///…/out/renderer/index.html` to skip the
single-instance lock), connect to the page target and click / call
`window.api.*`. It uses the real userData — back up `works.json`,
`settings.json`, `online.json` before anything that writes.
