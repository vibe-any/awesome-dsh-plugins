/**
 * Contracts shared by the host and the browser half. Both sides import this
 * module, so it stays free of node and DOM APIs: it is types, route paths, and
 * the two total functions that turn a settled outcome into a value.
 */

/** Lifecycle of one pipeline stage. */
export type StageStatus = 'idle' | 'running' | 'ready' | 'failed'

/** Where candidate ideas come from. */
export type DiscoverEngine =
  /** `ctx.web.search` with the profile's configured provider, then structuring. */
  | 'web-search'
  /** Tavily Search API (direct HTTP, user-supplied key). */
  | 'tavily'
  /** No network: the model proposes candidates from its own knowledge. */
  | 'model-only'
  /** User-supplied notes are structured as-is. */
  | 'import'

/** Machine-routable refusal codes; the HTTP status is derived from these. */
export type FailureCode =
  | 'not-found'
  | 'bad-request'
  | 'busy'
  | 'conflict'
  | 'too-large'
  | 'unavailable'
  | 'internal'

/** One settled outcome. The browser half switches on `ok`, never on status. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: FailureCode; readonly message: string }

/**
 * Wrap one success.
 * @param value - the payload.
 * @returns the settled success.
 */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

/**
 * Wrap one refusal.
 * @param code - machine-routable reason.
 * @param message - human-readable detail.
 * @returns the settled refusal.
 */
export function fail<T = never>(code: FailureCode, message: string): Result<T> {
  return { ok: false, code, message }
}

/** Every HTTP path this plugin serves, shared so the two halves cannot drift. */
export const ROUTES = {
  /** GET — dashboard snapshot: settings, run list, active run, app process. */
  snapshot: '/mvp-factory/snapshot',
  /** GET `?id=` — one full run document. */
  run: '/mvp-factory/run',
  /** POST — start idea discovery; returns the new run immediately. */
  discover: '/mvp-factory/discover',
  /** POST — evaluate a run's ideas and produce the plan. */
  plan: '/mvp-factory/plan',
  /** POST — approve a run's plan, unlocking the build handoff. */
  approve: '/mvp-factory/approve',
  /** POST — record that the build prompt reached the conversation. */
  handoff: '/mvp-factory/handoff',
  /** POST — install (optional) and start the produced app locally. */
  appStart: '/mvp-factory/app/start',
  /** POST — stop the running app. */
  appStop: '/mvp-factory/app/stop',
  /**
   * POST — replace settings. Reading goes through the snapshot instead: two
   * `(exact, path)` claims on one path are rejected by `webServer.register`.
   */
  settings: '/mvp-factory/settings',
  /** POST — delete one run. */
  remove: '/mvp-factory/remove',
  /** POST — abort one run's in-flight discover or plan stage. */
  cancel: '/mvp-factory/cancel',
  /** POST — re-run a failed discovery on the same run document. */
  retry: '/mvp-factory/retry',
  /** POST — replace a run's build prompt (the user's edited brief). */
  prompt: '/mvp-factory/prompt',
  /** POST — persist the user's preferred candidate onto the run document. */
  pin: '/mvp-factory/pin',
} as const

/** One citeable source behind a discovery run. */
export interface Citation {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
}

/** One structured candidate product idea. */
export interface Idea {
  /** Stable within its run. */
  readonly id: string
  /** 1-based display order as the model ranked them. */
  readonly rank: number
  readonly title: string
  readonly summary: string
  /** Free-form origin label, e.g. `Product Hunt`. */
  readonly source: string
  readonly sourceUrl: string
  readonly problem: string
  readonly targetUsers: string
  readonly businessModel: string
  /** 0-100. */
  readonly noveltyScore: number
  /** 0-100. */
  readonly feasibilityScore: number
  /** 0-100. */
  readonly potentialScore: number
  readonly tags: readonly string[]
}

/** The discovery stage of one run. */
export interface DiscoverStage {
  readonly status: StageStatus
  readonly engine: DiscoverEngine
  /** The focus the user asked for. */
  readonly topic: string
  /** Source labels the queries targeted. */
  readonly sources: readonly string[]
  /** Search queries actually issued. */
  readonly queries: readonly string[]
  readonly citations: readonly Citation[]
  /** Raw research digest handed to the structuring call. */
  readonly digest: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly error?: string
}

/** The plan stage of one run. */
export interface PlanStage {
  readonly status: StageStatus
  /** When the current attempt started; absent once the stage leaves `running`. */
  readonly startedAt?: string
  /** Which idea the model picked. */
  readonly chosenIdeaId?: string
  readonly decisionReason: string
  /** Named 0-100 scores; `total` is always present once ready. */
  readonly scores: Readonly<Record<string, number>>
  readonly productPlan: Readonly<Record<string, unknown>>
  readonly designPlan: Readonly<Record<string, unknown>>
  readonly technicalPlan: Readonly<Record<string, unknown>>
  /** Human-readable plan document. */
  readonly markdown: string
  /** The prompt handed to the coding agent. */
  readonly executionPrompt: string
  readonly approvedAt?: string
  readonly error?: string
}

/** One timestamped stage note, kept with the run so the UI needs no log files. */
export interface RunLogEntry {
  readonly at: string
  readonly stage: 'discover' | 'plan' | 'build' | 'result'
  readonly message: string
}

/** Host-side watch of dsh's build work, recorded after a handoff. */
export type BuildWatchStatus = 'waiting' | 'active' | 'done'

/**
 * What the workspace watcher saw after the build prompt reached the
 * conversation: the project directory appearing (`active`) and the completion
 * marker the build prompt asks dsh to write (`done`, with its summary).
 */
export interface BuildWatch {
  readonly status: BuildWatchStatus
  /** When watching began — effectively the handoff time. */
  readonly startedAt: string
  /** When the project directory first appeared on disk. */
  readonly projectSeenAt?: string
  /** When the completion marker was read. */
  readonly completedAt?: string
  /** dsh's one-line completion summary, from the marker file. */
  readonly summary?: string
}

/**
 * One full pipeline run: discovery through handoff.
 *
 * `schemaVersion` is written on every new document and optional only so files
 * from before it existed still read; a missing value means version 1.
 */
export interface Run {
  readonly id: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly schemaVersion?: number
  /** Short display label, derived from the topic or the chosen idea. */
  readonly label: string
  readonly discover: DiscoverStage
  readonly ideas: readonly Idea[]
  /** The user's preferred candidate, if they pinned one before planning. */
  readonly preferredIdeaId?: string
  readonly plan: PlanStage
  /** When the build prompt reached the conversation. */
  readonly handoffAt?: string
  /**
   * Directory name (relative to the workspace root) where this run's project
   * lives, decided when the plan was generated. Absent on runs planned before
   * the field existed; the result stage then locates the project on disk.
   */
  readonly projectDir?: string
  /** Post-handoff build watch state; absent until the first handoff under it. */
  readonly build?: BuildWatch
  readonly log: readonly RunLogEntry[]
}

/** Row shown in the history list; the full document loads on demand. */
export interface RunSummary {
  readonly id: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly label: string
  readonly discoverStatus: StageStatus
  readonly ideaCount: number
  readonly planStatus: StageStatus
  readonly approved: boolean
  readonly handedOff: boolean
  readonly buildStatus?: BuildWatchStatus
}

/** Lifecycle of the locally started product. */
export type AppStatus = 'stopped' | 'installing' | 'starting' | 'running' | 'failed'

/** The single locally running product process. */
export interface AppProcess {
  readonly status: AppStatus
  /** Which run produced the code, when known. */
  readonly runId?: string
  readonly workspace: string
  readonly command: string
  readonly url: string
  readonly pid?: number
  readonly startedAt?: string
  /** Tail of combined stdout/stderr. */
  readonly log: string
  readonly error?: string
}

/** Everything the user can tune. Stored as one JSON document. */
export interface Settings {
  /** Domain focus for discovery. */
  readonly topic: string
  /** Source labels discovery queries target. */
  readonly sources: readonly string[]
  readonly engine: DiscoverEngine
  /** Sources requested per search query. */
  readonly maxResults: number
  /** How many candidate ideas the structuring call should return. */
  readonly ideaCount: number
  /** Structuring prompt; `{{digest}}`, `{{sources}}`, `{{today}}`, `{{count}}`. */
  readonly structurePrompt: string
  /** Evaluation prompt; `{{ideas}}`, `{{today}}`. */
  readonly evaluatePrompt: string
  /** Appended verbatim to every generated build prompt. */
  readonly buildInstruction: string
  /**
   * Where the produced app lives: the build prompt instructs the coding agent
   * to create the project here, and the result stage runs commands here.
   */
  readonly workspace: string
  /** Optional dependency install command run before the dev command. */
  readonly installCommand: string
  /** Long-running dev command for the produced app. */
  readonly devCommand: string
  /** Address the user opens once the dev command is up. */
  readonly appUrl: string
  /** `provider/model` override, or empty to follow the dsh default model. */
  readonly modelOverride: string
  /** Tavily API key for the `tavily` discovery engine. */
  readonly tavilyApiKey: string
  /** Fetch the top citations' page text and fold it into the research digest. */
  readonly deepResearch: boolean
}

/** The model this plugin will call, as resolved at request time. */
export interface ModelInfo {
  readonly provider: string
  readonly model: string
  /** True when `Settings.modelOverride` supplied the route. */
  readonly overridden: boolean
}

/** Everything the panel renders. */
export interface Snapshot {
  readonly settings: Settings
  /** True when a Tavily key is stored; `settings.tavilyApiKey` is always masked out. */
  readonly tavilyKeyPresent: boolean
  readonly runs: readonly RunSummary[]
  /** The run the four pipeline tabs render: the selected one, else the newest. */
  readonly activeRun: Run | null
  /** Which run {@link Snapshot.activeRun} holds; null when there is none. */
  readonly activeRunId: string | null
  readonly app: AppProcess
  /** Null when no model route can be resolved (nothing configured). */
  readonly model: ModelInfo | null
  /** False when the composition provides no web search provider. */
  readonly searchAvailable: boolean
}
