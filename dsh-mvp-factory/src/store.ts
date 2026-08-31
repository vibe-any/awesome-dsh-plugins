/**
 * Persistence: one JSON document per run under `<root>/runs`, plus one
 * `settings.json`. Plain files rather than a database, so the state stays
 * inspectable and editable outside the UI and the package needs no native
 * dependency.
 *
 * Two rules hold everywhere here. Writes go to a sibling temp file and are
 * renamed into place, so a crash mid-write cannot leave a half-written document
 * that later fails to parse. And every id that arrives from a request is checked
 * against `RUN_ID` before it reaches a path join, because these ids come from
 * the browser and a segment containing a separator or `..` would otherwise
 * escape the root.
 */

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fail, ok, type Result, type Run, type RunSummary, type Settings } from './types.ts'
import { normalizeSettings } from './settings.ts'

/** Bumped whenever the run-document shape changes in a way readers must notice. */
export const RUN_SCHEMA_VERSION = 1

/**
 * The only accepted run id shape: `<date>-<time>-<random>`. Deliberately
 * narrower than "a safe filename" so an id can never contain a path separator,
 * a dot, or a percent escape.
 */
const RUN_ID = /^[0-9]{8}-[0-9]{6}-[0-9a-z]{6}$/

/** Newest-first cap on how many runs the history list reports. */
const LIST_LIMIT = 100

/** Where this store keeps its documents and how large one may be. */
export interface StoreOptions {
  readonly root: string
  readonly maxRunBytes: number
}

/**
 * Whether `value` is a usable run id.
 * @param value - anything arriving from a request body or query string.
 * @returns true only for the exact generated id shape.
 */
export function isRunId(value: unknown): value is string {
  return typeof value === 'string' && RUN_ID.test(value)
}

/**
 * Mint a sortable, collision-resistant run id. The date/time prefix makes
 * `readdir` order match chronological order, so listing needs no stat calls.
 * @param now - the creation instant.
 * @returns the new id.
 */
export function newRunId(now: Date = new Date()): string {
  const pad = (value: number, width: number): string => String(value).padStart(width, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}`
  const time = `${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${date}-${time}-${random}`
}

/**
 * Project one stored run onto the history row.
 * @param run - the full document.
 * @returns the summary the list renders.
 */
export function summarize(run: Run): RunSummary {
  return {
    id: run.id,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    label: run.label,
    discoverStatus: run.discover.status,
    ideaCount: run.ideas.length,
    planStatus: run.plan.status,
    approved: run.plan.approvedAt !== undefined,
    handedOff: run.handoffAt !== undefined,
    ...run.build === undefined ? {} : { buildStatus: run.build.status },
  }
}

/** Reads and writes the plugin's documents. */
export class FactoryStore {
  private readonly root: string
  private readonly runsDir: string
  private readonly maxRunBytes: number
  /**
   * Summary projection cache keyed by run id. The panel polls the snapshot
   * every couple of seconds, and a summary needs the whole document parsed —
   * so each entry is reused while the file's stat signature is unchanged and
   * a poll costs N stat calls instead of N full reads.
   */
  private readonly summaryCache = new Map<string, { readonly mtimeMs: number; readonly size: number; readonly summary: RunSummary }>()

  /**
   * @param options - resolved root and per-document size ceiling.
   */
  constructor(options: StoreOptions) {
    this.root = options.root
    this.runsDir = join(options.root, 'runs')
    this.maxRunBytes = options.maxRunBytes
  }

  /** Create the directories both documents live in. Idempotent. */
  private async ensure(): Promise<void> {
    await mkdir(this.runsDir, { recursive: true })
  }

  /** Write `text` to `path` through a temp file, so readers never see a partial document. */
  private async atomicWrite(path: string, text: string): Promise<void> {
    const temp = `${path}.${process.pid}.tmp`
    await writeFile(temp, text, 'utf8')
    await rename(temp, path)
  }

  /** Absolute path of one run document; the id must already be validated. */
  private runPath(id: string): string {
    return join(this.runsDir, `${id}.json`)
  }

  /**
   * Read settings, falling back to defaults when the file is absent or corrupt.
   * A malformed document is not an error the user can act on mid-request, and
   * `normalizeSettings` is total, so this always yields a usable value.
   * @returns the effective settings.
   */
  async readSettings(): Promise<Settings> {
    try {
      const raw = await readFile(join(this.root, 'settings.json'), 'utf8')
      return normalizeSettings(JSON.parse(raw))
    } catch {
      // Absent on first run, or hand-edited into invalid JSON: defaults are the
      // documented behavior either way, and the next write repairs the file.
      return normalizeSettings(undefined)
    }
  }

  /**
   * Merge a patch over current settings and persist the result.
   * @param patch - untrusted partial settings from a request body.
   * @returns the settings as stored.
   */
  async writeSettings(patch: unknown): Promise<Settings> {
    await this.ensure()
    const current = await this.readSettings()
    const merged = typeof patch === 'object' && patch !== null && !Array.isArray(patch)
      ? { ...current, ...patch as Record<string, unknown> }
      : current
    const next = normalizeSettings(merged)
    await this.atomicWrite(join(this.root, 'settings.json'), `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  /**
   * Persist one run document.
   * @param run - the complete run.
   * @returns the run, or a refusal when it exceeds the size ceiling.
   */
  async writeRun(run: Run): Promise<Result<Run>> {
    await this.ensure()
    const text = `${JSON.stringify(run, null, 2)}\n`
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > this.maxRunBytes) {
      return fail('too-large', `run document is ${bytes} bytes, over the ${this.maxRunBytes} byte limit`)
    }
    await this.atomicWrite(this.runPath(run.id), text)
    // The stat signature may not move within the same millisecond; drop the
    // cached projection so the next list cannot serve the previous revision.
    this.summaryCache.delete(run.id)
    return ok(run)
  }

  /**
   * Read one run document.
   * @param id - untrusted run id.
   * @returns the run, or a refusal naming why it could not be read.
   */
  async readRun(id: unknown): Promise<Result<Run>> {
    if (!isRunId(id)) return fail('bad-request', 'run id is not a valid identifier')
    let raw: string
    try {
      raw = await readFile(this.runPath(id), 'utf8')
    } catch {
      // Absent, or unreadable for this user: both are "no such run" to a caller.
      return fail('not-found', `run ${id} was not found`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      return fail('bad-request', `run ${id} is not valid JSON: ${String(error)}`)
    }
    // These documents are written by this plugin, so a structural spot-check is
    // enough; anything that fails it was hand-edited into an unusable shape and
    // says so rather than surfacing later as an undefined field.
    if (typeof parsed !== 'object' || parsed === null || (parsed as { id?: unknown }).id !== id) {
      return fail('bad-request', `run ${id} does not hold a run document`)
    }
    return ok(parsed as Run)
  }

  /**
   * List runs, newest first. Unreadable documents are skipped rather than
   * failing the whole listing, so one corrupt file cannot hide the history.
   *
   * Summaries come from a stat-keyed cache: a file whose mtime and size are
   * unchanged since its last projection is not re-read, which turns the
   * snapshot poll's cost from "parse every document twice" into "stat every
   * document once".
   * @returns up to {@link LIST_LIMIT} summaries.
   */
  async listRuns(): Promise<RunSummary[]> {
    await this.ensure()
    const names = (await readdir(this.runsDir))
      .filter(name => name.endsWith('.json') && isRunId(name.slice(0, -'.json'.length)))
      .sort()
      .reverse()
      .slice(0, LIST_LIMIT)
    const summaries: RunSummary[] = []
    const seen = new Set<string>()
    for (const name of names) {
      const id = name.slice(0, -'.json'.length)
      seen.add(id)
      const cached = this.summaryCache.get(id)
      if (cached !== undefined) {
        try {
          const info = await stat(this.runPath(id))
          if (info.mtimeMs === cached.mtimeMs && info.size === cached.size) {
            summaries.push(cached.summary)
            continue
          }
        } catch {
          // Fallen out of the cache window (deleted mid-listing); re-read below.
        }
      }
      const result = await this.readRun(id)
      if (!result.ok) continue
      const summary = summarize(result.value)
      try {
        const info = await stat(this.runPath(id))
        this.summaryCache.set(id, { mtimeMs: info.mtimeMs, size: info.size, summary })
      } catch {
        // Unstatable after a successful read is vanishingly rare; cache nothing.
      }
      summaries.push(summary)
    }
    // Drop cache rows for documents that no longer exist, so the map cannot
    // grow past the history window.
    for (const id of this.summaryCache.keys()) {
      if (!seen.has(id)) this.summaryCache.delete(id)
    }
    return summaries
  }

  /**
   * Read the newest run in full.
   * @returns the newest readable run, or null when there is none.
   */
  async latestRun(): Promise<Run | null> {
    const summaries = await this.listRuns()
    const newest = summaries[0]
    if (newest === undefined) return null
    const result = await this.readRun(newest.id)
    return result.ok ? result.value : null
  }

  /**
   * Delete one run document.
   * @param id - untrusted run id.
   * @returns the deleted id, or a refusal.
   */
  async removeRun(id: unknown): Promise<Result<{ id: string }>> {
    if (!isRunId(id)) return fail('bad-request', 'run id is not a valid identifier')
    try {
      await rm(this.runPath(id))
    } catch {
      return fail('not-found', `run ${id} was not found`)
    }
    this.summaryCache.delete(id)
    return ok({ id })
  }
}
