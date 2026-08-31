/**
 * Plugin-local state shared by the surfaces that render in separate React trees:
 * the sidebar entry, the overlay panel, and the session-scoped composer bridge.
 * They live in one plugin closure, so a plain observable is enough — no cordis
 * service is needed to join them.
 *
 * The snapshot object is replaced on every change and never mutated, which is
 * what `useSyncExternalStore` requires in order to skip re-renders.
 *
 * The handoff crosses planes through here. Only a session-scoped slot receives
 * `inputActions`, so the panel cannot fill the composer itself: it publishes a
 * `pending` prompt and the bridge, which is such a slot, consumes it. `bridgeReady`
 * is the bridge reporting that it is mounted, which is how the panel knows whether
 * to offer the button at all instead of dropping the prompt into nothing.
 */

import {
  approvePlan,
  cancelStage,
  fetchRun,
  fetchSnapshot,
  pinIdea,
  recordHandoff,
  removeRun,
  retryDiscover,
  savePrompt,
  saveSettings,
  startApp,
  startDiscover,
  startPlan,
  stopApp,
} from './api.ts'
import type { DiscoverEngine, Run, Settings, Snapshot } from '../types.ts'

/** The panel's tabs, in display order. */
export type TabKey = 'ideas' | 'plan' | 'build' | 'result' | 'history' | 'settings'

/** How often the panel re-reads the snapshot while it is open. */
const POLL_MS = 2500

/** Published state. */
export interface FactoryState {
  readonly open: boolean
  readonly tab: TabKey
  /** True while the about dialog is shown above the panel. */
  readonly aboutOpen: boolean
  /** True during the first load, so the panel can show a placeholder. */
  readonly loading: boolean
  /** True while a user-initiated write is in flight. */
  readonly acting: boolean
  /** Last failure, cleared by the next successful action. */
  readonly error?: string
  /** Transient confirmation text. */
  readonly notice?: string
  /**
   * Set when a poll failed but an older snapshot is still shown: the panel
   * renders a slim reconnect banner instead of discarding what it has.
   */
  readonly stale: boolean
  /**
   * One-line completion nudge for the sidebar dot, set when a stage finishes
   * while the panel is closed; cleared by the next open.
   */
  readonly nudge?: string
  readonly snapshot: Snapshot | null
  /** The run the pipeline tabs render; absent means "the newest one". */
  readonly selectedRunId?: string
  /** Live width of the sidebar column; the panel starts to its right. */
  readonly sidebarWidth: number
  /** Discovery form: topic for the next run. */
  readonly topicDraft: string
  /** Discovery form: pasted material for the `import` engine. */
  readonly notesDraft: string
  /** Discovery form: engine for the next run. */
  readonly engineDraft: DiscoverEngine
  /** The candidate the user pinned before planning. */
  readonly pinnedIdeaId?: string
  /** A history run opened for inspection. */
  readonly detail: Run | null
  /** True when the composer bridge is mounted, i.e. a session is open. */
  readonly bridgeReady: boolean
  /** A build prompt waiting for the bridge to place it in the composer. */
  readonly pending?: { readonly runId: string; readonly text: string }
}

const INITIAL: FactoryState = {
  open: false,
  tab: 'ideas',
  aboutOpen: false,
  loading: false,
  acting: false,
  stale: false,
  snapshot: null,
  sidebarWidth: 0,
  topicDraft: '',
  notesDraft: '',
  engineDraft: 'web-search',
  detail: null,
  bridgeReady: false,
}

/** Sidebar column: the shell's own pane marker, else the hashed AppFrame class. */
const COLUMN_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"]'

/** Observable state container with the `useSyncExternalStore` contract. */
export class FactoryModel {
  private state: FactoryState = INITIAL
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | undefined
  /** Generation counter dropping the results of superseded loads. */
  private generation = 0
  /** True once the topic draft has been seeded from stored settings. */
  private topicSeeded = false
  /** Id of the run the last successful snapshot held, for nudge detection. */
  private lastRunId: string | null = null

  /** Current snapshot (stable identity while nothing changed). */
  readonly getSnapshot = (): FactoryState => this.state

  /**
   * Subscribe to state changes.
   * @param listener - called after every change.
   * @returns an unsubscribe function.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Replace the published state and notify subscribers. */
  private set(patch: Partial<FactoryState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of [...this.listeners]) listener()
  }

  /** Replace the state while deleting keys whose next value is "absent". */
  private clear(patch: Partial<FactoryState>, absent: ReadonlyArray<keyof FactoryState>): void {
    const next = { ...this.state, ...patch } as Record<string, unknown>
    // exactOptionalPropertyTypes: clearing an optional field means deleting it.
    for (const key of absent) delete next[key as string]
    this.state = next as unknown as FactoryState
    for (const listener of [...this.listeners]) listener()
  }

  /** Show the panel, load fresh state, and start polling. */
  open(tab?: TabKey): void {
    this.clear({ open: true, ...tab === undefined ? {} : { tab } }, ['nudge'])
    void this.refresh()
    if (this.timer === undefined) {
      this.timer = setInterval(() => { void this.refresh() }, POLL_MS)
    }
  }

  /** Hide the panel and stop polling. The about dialog lives inside the panel
   * session, so closing the panel dismisses it too. */
  close(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    this.set({ open: false, aboutOpen: false })
  }

  /** Show the about dialog above the panel. */
  openAbout(): void {
    this.set({ aboutOpen: true })
  }

  /** Hide the about dialog, keeping the panel itself open. */
  closeAbout(): void {
    this.set({ aboutOpen: false })
  }

  /** Toggle the panel. */
  toggle(): void {
    if (this.state.open) this.close()
    else this.open()
  }

  /** Switch tabs. */
  setTab(tab: TabKey): void {
    this.clear({ tab }, ['notice'])
  }

  /** Update one discovery form field. */
  setDraft(patch: { topic?: string; notes?: string; engine?: DiscoverEngine }): void {
    if (patch.topic !== undefined) this.topicSeeded = true
    this.set({
      ...patch.topic === undefined ? {} : { topicDraft: patch.topic },
      ...patch.notes === undefined ? {} : { notesDraft: patch.notes },
      ...patch.engine === undefined ? {} : { engineDraft: patch.engine },
    })
  }

  /**
   * Pin one candidate as the preferred idea for planning. The choice is also
   * persisted onto the run document, so it survives a reload and shows up in
   * history; the local toggle stays optimistic and never blocks on the write.
   */
  pinIdea(id: string): void {
    const next = this.state.pinnedIdeaId === id ? undefined : id
    if (next === undefined) this.clear({}, ['pinnedIdeaId'])
    else this.set({ pinnedIdeaId: next })
    const runId = this.state.snapshot?.activeRunId
    if (runId === null || runId === undefined) return
    void pinIdea(runId, next).then(result => {
      if (!result.ok) this.set({ error: result.message })
    })
  }

  /**
   * Point the pipeline tabs at one history run (null returns to the newest).
   * The per-run form state follows the run's own persisted preference.
   */
  setActiveRun(id: string | null): void {
    if (id === null) this.clear({ detail: null }, ['selectedRunId', 'pinnedIdeaId'])
    else this.clear({ selectedRunId: id, detail: null }, ['pinnedIdeaId'])
    void this.refresh()
  }

  /** Report the bridge's mount state; false means no session is open. */
  setBridgeReady(ready: boolean): void {
    if (this.state.bridgeReady === ready) return
    this.set({ bridgeReady: ready })
  }

  /**
   * Track the sidebar column's rendered width so the panel's left edge follows
   * it through folding and dragging instead of assuming a fixed width.
   * @returns a disposer removing both observers.
   */
  trackSidebar(): () => void {
    let resize: ResizeObserver | undefined
    let observed: Element | undefined

    const measure = (): void => {
      const column = document.querySelector(COLUMN_SELECTOR)
      if (column === null) return
      const width = column.getBoundingClientRect().width
      if (this.state.sidebarWidth !== width) this.set({ sidebarWidth: width })
      if (observed === column) return
      // The shell mounts asynchronously and can swap the column element; follow
      // whichever one is currently in the tree.
      resize?.disconnect()
      observed = column
      resize = new ResizeObserver(() => {
        const next = column.getBoundingClientRect().width
        if (this.state.sidebarWidth !== next) this.set({ sidebarWidth: next })
      })
      resize.observe(column)
    }

    measure()
    const mutation = new MutationObserver(() => { measure() })
    mutation.observe(document.body, { childList: true, subtree: true })
    return () => {
      mutation.disconnect()
      resize?.disconnect()
    }
  }

  /**
   * Re-read the snapshot. Concurrent loads settle in call order, so a slow
   * earlier poll cannot overwrite a newer one.
   *
   * A failed poll keeps the previous snapshot and raises `stale` instead of
   * blanking the panel with an error: a transient hiccup should cost one slim
   * banner, not the user's place.
   */
  async refresh(): Promise<void> {
    const generation = ++this.generation
    if (this.state.snapshot === null) this.set({ loading: true })
    const selected = this.state.selectedRunId
    const result = await fetchSnapshot(selected)
    if (generation !== this.generation) return
    if (!result.ok) {
      if (this.state.snapshot === null) this.set({ loading: false, error: result.message })
      else this.set({ loading: false, stale: true })
      return
    }
    const next = result.value
    // The selection fell back to the newest run server-side (deleted or
    // unreadable); follow it rather than re-requesting a ghost id.
    const selectionLost = selected !== undefined && next.activeRunId !== selected
    this.syncNudge(next)
    // Seed the topic field from stored settings on the first successful load, so
    // the form opens with the user's configured focus rather than empty.
    const seed = !this.topicSeeded && this.state.topicDraft === ''
    if (seed) this.topicSeeded = true
    const run = next.activeRun
    const followPin = run !== null && run.id !== this.lastRunId
    if (run !== null) this.lastRunId = run.id
    const preference = followPin ? run?.preferredIdeaId : undefined
    this.clear({
      loading: false,
      stale: false,
      snapshot: next,
      ...seed ? { topicDraft: next.settings.topic } : {},
      ...this.state.snapshot === null ? { engineDraft: next.settings.engine } : {},
      // A different active run invalidates the form-local pin; adopt the run's
      // own persisted preference instead.
      ...followPin && preference !== undefined ? { pinnedIdeaId: preference } : {},
    }, [
      'error',
      ...followPin ? ['pinnedIdeaId' as const] : [],
      ...selectionLost ? ['selectedRunId' as const] : [],
    ])
  }

  /**
   * Compare the incoming active run with the previous one and raise the sidebar
   * nudge when a stage reached a terminal state while the panel was closed.
   */
  private syncNudge(next: Snapshot): void {
    if (this.state.open) return
    const prev = this.state.snapshot?.activeRun
    const run = next.activeRun
    if (prev === null || prev === undefined || run === null || prev.id !== run.id) return
    let message: string | undefined
    if (prev.discover.status === 'running' && run.discover.status !== 'running') {
      message = run.discover.status === 'ready'
        ? `检索完成：${run.ideas.length} 条候选创意待查看`
        : '检索失败，点开查看原因'
    }
    if (message === undefined && prev.plan.status === 'running' && run.plan.status !== 'running') {
      message = run.plan.status === 'ready' ? '计划已生成，待审批' : '计划生成失败，点开查看原因'
    }
    if (message !== undefined) this.set({ nudge: message })
  }

  /** Run one write, holding `acting` and surfacing either a notice or the failure. */
  private async act(
    run: () => Promise<{ ok: true } | { ok: false; message: string }>,
    success: string,
  ): Promise<boolean> {
    if (this.state.acting) return false
    this.clear({ acting: true }, ['error', 'notice'])
    const result = await run()
    if (!result.ok) {
      this.set({ acting: false, error: result.message })
      return false
    }
    this.clear({ acting: false, notice: success }, ['error'])
    await this.refresh()
    return true
  }

  /** Start a discovery run with the current form values. */
  async discover(): Promise<void> {
    const { topicDraft, engineDraft, notesDraft } = this.state
    // Clear a history selection first: the new run is the newest, and the
    // refresh inside `act` should already poll without the stale selection.
    this.clear({}, ['pinnedIdeaId', 'selectedRunId'])
    const started = await this.act(
      () => startDiscover({ topic: topicDraft, engine: engineDraft, notes: notesDraft }),
      '检索任务已启动，正在联网并结构化…',
    )
    if (started) this.set({ tab: 'ideas' })
  }

  /** Generate the plan for the active run. */
  async plan(): Promise<void> {
    const id = this.state.snapshot?.activeRun?.id
    if (id === undefined) return
    const pinned = this.state.pinnedIdeaId
    const started = await this.act(
      () => startPlan({ id, ...pinned === undefined ? {} : { preferredIdeaId: pinned } }),
      '计划任务已启动，正在评估候选创意…',
    )
    if (started) this.setTab('plan')
  }

  /** Abort the active run's in-flight stage. */
  async cancel(stage: 'discover' | 'plan'): Promise<void> {
    const id = this.state.snapshot?.activeRun?.id
    if (id === undefined) return
    await this.act(() => cancelStage(id, stage), '已请求取消，正在写入状态…')
  }

  /** Re-run the active run's failed discovery in place. */
  async retryDiscover(): Promise<void> {
    const id = this.state.snapshot?.activeRun?.id
    if (id === undefined) return
    const started = await this.act(() => retryDiscover(id), '已重新开始检索。')
    if (started) this.clear({ tab: 'ideas' }, ['pinnedIdeaId'])
  }

  /** Persist an edited build prompt onto the active run. */
  async savePrompt(text: string): Promise<void> {
    const id = this.state.snapshot?.activeRun?.id
    if (id === undefined) return
    await this.act(() => savePrompt(id, text), '任务书已保存。')
  }

  /** Approve the active run's plan. */
  async approve(): Promise<void> {
    const id = this.state.snapshot?.activeRun?.id
    if (id === undefined) return
    const done = await this.act(() => approvePlan(id), '计划已审批，可以交给 dsh 开发了。')
    if (done) this.setTab('build')
  }

  /**
   * Publish the build prompt for the bridge to place in the composer. The panel
   * closes so the conversation is visible when the draft lands.
   */
  handOff(): void {
    // `activeRun` is null with no runs yet and undefined before the first
    // snapshot lands; both mean there is nothing to hand over.
    const run = this.state.snapshot?.activeRun ?? null
    if (run === null) return
    const text = run.plan.executionPrompt
    if (text === '') return
    if (!this.state.bridgeReady) {
      this.set({ error: '请先在 dsh 里打开或新建一个会话，然后再送入任务书。' })
      return
    }
    this.set({ pending: { runId: run.id, text } })
    this.close()
  }

  /**
   * Take the pending prompt, if any. Called by the bridge once it has written the
   * draft; the record of the handoff is persisted here rather than in the panel so
   * it only happens when the composer actually received the text.
   * @returns the prompt to place, or undefined.
   */
  takePending(): { runId: string; text: string } | undefined {
    const pending = this.state.pending
    if (pending === undefined) return undefined
    this.clear({}, ['pending'])
    void (async () => {
      await recordHandoff(pending.runId)
      await this.refresh()
    })()
    return pending
  }

  /** Start the produced app locally. */
  async startApp(): Promise<void> {
    const id = this.state.snapshot?.activeRun?.id
    await this.act(() => startApp(id), '已开始启动产物项目。')
  }

  /** Stop the produced app. */
  async stopApp(): Promise<void> {
    await this.act(() => stopApp(), '产物项目已停止。')
  }

  /** Persist a settings patch. */
  async saveSettings(patch: Partial<Settings>): Promise<void> {
    await this.act(() => saveSettings(patch), '设置已保存。')
  }

  /** Delete one run from history. */
  async removeRun(id: string): Promise<void> {
    const done = await this.act(() => removeRun(id), '记录已删除。')
    if (done && this.state.detail?.id === id) this.set({ detail: null })
  }

  /**
   * Load one history run for inspection.
   * @param id - the run to open, or null to close the detail view.
   */
  async openDetail(id: string | null): Promise<void> {
    if (id === null) {
      this.set({ detail: null })
      return
    }
    const result = await fetchRun(id)
    if (!result.ok) {
      this.set({ error: result.message })
      return
    }
    this.clear({ detail: result.value }, ['error'])
  }

  /** Stop polling. Called by the plugin's effect on unload. */
  dispose(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.listeners.clear()
  }
}
