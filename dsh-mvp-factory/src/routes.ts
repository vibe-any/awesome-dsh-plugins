/**
 * HTTP surface. The browser half is the only caller, so every route answers
 * JSON.
 *
 * Mutating routes are same-origin and size-capped. These endpoints write the
 * user's filesystem and spawn shell commands under the user's account, so a page
 * on another origin must not be able to drive them; a browser attaches `Origin`
 * to cross-site POSTs, and a request whose `Origin` does not match its `Host` is
 * refused before the body is read.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FactoryService } from './service.ts'
import { fail, ROUTES, type FailureCode, type Result } from './types.ts'

/** Largest accepted request body. Pasted research notes are the big case. */
const MAX_REQUEST_BYTES = 1024 * 1024

/** The `ctx.webServer` surface this plugin touches (structural: the host owns the real service). */
export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** HTTP status for one refusal code; the body always carries the precise code. */
function statusOf(code: FailureCode): number {
  switch (code) {
    case 'not-found': return 404
    case 'bad-request': return 400
    case 'busy': return 409
    case 'conflict': return 409
    case 'too-large': return 413
    case 'unavailable': return 503
    case 'internal': return 500
  }
}

/** Write one JSON payload, never cached. */
function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/** Write one settled outcome at the status its code implies. */
function sendResult(response: ServerResponse, result: Result<unknown>): void {
  sendJson(response, result.ok ? 200 : statusOf(result.code), result)
}

/** True when the request's Origin matches its Host. */
function sameOrigin(request: IncomingMessage): boolean {
  const { origin, host } = request.headers
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    // A malformed Origin header is not same-origin.
    return false
  }
}

/** Read and parse a JSON body, refusing anything over the cap. */
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/**
 * Mount every route this plugin serves.
 * @param webServer - the host's web server service.
 * @param service - the pipeline coordinator.
 * @returns a disposer removing every registered route.
 */
export function mountRoutes(webServer: WebServerLike, service: FactoryService): () => void {
  const disposers: Array<() => void> = []
  const release = (): void => {
    for (const dispose of disposers) dispose()
    disposers.length = 0
  }

  const get = (path: string, run: (url: URL) => Promise<Result<unknown> | unknown>): void => {
    disposers.push(webServer.register({
      kind: 'exact',
      path,
      handler: async (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' })
          response.end()
          return
        }
        try {
          // Only the pathname was matched; `base` just makes the query parsable.
          const url = new URL(request.url ?? path, 'http://localhost')
          const result = await run(url)
          if (typeof result === 'object' && result !== null && 'ok' in result) {
            sendResult(response, result as Result<unknown>)
            return
          }
          sendJson(response, 200, result)
        } catch (error) {
          sendJson(response, 500, fail('internal', String(error)))
        }
      },
    }))
  }

  const post = (
    path: string,
    run: (body: Record<string, unknown>) => Promise<Result<unknown>>,
  ): void => {
    disposers.push(webServer.register({
      kind: 'exact',
      path,
      handler: async (request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST' })
          response.end()
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, fail('bad-request', 'cross-origin request refused'))
          return
        }
        let body: Record<string, unknown>
        try {
          body = await readJsonBody(request)
        } catch (error) {
          sendJson(response, 400, fail('bad-request', String(error)))
          return
        }
        try {
          sendResult(response, await run(body))
        } catch (error) {
          sendJson(response, 500, fail('internal', String(error)))
        }
      },
    }))
  }

  try {
    // `ROUTES.settings` is POST-only. The snapshot already carries the stored
    // document, so adding a GET here would put a second `(exact, path)` claim on
    // one path — which `register` rejects.
    get(ROUTES.snapshot, async url => await service.snapshot(url.searchParams.get('active')))
    get(ROUTES.run, async url => await service.run(url.searchParams.get('id')))

    post(ROUTES.discover, async body => await service.discover(body))
    post(ROUTES.plan, async body => await service.plan(body))
    post(ROUTES.approve, async body => await service.approve(body))
    post(ROUTES.handoff, async body => await service.handoff(body))
    post(ROUTES.appStart, async body => await service.appStart(body))
    post(ROUTES.appStop, async () => await service.appStop())
    post(ROUTES.settings, async body => await service.saveSettings(body))
    post(ROUTES.remove, async body => await service.remove(body))
    post(ROUTES.cancel, async body => await service.cancel(body))
    post(ROUTES.retry, async body => await service.retry(body))
    post(ROUTES.prompt, async body => await service.prompt(body))
    post(ROUTES.pin, async body => await service.pin(body))
  } catch (error) {
    // `register` throws on a duplicate (kind, path). Without unwinding, the
    // routes claimed before the throw would stay in the table with their
    // disposers lost to the stack: live routes that no reload could remove.
    release()
    throw error
  }

  return release
}
