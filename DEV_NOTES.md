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

## 2. IPC pattern (follow exactly when adding a channel)

Three files move in lockstep:

1. **`src/shared/ipc.ts`**
   - Add the channel string to the `IPC` const map: `myThing: 'ns:myThing'`.
   - Add the typed method signature to the `Api` interface:
     `myThing: (arg: X) => Promise<Y>`.
   - Shared DTO interfaces (e.g. `HitomiProgress`, `TokiChapter`, `GallerySummary`)
     live here too.
2. **`src/preload/index.ts`** — expose it:
   `myThing: (arg) => ipcRenderer.invoke(IPC.myThing, arg)`.
   - Event channels (main→renderer) use the `on...` + `ipcRenderer.on` + returned
     unsubscribe pattern (see `onHitomiProgress`).
3. **`src/main/index.ts`** — handle it inside `registerIpc()`:
   `ipcMain.handle(IPC.myThing, (_e, arg: X) => ...)`.
   - `store` (the `Store` instance) and `mainWindow` are module-level and in scope.

Renderer calls everything via `window.api.*` (typed by the `Api` interface).

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

- **Concurrency gate** in `src/main/index.ts`: `acquireDownloadSlot(signal?)`.
  Limit = `settings.maxConcurrentDownloads` (0 = unlimited), read live per acquire.
  Waiters released FIFO; also wakes on abort.
- **Per-download abort**: `dlControllers: Map<code, AbortController>`. `download:stop`
  IPC aborts by code. Each of the 3 download handlers (`hitomiDownload`,
  `runTokiDownload`, `tokiDownloadGeneric`) creates a controller, emits `queued`
  before acquiring a slot, threads `controller.signal` into the lib function, and on
  abort emits phase `stopped` + throws `new Error(STOP_MSG)` (`'DOWNLOAD_STOPPED'`).
- Lib functions take an optional `signal?: AbortSignal` and call
  `signal?.throwIfAborted()` at each loop iteration:
  `downloadGallery` (hitomi.ts), `tokiDownloadSeries` + `downloadGenericChapters`
  (toki.ts). Hitomi checks per-image (near-instant stop); toki checks per-chapter
  (stop lands at the next chapter boundary — 4 parallel image workers per chapter).
- **`HitomiProgress.phase`** union (shared/ipc.ts):
  `'queued' | 'fetching' | 'downloading' | 'enriching' | 'done' | 'error' | 'stopped'`.
  Progress channel is reused for toki + generic (code = seriesUrl / `backup:<title>`).

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
- **`RadioCards`** (local to Settings.tsx) — mutually-exclusive description cards.
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

## 7. Settings screen (`components/Settings.tsx`)

- Categories via `CATS` array (`{ id, label, modes }`). Current order (folder first):
  `folder` ('폴더·저장') → `fav` → `style` → `translate` → `network`
  ('네트워크·다운로드') → `manage`. Default selected cat = `'folder'`.
- Each `<section data-cat="...">` is shown/hidden by selected cat. Many rows are
  gated by `isHitomi` (mode).
- Works on a **`draft`** copy; `patch({ key: value })` updates draft; saved via the
  store. Live preview examples render from `draft` (e.g. pattern preview with
  `fillNamePattern(p, SAMPLE_FIELDS)`).

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
| Settings type + defaults + patterns | `src/shared/types.ts` |
| Folder-name pattern util | `src/shared/pattern.ts` |
| Main process / all handlers | `src/main/index.ts` (`registerIpc()`) |
| Hitomi download + online browse | `src/main/lib/hitomi.ts` |
| Toki/general-manga scrape + download | `src/main/lib/toki.ts` |
| Folder-name → id/title/artist parser | `src/main/lib/parser.ts` |
| Scanner (library stamping) | `src/main/lib/scanner.ts` |
| Preload bridge | `src/preload/index.ts` |
| Renderer store | `src/renderer/src/store.ts` |
| Styles + theme tokens | `src/renderer/src/styles.css` |
| Settings UI | `src/renderer/src/components/Settings.tsx` |
| Download manager UI (stop/retry/all) | `src/renderer/src/components/Download.tsx` |
| Online lists | `Browse.tsx` (hitomi), `TokiBrowse.tsx`, `OnlineList.tsx` |
| Reader | `src/renderer/src/components/Reader.tsx` |
| Download modals | `TokiDownloadModal.tsx`, `TokiBackupModal.tsx` |
</content>
</invoke>
