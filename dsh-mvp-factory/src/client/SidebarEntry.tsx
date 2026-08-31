/**
 * The sidebar entry, registered into `sidebar.footer.action` — the frame's
 * documented additive seat at the foot of the column, beside Settings.
 *
 * The slot hands each action the column's fold state as `wide`; the rail form is
 * ~56px, so the label is dropped there and only the glyph renders. A dot marks
 * pipeline state worth surfacing outside the panel: an approved plan waiting for
 * handoff, or a stage that finished (or failed) while the panel was closed.
 */

import { useSyncExternalStore, type ReactNode } from 'react'
import type { FactoryModel } from './model.ts'
import { CX } from './styles.ts'
import { LOGO_URL } from './logo.ts'

/** Props the sidebar owner supplies to every footer action. */
export interface SidebarEntryProps {
  /** False in the collapsed rail, where there is no room for a label. */
  readonly wide?: boolean
}

/**
 * Build the sidebar entry bound to one shared model.
 * @param model - shared panel state.
 * @returns the slot component.
 */
export function createSidebarEntry(model: FactoryModel) {
  return function MvpFactorySidebarEntry(props: SidebarEntryProps): ReactNode {
    const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
    const wide = props.wide !== false
    const run = state.snapshot?.activeRun
    const awaitingHandoff = run?.plan.approvedAt !== undefined && run.handoffAt === undefined
    const dot = state.nudge !== undefined || awaitingHandoff
    const title = state.nudge ?? (awaitingHandoff ? 'MVP 工厂 · 有已审批的计划待开发' : 'MVP 工厂')

    return (
      <button
        type="button"
        className={`${CX}-entry`}
        data-active={String(state.open)}
        data-rail={String(!wide)}
        aria-label="MVP 工厂"
        title={title}
        onClick={() => { model.toggle() }}
      >
        <span className={`${CX}-entry-icon`}>
          <img className={`${CX}-entry-logo`} src={LOGO_URL} alt="" width={16} height={16} />
        </span>
        {wide && <span className={`${CX}-entry-label`}>MVP 工厂</span>}
        {dot && <span className={`${CX}-dot`} />}
      </button>
    )
  }
}
