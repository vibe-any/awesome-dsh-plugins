/**
 * Host half: resolve the state root, then mount the HTTP routes once the profile
 * composes a web server.
 *
 * Registration rides `ctx.effect` because `webServer.register` throws on a
 * duplicate `(kind, path)`; an un-disposed route would break the next reload of
 * this plugin. The same effect owns the coordinator's `dispose()`, so a reload
 * cannot leave the result stage's dev server running.
 *
 * This module also makes the package a host Loader entry, which is what lets
 * `dsh-client-modules` discover the `dsh.client` declaration and serve the
 * browser half at `/plugins/dsh-mvp-factory/client.js`.
 */

import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { AgentDefaultModelLike, LlmLike, WebLike } from './harness.ts'
import { mountRoutes, type WebServerLike } from './routes.ts'
import { FactoryService } from './service.ts'
import { FactoryStore } from './store.ts'

/** Deployment policy, set from the plugin's `config` in cordis.yml. */
export interface Config {
  /**
   * State root holding `runs/` and `settings.json`. Relative values resolve
   * against the resolved DSH home. Defaults to `$DSH_HOME/mvp-factory`.
   */
  readonly root?: string
  /** Maximum UTF-8 byte length accepted for one run document (default 4 MiB). */
  readonly maxRunBytes?: number
}

/** The `Context` surface this plugin touches (structural: the host owns the real Context). */
interface HostContext {
  inject(services: string[], callback: (scoped: HostContext) => void): void
  effect(callback: () => () => void, label?: string): void
  /** Optional-service lookup; returns undefined when nothing provides the name. */
  get(name: string): unknown
  webServer: WebServerLike
  llm: LlmLike
  agentDefaultModel: AgentDefaultModelLike
}

/** Cordis plugin name. */
export const name = 'mvp-factory'

/**
 * Services whose absence should delay `apply`. `web` is deliberately absent:
 * discovery degrades to the model-only and import engines without it, and a
 * headless-search composition should still get the rest of the panel.
 */
export const inject = ['webServer', 'llm', 'agentDefaultModel']

/** Default run-document ceiling: a plan plus a dozen ideas is far below this. */
const DEFAULT_MAX_RUN_BYTES = 4 * 1024 * 1024

/**
 * Resolve the DSH home the same way the harness does, so this plugin's state
 * lands beside the rest of the user's dsh files.
 * @returns the resolved home directory.
 */
function dshHome(): string {
  const configured = process.env['DSH_HOME']
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
}

/**
 * Validate config at the configuration boundary and materialize defaults. A bad
 * value is a misconfiguration: fail loud at load rather than quietly writing
 * state into a surprising directory.
 * @param config - raw plugin config.
 * @returns the resolved root and size ceiling.
 * @throws {TypeError} when a supplied field has the wrong type or range.
 */
function resolve(config: Config): { root: string; maxRunBytes: number } {
  const { root, maxRunBytes } = config
  if (root !== undefined && (typeof root !== 'string' || root === '')) {
    throw new TypeError(`mvp-factory: root must be a non-empty string, got ${String(root)}`)
  }
  if (maxRunBytes !== undefined && (!Number.isSafeInteger(maxRunBytes) || maxRunBytes < 1)) {
    throw new TypeError(`mvp-factory: maxRunBytes must be a positive safe integer, got ${String(maxRunBytes)}`)
  }
  const home = dshHome()
  return {
    root: root === undefined ? join(home, 'mvp-factory') : isAbsolute(root) ? root : join(home, root),
    maxRunBytes: maxRunBytes ?? DEFAULT_MAX_RUN_BYTES,
  }
}

/**
 * Host plugin body.
 * @param ctx - host context.
 * @param config - plugin config from cordis.yml.
 */
export function apply(ctx: HostContext, config: Config = {}): void {
  const store = new FactoryStore(resolve(config))
  // Headless compositions never provide webServer, and this plugin is entirely a
  // web surface: without one there is simply nothing to mount, which is correct.
  ctx.inject(inject, (host) => {
    host.effect(() => {
      const service = new FactoryService(store, {
        llm: host.llm,
        agentDefaultModel: host.agentDefaultModel,
        web: host.get('web') as WebLike | undefined,
      })
      const unmount = mountRoutes(host.webServer, service)
      // One effect owns both, so the dev server is killed in the same teardown
      // that removes the routes able to start another.
      return () => {
        unmount()
        service.dispose()
      }
    }, 'mvp-factory: http routes')
  })
}
