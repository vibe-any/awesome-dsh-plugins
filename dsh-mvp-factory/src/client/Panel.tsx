/**
 * The panel, registered into `shell.overlay` — the frame's documented additive
 * seat above all three columns.
 *
 * The overlay layer is click-through, so the panel opts back in with
 * `pointer-events: auto` (see styles.ts) and positions itself over the main area:
 * its left edge tracks the sidebar column's measured width rather than assuming a
 * fixed one, so folding or dragging the sidebar keeps the seam correct.
 *
 * The tab strip is a pipeline stepper: 创意 → 计划 → 行动 → 结果 carry step
 * numbers that fill in as the active run advances, while 历史 and 设置 sit
 * behind a divider as loose utilities.
 */

import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { FactoryModel, TabKey } from './model.ts'
import { CX } from './styles.ts'
import { Icon, IconButton, Skeleton } from './ui.tsx'
import { LOGO_URL } from './logo.ts'
import { BuildTab } from './tabs/BuildTab.tsx'
import { HistoryTab } from './tabs/HistoryTab.tsx'
import { IdeasTab } from './tabs/IdeasTab.tsx'
import { PlanTab } from './tabs/PlanTab.tsx'
import { ResultTab } from './tabs/ResultTab.tsx'
import { SettingsTab } from './tabs/SettingsTab.tsx'

/** The tab strip: flow steps first, then a divider and the utility tabs. */
const TABS: ReadonlyArray<{ key: TabKey; label: string; step?: number }> = [
  { key: 'ideas', label: '创意', step: 1 },
  { key: 'plan', label: '计划', step: 2 },
  { key: 'build', label: '行动', step: 3 },
  { key: 'result', label: '结果', step: 4 },
  { key: 'history', label: '历史' },
  { key: 'settings', label: '设置' },
]

/**
 * Build the panel bound to one shared model.
 * @param model - shared panel state.
 * @returns the slot component.
 */
export function createPanel(model: FactoryModel) {
  return function MvpFactoryPanel(): ReactNode {
    const state = useSyncExternalStore(model.subscribe, model.getSnapshot)

    // Escape closes, matching the shell's own overlay behavior, one layer at a
    // time: the about dialog first, then the panel. Bound only while open so the
    // plugin never swallows the key for anything else.
    useEffect(() => {
      if (!state.open) return
      const onKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        if (model.getSnapshot().aboutOpen) model.closeAbout()
        else model.close()
      }
      document.addEventListener('keydown', onKey)
      return () => { document.removeEventListener('keydown', onKey) }
    }, [state.open])

    if (!state.open) return null

    const snapshot = state.snapshot
    const run = snapshot?.activeRun ?? null
    const app = snapshot?.app
    const modelLabel = snapshot?.model === null || snapshot?.model === undefined
      ? '未配置模型'
      : `${snapshot.model.provider} / ${snapshot.model.model}`
    // A selected history run is what the four pipeline tabs render; say so, or
    // the user cannot tell why the newest candidates are not on screen.
    const historic = snapshot !== null && state.selectedRunId !== undefined

    /** Which flow steps the active run has completed. */
    const stepDone = (step: number): boolean => {
      if (run === null) return false
      switch (step) {
        case 1: return run.ideas.length > 0
        case 2: return run.plan.approvedAt !== undefined
        case 3: return run.handoffAt !== undefined
        // The result step closes either when the produced app is running here
        // or when dsh's completion receipt came back — whichever lands first.
        case 4: return run.build?.status === 'done' || (app?.status === 'running' && app.runId === run.id)
        default: return false
      }
    }

    /** Count or live-dot shown on a tab, or undefined when there is nothing to show. */
    const badge = (key: TabKey): { count?: string; live?: boolean } => {
      if (key === 'ideas' && run !== null && run.ideas.length > 0) return { count: String(run.ideas.length) }
      if (key === 'history' && snapshot !== null && snapshot.runs.length > 0) return { count: String(snapshot.runs.length) }
      if (key === 'build' && run?.plan.approvedAt !== undefined && run.handoffAt === undefined) return { live: true }
      if (key === 'result' && app?.status === 'running') return { live: true }
      return {}
    }

    // The panel fills the window to the right of the sidebar. The measured
    // sidebar width is trusted but bounded: the panel never lets itself be
    // squeezed below a usable minimum, so a mis-measured column cannot turn
    // the whole surface into a narrow strip.
    const MIN_PANEL_WIDTH = 560
    const left = Math.max(0, Math.min(state.sidebarWidth, window.innerWidth - MIN_PANEL_WIDTH))

    return (
      <div className={`${CX}-panel`} style={{ left }}>
        <div className={`${CX}-head`}>
          <img className={`${CX}-head-logo`} src={LOGO_URL} alt="" width={20} height={20} />
          <span className={`${CX}-title`}>MVP 工厂</span>
          <button
            type="button"
            className={`${CX}-titleinfo`}
            title="关于 MVP 工厂"
            aria-label="关于 MVP 工厂"
            onClick={() => { model.openAbout() }}
          >
            <Icon name="info" size={13} />
          </button>
          <span className={`${CX}-sub`}>{modelLabel}</span>
          {historic && <span className={`${CX}-sub`} data-historic="true">历史 run</span>}
          <span className={`${CX}-spacer`} />
          <IconButton name="refresh" label="刷新" disabled={state.acting} onClick={() => { void model.refresh() }} />
          <IconButton name="close" label="关闭" onClick={() => { model.close() }} />
        </div>

        <div className={`${CX}-tabs`}>
          {TABS.map((tab) => {
            const count = badge(tab.key)
            const done = tab.step !== undefined && stepDone(tab.step)
            return (
              <Fragment key={tab.key}>
                {tab.key === 'history' && <span className={`${CX}-tab-sep`} aria-hidden="true" />}
                <button
                  type="button"
                  className={`${CX}-tab`}
                  data-active={String(state.tab === tab.key)}
                  data-done={String(done)}
                  title={done ? '这一步已完成' : undefined}
                  onClick={() => { model.setTab(tab.key) }}
                >
                  {tab.step !== undefined && (
                    <span className={`${CX}-tab-step`}>{done ? <Icon name="check" size={9} /> : tab.step}</span>
                  )}
                  {tab.label}
                  {count.count !== undefined && <span className={`${CX}-tab-badge`}>{count.count}</span>}
                  {count.live === true && <span className={`${CX}-tab-live`} />}
                </button>
              </Fragment>
            )
          })}
        </div>

        {state.stale && <div className={`${CX}-stale`}>连接中断，正在重试…</div>}

        <div className={`${CX}-body`}>
          <div className={`${CX}-content`} data-tab={state.tab}>
            {state.loading && snapshot === null && <Skeleton />}
            {snapshot !== null && (
              <>
                {historic && (
                  <div className={`${CX}-bar`}>
                    <span className={`${CX}-hint`}>
                      正在查看历史 run（{run?.label ?? ''}），检索与计划都作用在这条记录上。
                    </span>
                    <button type="button" className={`${CX}-btn`} onClick={() => { model.setActiveRun(null) }}>
                      回到最新
                    </button>
                  </div>
                )}
                {state.tab === 'ideas' && <IdeasTab model={model} state={state} />}
                {state.tab === 'plan' && <PlanTab model={model} state={state} />}
                {state.tab === 'build' && <BuildTab model={model} state={state} />}
                {state.tab === 'result' && <ResultTab model={model} state={state} />}
                {state.tab === 'history' && <HistoryTab model={model} state={state} />}
                {state.tab === 'settings' && <SettingsTab model={model} state={state} />}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }
}
