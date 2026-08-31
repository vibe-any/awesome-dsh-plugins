/**
 * Same-origin fetch wrappers over the host routes.
 *
 * Every call resolves to a `Result` and never rejects: a network failure or a
 * non-JSON response is converted into the same refusal shape the host returns,
 * so callers have exactly one error path to render.
 */

import { fail, ROUTES, type AppProcess, type Result, type Run, type Settings, type Snapshot } from '../types.ts'

/** Parse one response body as a `Result`, tolerating a non-JSON error page. */
async function readResult<T>(response: Response): Promise<Result<T>> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return fail(response.ok ? 'bad-request' : 'unavailable', `服务端返回了非 JSON 响应（HTTP ${response.status}）`)
  }
  if (typeof payload === 'object' && payload !== null && 'ok' in payload) {
    return payload as Result<T>
  }
  // A route that answers a bare payload (the snapshot) is a success by shape.
  return response.ok
    ? { ok: true, value: payload as T }
    : fail('bad-request', `请求失败（HTTP ${response.status}）`)
}

/** GET one route. */
async function get<T>(path: string): Promise<Result<T>> {
  try {
    return await readResult<T>(await fetch(path, { cache: 'no-store' }))
  } catch (error) {
    return fail('unavailable', `无法连接到 dsh 服务：${String(error)}`)
  }
}

/** POST one route with a JSON body. */
async function post<T>(path: string, body: Record<string, unknown>): Promise<Result<T>> {
  try {
    return await readResult<T>(await fetch(path, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
  } catch (error) {
    return fail('unavailable', `无法连接到 dsh 服务：${String(error)}`)
  }
}

/** Read the dashboard snapshot, optionally pinned to one run. */
export function fetchSnapshot(activeId?: string): Promise<Result<Snapshot>> {
  return get<Snapshot>(activeId === undefined ? ROUTES.snapshot : `${ROUTES.snapshot}?active=${encodeURIComponent(activeId)}`)
}

/** Read one run in full. */
export function fetchRun(id: string): Promise<Result<Run>> {
  return get<Run>(`${ROUTES.run}?id=${encodeURIComponent(id)}`)
}

/** Start a discovery run. */
export function startDiscover(body: {
  topic: string
  engine: string
  notes: string
}): Promise<Result<Run>> {
  return post<Run>(ROUTES.discover, body)
}

/** Start planning for one run. */
export function startPlan(body: { id: string; preferredIdeaId?: string }): Promise<Result<Run>> {
  return post<Run>(ROUTES.plan, body)
}

/** Approve one run's plan. */
export function approvePlan(id: string): Promise<Result<Run>> {
  return post<Run>(ROUTES.approve, { id })
}

/** Record that the build prompt reached the conversation. */
export function recordHandoff(id: string): Promise<Result<Run>> {
  return post<Run>(ROUTES.handoff, { id })
}

/** Start the produced app locally. */
export function startApp(id: string | undefined): Promise<Result<AppProcess>> {
  return post<AppProcess>(ROUTES.appStart, id === undefined ? {} : { id })
}

/** Stop the produced app. */
export function stopApp(): Promise<Result<AppProcess>> {
  return post<AppProcess>(ROUTES.appStop, {})
}

/** Replace settings. */
export function saveSettings(patch: Partial<Settings>): Promise<Result<Settings>> {
  return post<Settings>(ROUTES.settings, patch as Record<string, unknown>)
}

/** Delete one run. */
export function removeRun(id: string): Promise<Result<{ id: string }>> {
  return post<{ id: string }>(ROUTES.remove, { id })
}

/** Abort a run's in-flight discover or plan stage. */
export function cancelStage(id: string, stage: 'discover' | 'plan'): Promise<Result<{ id: string; stage: string }>> {
  return post<{ id: string; stage: string }>(ROUTES.cancel, { id, stage })
}

/** Re-run a failed discovery on the same run document. */
export function retryDiscover(id: string): Promise<Result<Run>> {
  return post<Run>(ROUTES.retry, { id })
}

/** Replace a run's build prompt with an edited brief. */
export function savePrompt(id: string, executionPrompt: string): Promise<Result<Run>> {
  return post<Run>(ROUTES.prompt, { id, executionPrompt })
}

/** Persist (or clear) the run's preferred candidate. */
export function pinIdea(id: string, ideaId?: string): Promise<Result<Run>> {
  return post<Run>(ROUTES.pin, ideaId === undefined ? { id } : { id, ideaId })
}
