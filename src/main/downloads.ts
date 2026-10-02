// Shared runner for every online download (doujin gallery, manga-site series, backup
// site chapters): concurrency gate, user stop, and progress/error reporting on
// the renderer's hitomiProgress channel.
//
// Lifecycle of one download, as the renderer sees it (phase):
//   queued → fetching → downloading … → done
//                    ↘ stopped (user pressed stop, while queued or running)
//                    ↘ error   (message = the failure)
import type { HitomiProgress } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import { store, sendToRenderer } from './context'

// Rejection message for a user-stopped download. The renderer recognizes it, so
// a stop isn't shown as a failure.
export const STOP_MSG = 'DOWNLOAD_STOPPED'

// Abort handles of queued/running downloads, keyed by progress code (doujin
// code / manga-site seriesUrl / "backup:<title>").
const controllers = new Map<string, AbortController>()

// Concurrency gate (settings · 동시 다운로드). The limit is read on every acquire,
// so a changed setting applies to downloads not yet started. 0 = unlimited.
// Waiters are released FIFO as slots free up.
let active = 0
const waiters: (() => void)[] = []

async function acquireSlot(signal: AbortSignal): Promise<() => void> {
  const limit = store.settings.maxConcurrentDownloads ?? 0
  if (limit > 0) {
    while (active >= limit) {
      if (signal.aborted) throw new Error(STOP_MSG)
      // Wake on either a freed slot or an abort, whichever comes first.
      await new Promise<void>((resolve) => {
        const wake = (): void => {
          signal.removeEventListener('abort', wake)
          resolve()
        }
        waiters.push(wake)
        signal.addEventListener('abort', wake, { once: true })
      })
      if (signal.aborted) throw new Error(STOP_MSG)
    }
  }
  active++
  let released = false
  return () => {
    if (released) return
    released = true
    active--
    waiters.shift()?.()
  }
}

// Report progress for this download. `label` is used as the title when the
// download has none yet (e.g. doujin learns the title only once fetching).
export type Report = (
  phase: HitomiProgress['phase'],
  done?: number,
  total?: number,
  label?: string
) => void

// Run `task` as download `code`: waits for a slot, wires the stop button to
// `signal`, reports queued/fetching/stopped/error automatically. The task
// reports its own 'downloading' / 'done' progress via `report`.
export async function runDownload<T>(
  code: string,
  title: string,
  task: (signal: AbortSignal, report: Report) => Promise<T>
): Promise<T> {
  const send = (p: Omit<HitomiProgress, 'code'>): void =>
    sendToRenderer(IPC.hitomiProgress, { code, ...p } satisfies HitomiProgress)
  const report: Report = (phase, done = 0, total = 0, label = '') =>
    send({ title: title || label, done, total, phase })

  const controller = new AbortController()
  controllers.set(code, controller)
  report('queued')
  try {
    const release = await acquireSlot(controller.signal)
    report('fetching')
    try {
      return await task(controller.signal, report)
    } finally {
      release()
    }
  } catch (err: any) {
    if (controller.signal.aborted || err?.message === STOP_MSG) {
      report('stopped')
      throw new Error(STOP_MSG)
    }
    send({ title, done: 0, total: 0, phase: 'error', message: String(err?.message ?? err) })
    throw err
  } finally {
    controllers.delete(code)
  }
}

// Stop a queued/running download. Returns false if nothing was running.
export function stopDownload(code: string): boolean {
  const c = controllers.get(code)
  if (!c) return false
  c.abort()
  return true
}
