/**
 * Result stage: run the produced app on this machine.
 *
 * One process at a time, held in memory rather than on disk. A pid that outlived
 * the harness could not be adopted safely anyway — the child dies with the
 * parent's process group — so persisting it would only produce stale rows the UI
 * would have to disbelieve. `dispose()` is what the plugin's effect calls, which
 * is why a reload cannot leave an orphaned dev server behind.
 *
 * The commands are the user's own settings text, executed through a shell under
 * the user's account. That is the feature, so the guard is at the route: only a
 * same-origin POST reaches `start`, and the workspace must be an existing
 * absolute directory before anything is spawned.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fail, ok, type AppProcess, type AppStatus, type Result, type Settings } from './types.ts'

/** Tail of combined output kept for the UI, in characters. */
const MAX_LOG_CHARS = 40000

/** How long a freshly spawned dev command must survive before it counts as running. */
const SETTLE_MS = 2000

/** Grace period between SIGTERM and SIGKILL when stopping. */
const KILL_GRACE_MS = 3000

/** Nothing running. */
const STOPPED: AppProcess = {
  status: 'stopped',
  workspace: '',
  command: '',
  url: '',
  log: '',
}

/** Owns the single locally running product process. */
export class AppRunner {
  private state: AppProcess = STOPPED
  private child: ChildProcess | undefined
  private settleTimer: NodeJS.Timeout | undefined

  /** Current process state, detached for publication. */
  snapshot(): AppProcess {
    return { ...this.state }
  }

  /** Replace the published state. */
  private set(patch: Partial<AppProcess> & { status: AppStatus }): void {
    this.state = { ...this.state, ...patch }
  }

  /** Append output, keeping only the tail. */
  private append(text: string): void {
    const combined = this.state.log + text
    this.state = {
      ...this.state,
      log: combined.length <= MAX_LOG_CHARS ? combined : combined.slice(combined.length - MAX_LOG_CHARS),
    }
  }

  /** Whether a process is currently held. */
  private busy(): boolean {
    return this.child !== undefined
      || this.state.status === 'installing'
      || this.state.status === 'starting'
      || this.state.status === 'running'
  }

  /**
   * Run one command to completion in the workspace.
   * @returns the exit code, or a message when the process could not be spawned.
   */
  private runOnce(command: string, workspace: string): Promise<{ code: number } | { error: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, { cwd: workspace, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout?.on('data', (chunk: Buffer) => { this.append(chunk.toString('utf8')) })
      child.stderr?.on('data', (chunk: Buffer) => { this.append(chunk.toString('utf8')) })
      child.once('error', (error) => { resolve({ error: String(error) }) })
      child.once('close', (code) => { resolve({ code: code ?? -1 }) })
    })
  }

  /**
   * Install dependencies if configured, then start the dev command.
   *
   * Returns as soon as the dev command is spawned: it is long-running, so
   * awaiting it would never resolve. The status advances to `running` on the
   * first output or after {@link SETTLE_MS}, whichever comes first.
   * @param settings - workspace, commands, and the address to show.
   * @param runId - the run whose plan produced this code, when known.
   * @returns the new process state, or a refusal.
   */
  async start(settings: Settings, runId: string | undefined): Promise<Result<AppProcess>> {
    if (this.busy()) return fail('busy', '已经有一个产物进程在运行，请先停止它。')

    const workspace = settings.workspace.trim()
    if (workspace === '') return fail('bad-request', '请先在「设置」里填写产物根目录。')
    if (!isAbsolute(workspace)) return fail('bad-request', '产物根目录必须是绝对路径。')
    try {
      const info = await stat(workspace)
      if (!info.isDirectory()) return fail('bad-request', `${workspace} 不是一个目录。`)
    } catch {
      return fail('bad-request', `产物根目录不存在：${workspace}`)
    }
    const devCommand = settings.devCommand.trim()
    if (devCommand === '') return fail('bad-request', '请先在「设置」里填写启动命令。')

    this.state = {
      status: 'installing',
      ...runId === undefined ? {} : { runId },
      workspace,
      command: devCommand,
      url: settings.appUrl,
      log: '',
      startedAt: new Date().toISOString(),
    }

    const installCommand = settings.installCommand.trim()
    if (installCommand !== '') {
      this.append(`$ ${installCommand}\n`)
      const outcome = await this.runOnce(installCommand, workspace)
      if ('error' in outcome) {
        this.set({ status: 'failed', error: `依赖安装无法启动：${outcome.error}` })
        return ok(this.snapshot())
      }
      if (outcome.code !== 0) {
        this.set({ status: 'failed', error: `依赖安装失败，退出码 ${outcome.code}。` })
        return ok(this.snapshot())
      }
      // A later start must not inherit this run's install output as its own.
      this.append(`\n[依赖安装完成]\n\n`)
    }

    this.append(`$ ${devCommand}\n`)
    const child = spawn(devCommand, { cwd: workspace, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    this.set({ status: 'starting', ...child.pid === undefined ? {} : { pid: child.pid } })

    const settled = (): void => {
      if (this.child === child && this.state.status === 'starting') this.set({ status: 'running' })
    }
    child.stdout?.on('data', (chunk: Buffer) => { this.append(chunk.toString('utf8')); settled() })
    child.stderr?.on('data', (chunk: Buffer) => { this.append(chunk.toString('utf8')); settled() })
    this.settleTimer = setTimeout(settled, SETTLE_MS)
    this.settleTimer.unref()

    child.once('error', (error) => {
      if (this.child !== child) return
      this.child = undefined
      this.set({ status: 'failed', error: `启动命令无法执行：${String(error)}` })
    })
    child.once('close', (code) => {
      if (this.child !== child) return
      this.child = undefined
      // A dev server exiting on its own is a failure to report, except when the
      // exit is the one `stop()` asked for — that path clears `child` first.
      this.append(`\n[进程退出，退出码 ${code ?? -1}]\n`)
      this.set(code === 0 ? { status: 'stopped' } : { status: 'failed', error: `启动命令退出，退出码 ${code ?? -1}。` })
    })

    return ok(this.snapshot())
  }

  /**
   * Stop the running process, escalating to SIGKILL if it ignores SIGTERM.
   * @returns the new state, or a refusal when nothing is running.
   */
  async stop(): Promise<Result<AppProcess>> {
    const child = this.child
    if (child === undefined) {
      // Nothing held, but a previous failure may still be published; clearing it
      // is what the user means by "stop".
      this.state = STOPPED
      return ok(this.snapshot())
    }
    // Detach first so the close handler does not report this as a crash.
    this.child = undefined
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer)
    await new Promise<void>((resolve) => {
      const escalate = setTimeout(() => { child.kill('SIGKILL'); resolve() }, KILL_GRACE_MS)
      escalate.unref()
      child.once('close', () => { clearTimeout(escalate); resolve() })
      child.kill('SIGTERM')
    })
    this.state = STOPPED
    return ok(this.snapshot())
  }

  /** Release the held process. Called by the plugin's effect on unload. */
  dispose(): void {
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer)
    const child = this.child
    this.child = undefined
    this.state = STOPPED
    child?.kill('SIGTERM')
  }
}
