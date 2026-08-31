/**
 * Browser half. Four surfaces over one shared model:
 *
 * - the sidebar entry, in `sidebar.footer.action` — the column's documented
 *   additive seat, at its foot beside Settings;
 * - the panel, in `shell.overlay` — the frame's additive seat — positioned over
 *   the main area to the right of the sidebar;
 * - the about dialog, also in `shell.overlay` one layer above the panel — its
 *   backdrop spans the whole window, sidebar included;
 * - the composer bridge, in `conversation.input.left`. It renders nothing; it
 *   exists because writing the composer draft requires a session-scoped slot,
 *   and the root-scoped panel is not one.
 *
 * Every service this plugin touches is typed structurally, so the package depends
 * on no harness package: only `react` is imported, and the shell answers it from
 * its frozen platform module table. Registrations ride `ctx.effect` so a reload
 * leaves no residue.
 */

import { createAboutDialog } from './AboutDialog.tsx'
import { createComposerBridge } from './ComposerBridge.tsx'
import { FactoryModel } from './model.ts'
import { createPanel } from './Panel.tsx'
import { createSidebarEntry } from './SidebarEntry.tsx'
import { installStyles } from './styles.ts'

/** The slot registry surface this plugin touches. */
interface SlotsLike {
  /**
   * Run `register` once the named slot is declared, and again after a
   * redeclaration.
   * @param slot - target slot key.
   * @param register - contributes the entry; its return value is the disposer.
   */
  inject(slot: string, register: () => unknown): unknown
  /**
   * Contribute one entry.
   * @param meta - entry metadata (`name`, plus `id`/`order` for a list slot).
   * @param component - the React component rendered in the slot.
   */
  register(meta: Record<string, unknown>, component: unknown): () => void
}

/** The client cordis context surface this plugin touches. */
interface FactoryClientContext {
  effect(callback: () => () => void, label?: string): void
  slots: SlotsLike
}

/** Cordis plugin name. */
export const name = 'mvp-factory-client'

/** Required services (cordis service names, not package names). */
export const inject = ['slots']

/**
 * Register one component into one slot, as a releasable effect.
 * @param ctx - client root context.
 * @param slot - target slot key.
 * @param meta - entry metadata.
 * @param component - the component to render.
 * @param label - effect label for diagnostics.
 */
function mount(
  ctx: FactoryClientContext,
  slot: string,
  meta: Record<string, unknown>,
  component: unknown,
  label: string,
): void {
  ctx.effect(() => {
    const dispose = ctx.slots.inject(slot, () => ctx.slots.register(meta, component))
    return () => { if (typeof dispose === 'function') (dispose as () => void)() }
  }, label)
}

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: FactoryClientContext): void {
  const model = new FactoryModel()

  ctx.effect(() => installStyles(), 'mvp-factory: styles')
  // Measured outside the panel so the left edge is already correct on the frame
  // that first paints it, rather than jumping after the first observation.
  ctx.effect(() => model.trackSidebar(), 'mvp-factory: sidebar width')
  ctx.effect(() => () => { model.dispose() }, 'mvp-factory: model')

  mount(
    ctx,
    'sidebar.footer.action',
    { name: 'sidebar.footer.action', id: 'mvp-factory', order: 40 },
    createSidebarEntry(model),
    'mvp-factory: sidebar entry',
  )
  mount(
    ctx,
    'shell.overlay',
    { name: 'shell.overlay', id: 'mvp-factory-panel', order: 50 },
    createPanel(model),
    'mvp-factory: panel',
  )
  mount(
    ctx,
    'shell.overlay',
    { name: 'shell.overlay', id: 'mvp-factory-about', order: 60 },
    createAboutDialog(model),
    'mvp-factory: about dialog',
  )
  mount(
    ctx,
    'conversation.input.left',
    { name: 'conversation.input.left', id: 'mvp-factory-bridge', order: 90 },
    createComposerBridge(model),
    'mvp-factory: composer bridge',
  )
}
