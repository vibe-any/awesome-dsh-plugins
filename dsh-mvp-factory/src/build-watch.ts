/**
 * Build recovery: watching the workspace for what dsh does after a handoff.
 *
 * The handoff itself is fire-and-forget — the build prompt lands in the
 * conversation's composer and dsh writes code with its own tools, in its own
 * session, where this plugin cannot see. What the plugin CAN see is the disk:
 * the plan pins the project to `<workspace>/<projectDir>`, so this watcher
 * polls that directory and records two transitions on the run document:
 *
 * - the directory appears → dsh has started producing (`active`);
 * - the marker file `.mvp-factory/build-done.json` exists → dsh reports
 *   completion (`done`), with its one-line summary read from the marker. The
 *   build prompt carries the instruction to write it, so the completion signal
 *   is a plain file write — no network, no host services, works with any dsh
 *   setup that can create a file.
 *
 * Polling (a stat + a marker read per tick) beats fs.watch here: no recursive
 * watcher portability gaps, no re-arm after the directory is created, and the
 * cost is negligible at one watched run at a time.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuildWatch } from './types.ts'

/** Marker file the build prompt instructs dsh to write on completion. */
export const MARKER_PATH = '.mvp-factory/build-done.json'

/** Poll cadence; the panel itself re-renders off its own 2.5s snapshot poll. */
const POLL_MS = 4000

/**
 * Read the marker's one-line summary. Well-formed JSON uses its `summary`
 * field; anything else is taken as literal text (truncated) so a model that
 * ignored the format still delivers a readable note.
 * @param text - the marker file's contents.
 * @returns the summary text, or '' when the file is empty.
 */
export function parseMarker(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed !== null && typeof parsed === 'object') {
      const summary = (parsed as Record<string, unknown>)['summary']
      if (typeof summary === 'string' && summary.trim() !== '') return summary.trim().slice(0, 300)
    }
  } catch {
    // Not JSON — fall through and treat the raw text as the summary.
  }
  return trimmed.slice(0, 300)
}

/** Owns one poll timer per handed-off run. */
export class BuildWatcher {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>()

  /**
   * Watch one run's project directory until dsh reports completion.
   *
   * `onState` fires only on transitions (waiting → active → done), and the
   * watcher stops itself after `done`. A failed tick (permission hiccup, a
   * directory replaced mid-poll) is simply retried on the next tick.
   * @param runId - the run the watch belongs to; the service keys cancels by it.
   * @param workspace - the configured workspace root.
   * @param projectDir - the run's project directory under the root.
   * @param onState - called with each new watch state to persist.
   */
  watch(
    runId: string,
    workspace: string,
    projectDir: string,
    onState: (next: BuildWatch) => void,
  ): void {
    this.cancel(runId)
    const startedAt = new Date().toISOString()
    const dir = join(workspace, projectDir)
    const marker = join(dir, MARKER_PATH)
    let state: BuildWatch = { status: 'waiting', startedAt }

    const tick = async (): Promise<void> => {
      try {
        const info = await stat(dir).catch(() => undefined)
        if (info?.isDirectory() !== true) return // dsh has not started yet
        if (state.status === 'waiting') {
          state = { ...state, status: 'active', projectSeenAt: new Date().toISOString() }
          onState(state)
        }
        const raw = await readFile(marker, 'utf8').catch(() => undefined)
        if (raw === undefined) return // started but not finished
        const now = new Date().toISOString()
        onState({
          status: 'done',
          startedAt,
          ...state.projectSeenAt !== undefined ? { projectSeenAt: state.projectSeenAt } : {},
          completedAt: now,
          summary: parseMarker(raw),
        })
        this.cancel(runId)
      } catch {
        // Transient fs error; the next tick retries.
      }
    }

    const timer = setInterval(() => { void tick() }, POLL_MS)
    this.timers.set(runId, timer)
    void tick()
  }

  /**
   * Stop one run's watch.
   * @param runId - the run whose watch to stop.
   */
  cancel(runId: string): void {
    const timer = this.timers.get(runId)
    if (timer !== undefined) {
      clearInterval(timer)
      this.timers.delete(runId)
    }
  }

  /** Stop every watch. Called by the plugin's effect on unload. */
  dispose(): void {
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
  }
}
