/**
 * Pipeline coordinator: the one object the HTTP surface talks to.
 *
 * Discovery and planning are model calls that take tens of seconds, so both
 * routes return immediately with the run marked `running` and the work continues
 * in the background; the browser half polls the snapshot. That is why every
 * background task ends by writing the run document — the document, not an
 * in-memory promise, is the thing the UI reads.
 *
 * In-flight ids are tracked here so a double click cannot start two model calls
 * against the same run and have the slower one overwrite the faster one's result.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { AppRunner } from './app-runner.ts'
import { BuildWatcher, MARKER_PATH, parseMarker } from './build-watch.ts'
import { runDiscover } from './discover.ts'
import type { AgentDefaultModelLike, LlmLike, ModelRoute, WebLike } from './harness.ts'
import { IDLE_PLAN, runPlan } from './planner.ts'
import { parseModelOverride } from './settings.ts'
import { FactoryStore, isRunId, newRunId, RUN_SCHEMA_VERSION } from './store.ts'
import {
  fail,
  ok,
  type AppProcess,
  type BuildWatch,
  type DiscoverEngine,
  type ModelInfo,
  type Result,
  type Run,
  type RunLogEntry,
  type Settings,
  type Snapshot,
} from './types.ts'

/** Engines a request body may name. */
const ENGINES: readonly DiscoverEngine[] = ['web-search', 'tavily', 'model-only', 'import']

/** Stages a cancel request may name. */
const CANCEL_STAGES = ['discover', 'plan'] as const

/** Longest pasted research material accepted, in characters. */
const MAX_NOTES_CHARS = 200000

/** Minimum gap between two progress writes for one plan stage, in ms. The panel polls at 2.5s. */
const PLAN_PROGRESS_WRITE_MS = 2000

/** Host services the coordinator needs. The two optional ones may be absent. */
export interface ServiceDeps {
  readonly llm: LlmLike
  readonly agentDefaultModel: AgentDefaultModelLike
  /** Absent when the composition mounts no web capability. */
  readonly web?: WebLike | undefined
}

/** Read one body field as text. */
function bodyText(body: Record<string, unknown>, key: string): string {
  const raw = body[key]
  return typeof raw === 'string' ? raw : ''
}

/** Keep the run log bounded; the newest notes are the useful ones. */
function appendLog(run: Run, entries: readonly RunLogEntry[]): readonly RunLogEntry[] {
  const combined = [...run.log, ...entries]
  return combined.length <= 200 ? combined : combined.slice(combined.length - 200)
}

/** Owns storage, the app process, the build watches, and the in-flight set. */
export class FactoryService {
  private readonly store: FactoryStore
  private readonly runner = new AppRunner()
  private readonly builds = new BuildWatcher()
  private readonly deps: ServiceDeps
  /** Runs with a model call in flight; keyed `<stage>:<runId>`. */
  private readonly inFlight = new Set<string>()
  /** Abort handles for the in-flight stages, keyed the same way. */
  private readonly cancels = new Map<string, AbortController>()
  /** Whether the startup sweep has run (or is running); it runs once per process. */
  private backfilled = false

  /**
   * @param store - the document store.
   * @param deps - host services.
   */
  constructor(store: FactoryStore, deps: ServiceDeps) {
    this.store = store
    this.deps = deps
    // Handoffs made before this plugin learned to watch the workspace (or made
    // in a previous process lifetime) have no build state; sweep once so those
    // runs recover what is still on disk. Best-effort: a failure here must not
    // take the service down.
    void this.backfillBuilds().catch(() => { this.backfilled = false })
  }

  /**
   * Give pre-watch handoffs their build state from the disk.
   *
   * For every handed-off run without build state, look at its project directory
   * under the configured workspace root:
   * - completion marker present → `done` with the marker's summary (a build
   *   that finished under the new prompt format but was never watched);
   * - directory with a package.json → `done` by documented heuristic — the
   *   deliverable exists and the result stage can start it, and a build old
   *   enough to predate the watch that also has its manifest is, for recovery
   *   purposes, finished;
   * - directory without a package.json → `active` (possibly still building);
   * - no directory at all → nothing written (the run may simply never have
   *   been built), but a watch starts so a build that is still going recovers
   *   through the normal path.
   */
  private async backfillBuilds(): Promise<void> {
    if (this.backfilled) return
    this.backfilled = true
    const settings = await this.store.readSettings()
    const workspace = settings.workspace.trim()
    if (workspace === '' || !isAbsolute(workspace)) return
    const runs = await this.store.listRuns()
    for (const summary of runs) {
      if (summary.handedOff !== true || summary.buildStatus !== undefined) continue
      const found = await this.store.readRun(summary.id)
      if (!found.ok) continue
      const run = found.value
      if (run.handoffAt === undefined) continue
      const projectDir = run.projectDir
      if (projectDir === undefined || projectDir === '') continue
      const dir = join(workspace, projectDir)
      const info = await stat(dir).catch(() => undefined)
      if (info?.isDirectory() !== true) {
        // Nothing on disk yet: either dsh never built it, or a build that was
        // running across the restart is still going — watch so recovery lands.
        this.builds.watch(run.id, workspace, projectDir, next => {
          void this.recordBuild(run.id, projectDir, next)
        })
        continue
      }
      const marker = await readFile(join(dir, MARKER_PATH), 'utf8').catch(() => undefined)
      const manifest = await stat(join(dir, 'package.json')).catch(() => undefined)
      const now = new Date().toISOString()
      let watch: BuildWatch
      let message: string
      if (marker !== undefined) {
        const summary = parseMarker(marker)
        watch = {
          status: 'done', startedAt: run.handoffAt, completedAt: now,
          ...summary !== '' ? { summary } : {},
        }
        message = `收到 dsh 完成回执（补录）${summary !== '' ? `：${summary}` : '。'}`
      } else if (manifest?.isFile() === true) {
        watch = {
          status: 'done', startedAt: run.handoffAt, completedAt: now,
          summary: '（补录）项目目录已存在且含 package.json，按已完成处理；可在「结果」直接启动。',
        }
        message = '检测到项目目录已存在且含 package.json，标记为已完成（补录）。'
      } else {
        watch = { status: 'active', startedAt: run.handoffAt, projectSeenAt: now }
        message = '检测到项目目录已存在（补录），dsh 可能仍在构建。'
      }
      await this.store.writeRun({
        ...run,
        updatedAt: now,
        build: watch,
        log: appendLog(run, [{ at: now, stage: 'build', message }]),
      })
    }
  }

  /** Release the held app process and the build watches. Called on unload. */
  dispose(): void {
    this.runner.dispose()
    this.builds.dispose()
  }

  /**
   * Resolve the model route for this request: the settings override when it
   * parses, otherwise whatever dsh is currently configured to use.
   */
  private route(settings: Settings): { route: ModelRoute; info: ModelInfo } | undefined {
    const override = parseModelOverride(settings.modelOverride)
    if (override !== undefined) {
      return { route: override, info: { ...override, overridden: true } }
    }
    try {
      const selection = this.deps.agentDefaultModel.currentSelection()
      if (selection.provider === '' || selection.model === '') return undefined
      return {
        route: selection,
        info: { provider: selection.provider, model: selection.model, overridden: false },
      }
    } catch {
      // No default model is configured yet; the UI reports this as "no model".
      return undefined
    }
  }

  /**
   * One read of everything the panel renders.
   * @param activeId - the run the user selected; falls back to the newest when
   * absent, malformed, or no longer readable.
   */
  async snapshot(activeId?: unknown): Promise<Snapshot> {
    const settings = await this.store.readSettings()
    const resolved = this.route(settings)
    let activeRun: Run | null = null
    if (isRunId(activeId)) {
      const selected = await this.store.readRun(activeId)
      if (selected.ok) activeRun = selected.value
    }
    if (activeRun === null) activeRun = await this.store.latestRun()
    return {
      settings: { ...settings, tavilyApiKey: '' },
      tavilyKeyPresent: settings.tavilyApiKey.trim() !== '',
      runs: await this.store.listRuns(),
      activeRun,
      activeRunId: activeRun?.id ?? null,
      app: this.runner.snapshot(),
      model: resolved?.info ?? null,
      searchAvailable: this.deps.web !== undefined,
    }
  }

  /** Read one run document. */
  async run(id: unknown): Promise<Result<Run>> {
    return await this.store.readRun(id)
  }

  /** Replace settings from an untrusted patch. */
  async saveSettings(body: Record<string, unknown>): Promise<Result<Settings>> {
    return ok(await this.store.writeSettings(body))
  }

  /** Delete one run. */
  async remove(body: Record<string, unknown>): Promise<Result<{ id: string }>> {
    return await this.store.removeRun(body['id'])
  }

  /**
   * Create a run and start discovery in the background.
   * @param body - `topic`, `engine`, and `notes` overrides for this run.
   * @returns the freshly created `running` run.
   */
  async discover(body: Record<string, unknown>): Promise<Result<Run>> {
    const settings = await this.store.readSettings()
    const resolved = this.route(settings)
    if (resolved === undefined) {
      return fail('unavailable', 'dsh 还没有配置可用的模型，请先在 dsh 的「设置 → 模型」里选一个。')
    }

    const engine = ENGINES.find(candidate => candidate === body['engine']) ?? settings.engine
    const topicInput = bodyText(body, 'topic').trim()
    const topic = topicInput === '' ? settings.topic : topicInput
    const notes = bodyText(body, 'notes')
    if (notes.length > MAX_NOTES_CHARS) {
      return fail('too-large', `粘贴的材料有 ${notes.length} 字符，超过 ${MAX_NOTES_CHARS} 上限。`)
    }
    if (engine === 'web-search' && this.deps.web === undefined) {
      return fail('unavailable', '当前 dsh 组合没有联网搜索能力，请改用「模型直出」或「粘贴导入」。')
    }
    if (engine === 'tavily' && settings.tavilyApiKey.trim() === '') {
      return fail('unavailable', '使用 Tavily 引擎需要在「设置 → Tavily API Key」中填写 key，可前往 https://app.tavily.com/ 注册获取。')
    }
    if (engine === 'import' && notes.trim() === '') {
      return fail('bad-request', '当前引擎为「粘贴导入」，请先粘贴研究材料。')
    }

    const now = new Date()
    const id = newRunId(now)
    const timestamp = now.toISOString()
    const run: Run = {
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      schemaVersion: RUN_SCHEMA_VERSION,
      label: topic,
      discover: {
        status: 'running',
        engine,
        topic,
        sources: settings.sources,
        queries: [],
        citations: [],
        digest: '',
        startedAt: timestamp,
      },
      ideas: [],
      plan: IDLE_PLAN,
      log: [{ at: timestamp, stage: 'discover', message: `创建检索任务，引擎 ${engine}。` }],
    }
    const created = await this.store.writeRun(run)
    if (!created.ok) return created

    const key = `discover:${id}`
    const controller = new AbortController()
    this.inFlight.add(key)
    this.cancels.set(key, controller)
    // Fire and forget: the route has already answered, and the outcome reaches
    // the user through the run document the next poll reads.
    void (async () => {
      try {
        const outcome = await runDiscover(
          { llm: this.deps.llm, web: this.deps.web, route: resolved.route },
          { settings, topic, engine, notes, signal: controller.signal },
        )
        await this.store.writeRun({
          ...run,
          updatedAt: new Date().toISOString(),
          discover: outcome.discover,
          ideas: outcome.ideas,
          log: appendLog(run, outcome.log),
        })
      } catch (error) {
        // runDiscover reports stage failures in its return value, so reaching
        // here means something unexpected escaped it; record it the same way.
        // A user cancellation lands here too and reads as a decision, not a crash.
        const cancelled = controller.signal.aborted
        const message = cancelled ? '已按要求取消。' : String(error)
        await this.store.writeRun({
          ...run,
          updatedAt: new Date().toISOString(),
          discover: { ...run.discover, status: 'failed', finishedAt: new Date().toISOString(), error: message },
          log: appendLog(run, [{ at: new Date().toISOString(), stage: 'discover', message: cancelled ? '用户取消了检索。' : `检索异常终止：${String(error)}` }]),
        })
      } finally {
        this.inFlight.delete(key)
        this.cancels.delete(key)
      }
    })()

    return ok(run)
  }

  /**
   * Start planning for one run in the background.
   * @param body - `id`, and optionally the `preferredIdeaId` the user pinned.
   * @returns the run marked `running`.
   */
  async plan(body: Record<string, unknown>): Promise<Result<Run>> {
    const found = await this.store.readRun(body['id'])
    if (!found.ok) return found
    const current = found.value
    if (current.ideas.length === 0) {
      return fail('conflict', '这次检索还没有候选创意，请先完成检索。')
    }
    const key = `plan:${current.id}`
    if (this.inFlight.has(key)) return fail('busy', '这次计划正在生成中，请稍候。')

    const settings = await this.store.readSettings()
    const resolved = this.route(settings)
    if (resolved === undefined) {
      return fail('unavailable', 'dsh 还没有配置可用的模型，请先在 dsh 的「设置 → 模型」里选一个。')
    }

    const preferredInput = bodyText(body, 'preferredIdeaId')
    const preferred = current.ideas.some(idea => idea.id === preferredInput) ? preferredInput : undefined
    const timestamp = new Date().toISOString()
    const running: Run = {
      ...current,
      updatedAt: timestamp,
      ...preferred === undefined ? {} : { preferredIdeaId: preferred },
      plan: { ...IDLE_PLAN, status: 'running', startedAt: timestamp },
      log: appendLog(current, [{ at: timestamp, stage: 'plan', message: '创建计划任务。' }]),
    }
    const saved = await this.store.writeRun(running)
    if (!saved.ok) return saved

    const controller = new AbortController()
    this.inFlight.add(key)
    this.cancels.set(key, controller)
    void (async () => {
      // Streaming progress: `runPlan` reports after every plan-stage log entry
      // (model call start, output character milestones, completion). Writes are
      // throttled to roughly the panel's poll rate, serialized so overlapping
      // reports cannot interleave, and always merged into a freshly-read
      // document — that both preserves concurrent edits (a pin landing mid-plan
      // is not clobbered) and refuses to resurrect a run the user deleted.
      let persisted = 0
      let latest: readonly RunLogEntry[] = []
      let lastWriteAt = 0
      let queue: Promise<void> = Promise.resolve()
      const flush = (logSoFar: readonly RunLogEntry[]): Promise<void> => {
        queue = queue.then(async () => {
          latest = logSoFar
          const now = Date.now()
          if (now - lastWriteAt < PLAN_PROGRESS_WRITE_MS || persisted >= logSoFar.length) return
          const fresh = await this.store.readRun(current.id)
          if (!fresh.ok) return
          const pending = logSoFar.slice(persisted)
          persisted = logSoFar.length
          lastWriteAt = now
          await this.store.writeRun({
            ...fresh.value,
            updatedAt: new Date().toISOString(),
            log: appendLog(fresh.value, pending),
          })
        }).catch(() => {
          // A failed progress write must not break the stage; the final write
          // below still persists the complete outcome.
        })
        return queue
      }
      try {
        const outcome = await runPlan(
          { llm: this.deps.llm, route: resolved.route },
          {
            settings,
            ideas: running.ideas,
            preferredIdeaId: preferred,
            signal: controller.signal,
            onUpdate: logSoFar => { void flush(logSoFar) },
          },
        )
        await queue
        const chosen = running.ideas.find(idea => idea.id === outcome.plan.chosenIdeaId)
        const fresh = await this.store.readRun(current.id)
        if (!fresh.ok) return
        const pending = outcome.log.slice(persisted)
        await this.store.writeRun({
          ...fresh.value,
          updatedAt: new Date().toISOString(),
          // The label follows the chosen product once there is one, so history
          // rows read as products rather than as repeated search topics.
          label: chosen === undefined ? fresh.value.label : chosen.title,
          // The project's directory name under the workspace root is decided
          // with the plan, so the result stage can enter it automatically.
          projectDir: outcome.projectDir,
          plan: outcome.plan,
          log: appendLog(fresh.value, pending),
        })
      } catch (error) {
        await queue
        const cancelled = controller.signal.aborted
        const message = cancelled ? '已按要求取消。' : String(error)
        const fresh = await this.store.readRun(current.id)
        if (!fresh.ok) return
        const pending = [...latest.slice(persisted), {
          at: new Date().toISOString(),
          stage: 'plan' as const,
          message: cancelled ? '用户取消了计划生成。' : `计划异常终止：${String(error)}`,
        }]
        await this.store.writeRun({
          ...fresh.value,
          updatedAt: new Date().toISOString(),
          plan: { ...IDLE_PLAN, status: 'failed', error: message },
          log: appendLog(fresh.value, pending),
        })
      } finally {
        this.inFlight.delete(key)
        this.cancels.delete(key)
      }
    })()

    return ok(running)
  }

  /**
   * Approve one run's plan, which is what unlocks the build handoff.
   * @param body - `id`.
   * @returns the approved run.
   */
  async approve(body: Record<string, unknown>): Promise<Result<Run>> {
    const found = await this.store.readRun(body['id'])
    if (!found.ok) return found
    const current = found.value
    if (current.plan.status !== 'ready') {
      return fail('conflict', '计划还没有生成完成，无法审批。')
    }
    const timestamp = new Date().toISOString()
    return await this.store.writeRun({
      ...current,
      updatedAt: timestamp,
      plan: { ...current.plan, approvedAt: timestamp },
      log: appendLog(current, [{ at: timestamp, stage: 'plan', message: '计划已人工审批。' }]),
    })
  }

  /**
   * Record that the build prompt reached the conversation. The browser half is
   * what actually fills the composer — only a session-scoped surface can — so
   * this route exists to persist that it happened. Afterwards the build is
   * dsh's work, invisible from the conversation side, so a workspace watch
   * starts here: it is how the plugin learns the project appeared and dsh
   * reported completion.
   * @param body - `id`.
   * @returns the updated run.
   */
  async handoff(body: Record<string, unknown>): Promise<Result<Run>> {
    const found = await this.store.readRun(body['id'])
    if (!found.ok) return found
    const current = found.value
    if (current.plan.approvedAt === undefined) {
      return fail('conflict', '请先审批计划，再交给 dsh 开发。')
    }
    const timestamp = new Date().toISOString()
    const saved = await this.store.writeRun({
      ...current,
      updatedAt: timestamp,
      handoffAt: timestamp,
      log: appendLog(current, [{ at: timestamp, stage: 'build', message: '任务书已送入 dsh 输入框。' }]),
    })
    if (!saved.ok) return saved

    // Recovery needs a place to look. Both parts come from the plan; when
    // either is missing (no workspace configured, or a run planned before the
    // field existed) there is nothing to watch and the UI says so.
    const settings = await this.store.readSettings()
    const workspace = settings.workspace.trim()
    const projectDir = current.projectDir
    if (workspace !== '' && isAbsolute(workspace) && projectDir !== undefined && projectDir !== '') {
      this.builds.watch(saved.value.id, workspace, projectDir, next => {
        void this.recordBuild(saved.value.id, projectDir, next)
      })
    }
    return saved
  }

  /**
   * Persist one build-watch transition onto the run document, where the panel's
   * snapshot poll picks it up. The write is guarded: a run that was re-planned
   * or re-hired since the watch started (its handoff or project directory no
   * longer matches) is stale — the watch is dropped rather than recorded, since
   * it is polling a directory this run no longer names.
   * @param runId - the run the watch belongs to.
   * @param watchedDir - the directory the watch was started with.
   * @param watch - the new watch state.
   */
  private async recordBuild(runId: string, watchedDir: string, watch: BuildWatch): Promise<void> {
    const found = await this.store.readRun(runId)
    if (!found.ok) return
    const current = found.value
    if (current.handoffAt === undefined || current.projectDir !== watchedDir) {
      this.builds.cancel(runId)
      return
    }
    const entry: RunLogEntry = watch.status === 'active'
      ? { at: watch.projectSeenAt ?? new Date().toISOString(), stage: 'build', message: `检测到 dsh 已开始产出项目目录 ${watchedDir}。` }
      : { at: watch.completedAt ?? new Date().toISOString(), stage: 'build', message: `收到 dsh 完成回执${watch.summary !== undefined && watch.summary !== '' ? `：${watch.summary}` : '。'}` }
    const saved = await this.store.writeRun({
      ...current,
      updatedAt: new Date().toISOString(),
      build: watch,
      log: appendLog(current, [entry]),
    })
    if (!saved.ok) return
    // A completed build is the recovery signal the result stage waits for; the
    // watcher also stops itself, this just makes it certain.
    if (watch.status === 'done') this.builds.cancel(runId)
  }

  /**
   * Pick the directory the produced app should start in.
   *
   * The workspace is a *root*: every run's project collects in a subdirectory
   * named by its plan, so the resolution order is (1) the run's own project
   * directory when it exists on disk, (2) the root itself when it is already a
   * project — the old single-project layout, (3) the root's only child that
   * holds a package.json — the collection layout with one project so far. Two
   * or more children without a run to disambiguate is a refusal, not a guess.
   * @param settings - the user's settings, carrying the workspace root.
   * @param runId - the run whose project to start, when the client named one.
   * @returns the directory commands should run in, or a refusal.
   */
  private async resolveStartDir(settings: Settings, runId: string | undefined): Promise<Result<string>> {
    const root = settings.workspace.trim()
    if (root === '') return fail('bad-request', '请先在「设置」里填写产物根目录。')
    if (!isAbsolute(root)) return fail('bad-request', '产物根目录必须是绝对路径。')
    const rootInfo = await stat(root).catch(() => undefined)
    if (rootInfo === undefined) return fail('bad-request', `产物根目录不存在：${root}`)
    if (!rootInfo.isDirectory()) return fail('bad-request', `${root} 不是一个目录。`)

    const found = runId !== undefined ? await this.store.readRun(runId) : undefined
    const projectDir = found !== undefined && found.ok ? found.value.projectDir : undefined
    if (projectDir !== undefined && projectDir !== '') {
      const dir = join(root, projectDir)
      const info = await stat(dir).catch(() => undefined)
      if (info?.isDirectory() === true) return ok(dir)
      // Named but missing: keep resolving — the project may predate the field
      // or live under a different name — but say so if nothing else fits.
    }

    const hasPackageJson = async (dir: string): Promise<boolean> => {
      const info = await stat(join(dir, 'package.json')).catch(() => undefined)
      return info?.isFile() === true
    }
    if (await hasPackageJson(root)) return ok(root)

    const children = (await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
    const projects: string[] = []
    for (const name of children) {
      if (await hasPackageJson(join(root, name))) projects.push(name)
    }
    const only = projects[0]
    if (projects.length === 1 && only !== undefined) return ok(join(root, only))
    if (projects.length === 0) {
      const named = projectDir !== undefined && projectDir !== ''
      return fail('bad-request', named
        ? `本次 run 的项目目录 ${join(root, projectDir)} 还不存在——任务书可能还没有交给 dsh 开发，或代码写到了别处。`
        : `在 ${root} 下没有找到包含 package.json 的项目子目录。`)
    }
    return fail('conflict', `${root} 下有多个项目（${projects.join('、')}）。请在「历史」里选中要启动的那条 run，再点启动。`)
  }

  /**
   * Start the produced app locally.
   * @param body - optional `id` recording which run produced the code.
   * @returns the process state, or a refusal.
   */
  async appStart(body: Record<string, unknown>): Promise<Result<AppProcess>> {
    const settings = await this.store.readSettings()
    const id = bodyText(body, 'id')
    const runId = id === '' || !isRunId(id) ? undefined : id
    const dir = await this.resolveStartDir(settings, runId)
    if (!dir.ok) return dir
    // The runner only needs the resolved directory; everything else is shared.
    return await this.runner.start({ ...settings, workspace: dir.value }, runId)
  }

  /** Stop the produced app. */
  async appStop(): Promise<Result<AppProcess>> {
    return await this.runner.stop()
  }

  /**
   * Abort one run's in-flight stage. When the stage has no live background task
   * but is still marked `running` — the signature of a harness restart that
   * lost the task — the mark is cleared instead, so the run never sticks in a
   * forever-running state the UI cannot act on.
   * @param body - `id` and `stage` (`discover` or `plan`).
   * @returns the aborted stage name.
   */
  async cancel(body: Record<string, unknown>): Promise<Result<{ id: string; stage: string }>> {
    const found = await this.store.readRun(body['id'])
    if (!found.ok) return found
    const run = found.value
    const stageInput = body['stage']
    const stage = CANCEL_STAGES.find(candidate => candidate === stageInput)
    if (stage === undefined) return fail('bad-request', 'stage 必须是 discover 或 plan。')

    const key = `${stage}:${run.id}`
    const controller = this.cancels.get(key)
    if (controller !== undefined) {
      controller.abort()
      return ok({ id: run.id, stage })
    }

    const running = stage === 'discover'
      ? run.discover.status === 'running'
      : run.plan.status === 'running'
    if (!running) return fail('conflict', '该阶段没有在运行，无需取消。')
    // Stale mark: the harness restarted and the background task is gone.
    const timestamp = new Date().toISOString()
    const message = '任务已中断（宿主重启导致后台任务丢失），可重试。'
    const updated = stage === 'discover'
      ? {
        ...run,
        updatedAt: timestamp,
        discover: { ...run.discover, status: 'failed' as const, finishedAt: timestamp, error: message },
        log: appendLog(run, [{ at: timestamp, stage: 'discover' as const, message }]),
      }
      : {
        ...run,
        updatedAt: timestamp,
        plan: { ...IDLE_PLAN, status: 'failed' as const, error: message },
        log: appendLog(run, [{ at: timestamp, stage: 'plan' as const, message }]),
      }
    const saved = await this.store.writeRun(updated)
    return saved.ok ? ok({ id: run.id, stage }) : saved
  }

  /**
   * Re-run a failed discovery on the same run document: same engine, same
   * topic, fresh candidates. The plan stage is reset because the idea ids it
   * references would no longer exist.
   * @param body - `id`.
   * @returns the run marked `running` again.
   */
  async retry(body: Record<string, unknown>): Promise<Result<Run>> {
    const found = await this.store.readRun(body['id'])
    if (!found.ok) return found
    const current = found.value
    if (current.discover.status === 'running') return fail('busy', '这次检索正在进行中。')
    if (current.discover.status !== 'failed') {
      return fail('conflict', '只能重试失败的检索；要换方向请新建一次检索。')
    }
    const engine = current.discover.engine
    // Pasted material is not stored verbatim, but a completed import run keeps
    // it as the digest — good enough to restructure from.
    const notes = engine === 'import' ? current.discover.digest : ''
    if (engine === 'import' && notes.trim() === '') {
      return fail('conflict', '粘贴导入的原始材料没有保存，无法原地重试，请重新粘贴后新建检索。')
    }
    if (engine === 'web-search' && this.deps.web === undefined) {
      return fail('unavailable', '当前 dsh 组合没有联网搜索能力，无法重试该引擎。')
    }
    const settings = await this.store.readSettings()
    const resolved = this.route(settings)
    if (resolved === undefined) {
      return fail('unavailable', 'dsh 还没有配置可用的模型，请先在 dsh 的「设置 → 模型」里选一个。')
    }
    if (engine === 'tavily' && settings.tavilyApiKey.trim() === '') {
      return fail('unavailable', '使用 Tavily 引擎需要在「设置」里填写 API key。')
    }

    const timestamp = new Date().toISOString()
    const topic = current.discover.topic
    // A retry regenerates the ideas, so the previous preference, handoff, and
    // project directory no longer refer to anything; omit all three. The build
    // watch, if one was running, polled a directory this run no longer names.
    const { preferredIdeaId: _stalePreference, handoffAt: _staleHandoff, projectDir: _staleProject, build: _staleBuild, ...withoutStale } = current
    this.builds.cancel(current.id)
    const running: Run = {
      ...withoutStale,
      updatedAt: timestamp,
      label: topic,
      discover: {
        status: 'running',
        engine,
        topic,
        sources: current.discover.sources,
        queries: [],
        citations: [],
        digest: '',
        startedAt: timestamp,
      },
      ideas: [],
      plan: IDLE_PLAN,
      log: appendLog(current, [{ at: timestamp, stage: 'discover', message: `重试检索，引擎 ${engine}。` }]),
    }
    const saved = await this.store.writeRun(running)
    if (!saved.ok) return saved

    const key = `discover:${running.id}`
    const controller = new AbortController()
    this.inFlight.add(key)
    this.cancels.set(key, controller)
    void (async () => {
      try {
        const outcome = await runDiscover(
          { llm: this.deps.llm, web: this.deps.web, route: resolved.route },
          { settings, topic, engine, notes, signal: controller.signal },
        )
        await this.store.writeRun({
          ...running,
          updatedAt: new Date().toISOString(),
          discover: outcome.discover,
          ideas: outcome.ideas,
          log: appendLog(running, outcome.log),
        })
      } catch (error) {
        const cancelled = controller.signal.aborted
        const message = cancelled ? '已按要求取消。' : String(error)
        await this.store.writeRun({
          ...running,
          updatedAt: new Date().toISOString(),
          discover: { ...running.discover, status: 'failed', finishedAt: new Date().toISOString(), error: message },
          log: appendLog(running, [{ at: new Date().toISOString(), stage: 'discover', message: cancelled ? '用户取消了检索。' : `检索异常终止：${String(error)}` }]),
        })
      } finally {
        this.inFlight.delete(key)
        this.cancels.delete(key)
      }
    })()

    return ok(running)
  }

  /**
   * Replace a run's build prompt with the user's edited brief. The plan must be
   * ready; editing after approval is allowed because the brief is exactly what
   * the user is reviewing before handoff.
   * @param body - `id` and `executionPrompt`.
   * @returns the updated run.
   */
  async prompt(body: Record<string, unknown>): Promise<Result<Run>> {
    const found = await this.store.readRun(body['id'])
    if (!found.ok) return found
    const current = found.value
    if (current.plan.status !== 'ready') {
      return fail('conflict', '计划还没有生成完成，任务书不可编辑。')
    }
    const text = bodyText(body, 'executionPrompt').trimEnd()
    if (text.trim() === '') return fail('bad-request', '任务书不能为空。')
    const timestamp = new Date().toISOString()
    return await this.store.writeRun({
      ...current,
      updatedAt: timestamp,
      plan: { ...current.plan, executionPrompt: text },
      log: appendLog(current, [{ at: timestamp, stage: 'build', message: '任务书已手动编辑。' }]),
    })
  }

  /**
   * Persist the user's preferred candidate onto the run document, so a pin
   * survives a page reload and is visible in history.
   * @param body - `id`, plus `ideaId` to pin or nothing to clear.
   * @returns the updated run.
   */
  async pin(body: Record<string, unknown>): Promise<Result<Run>> {
    const found = await this.store.readRun(body['id'])
    if (!found.ok) return found
    const current = found.value
    const ideaId = bodyText(body, 'ideaId')
    if (ideaId !== '' && !current.ideas.some(idea => idea.id === ideaId)) {
      return fail('bad-request', `候选 ${ideaId} 不在这条检索记录里。`)
    }
    const timestamp = new Date().toISOString()
    const pinned = ideaId === '' ? undefined : ideaId
    return await this.store.writeRun({
      ...current,
      updatedAt: timestamp,
      ...pinned === undefined ? {} : { preferredIdeaId: pinned },
      log: appendLog(current, pinned === undefined
        ? []
        : [{ at: timestamp, stage: 'discover', message: `指定优先候选 ${pinned}。` }]),
    })
  }
}
