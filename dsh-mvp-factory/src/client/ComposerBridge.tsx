/**
 * The build handoff, and the only reason this plugin registers a composer slot.
 *
 * `inputActions` reaches session-scoped slot components only, so the overlay
 * panel — which is root-scoped — cannot write the composer draft itself. This
 * component sits in `conversation.input.left`, reports its presence to the model
 * so the panel knows a session is open, and writes the draft when the panel
 * publishes a pending prompt.
 *
 * It renders nothing. The public input face is `setDraft(text)` only — caret
 * handles stay private to the composer's own InputBar — so the prompt is appended
 * to the end of the draft rather than inserted at the cursor.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { FactoryModel } from './model.ts'

/** The composer actions this surface uses (framework-standard prop). */
interface InputActionsLike {
  /** Replace the whole draft text. */
  setDraft(text: string): void
}

/** The owner share of the input-row slots (framework-standard prop). */
interface InputZoneLike {
  readonly input?: { readonly draft?: string }
}

/** Props the slot renderer supplies. */
export type ComposerBridgeProps = InputZoneLike & {
  readonly inputActions?: InputActionsLike
}

/**
 * Append the build prompt to the current draft.
 * @param draft - current draft text.
 * @param text - the prompt to add.
 * @returns the combined draft.
 */
export function appendPrompt(draft: string, text: string): string {
  if (draft.trim() === '') return text
  return `${draft.replace(/\s+$/, '')}\n\n${text}`
}

/**
 * Build the composer bridge bound to one shared model.
 * @param model - shared panel state.
 * @returns the slot component.
 */
export function createComposerBridge(model: FactoryModel) {
  return function MvpFactoryComposerBridge(props: ComposerBridgeProps): ReactNode {
    const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
    const actions = props.inputActions
    const draft = props.input?.draft ?? ''

    // Presence is what the panel checks before offering the handoff button: this
    // component only exists while a session is open.
    useEffect(() => {
      model.setBridgeReady(actions !== undefined)
      return () => { model.setBridgeReady(false) }
    }, [actions !== undefined])

    useEffect(() => {
      if (state.pending === undefined || actions === undefined) return
      const pending = model.takePending()
      if (pending === undefined) return
      actions.setDraft(appendPrompt(draft, pending.text))
    }, [state.pending, actions !== undefined])

    return null
  }
}
