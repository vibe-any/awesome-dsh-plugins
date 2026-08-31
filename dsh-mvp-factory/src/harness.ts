/**
 * The host services this plugin consumes, declared structurally.
 *
 * Nothing here imports a `@deepseek-ai` package. Only members this plugin
 * actually calls are declared, which keeps the package installable against any
 * profile version and avoids pinning a dependency whose published version may
 * differ from the one the target profile resolved. The real signatures live in
 * the harness's `packages/llm/llm/src` and `packages/web/web/src`.
 */

/** One text block inside a message. */
export interface LlmTextBlock {
  readonly type: 'text'
  readonly text: string
}

/** One conversation message, in the harness's immutable message shape. */
export interface LlmMessage {
  readonly id: string
  readonly role: 'user' | 'assistant' | 'system'
  readonly content: readonly LlmTextBlock[]
  readonly source: { readonly kind: 'user' }
}

/**
 * One streamed chunk. Declared as a single open shape rather than a
 * discriminated union: this consumer reads only `text-delta` text and the
 * terminal `finish` reason, and must tolerate every other chunk type the
 * adapters emit (block boundaries, reasoning, usage) without knowing them.
 */
export interface LlmChunk {
  readonly type: string
  readonly text?: string
  readonly reason?: {
    readonly kind: string
    readonly failure?: { readonly message?: string; readonly code?: string }
  }
}

/** A model route: which adapter, which model, and how hard it should think. */
export interface ModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** The `ctx.llm` surface this plugin touches. */
export interface LlmLike {
  stream(options: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
    readonly messages: readonly LlmMessage[]
    readonly system?: string
    readonly temperature?: number
    readonly maxTokens?: number
    readonly signal?: AbortSignal
  }): AsyncIterable<LlmChunk>
}

/** The `ctx.agentDefaultModel` surface this plugin touches. */
export interface AgentDefaultModelLike {
  /** The route new agents get when no session-specific model was chosen. */
  currentSelection(): ModelRoute
}

/** One citeable search source. */
export interface WebSourceLike {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
}

/** One decoded page body, classified by the host's fetch provider. */
export interface WebFetchBodyLike {
  readonly kind: string
  readonly content: string
}

/** The `ctx.web` surface this plugin touches. */
export interface WebLike {
  search(
    request: { readonly query: string; readonly maxResults?: number },
    signal?: AbortSignal,
  ): Promise<{
    readonly content?: string
    readonly sources: readonly WebSourceLike[]
    readonly truncated: boolean
  }>
  /**
   * Optional because a composition may mount search without fetch; callers
   * guard with `typeof === 'function'` and degrade to search-only digests.
   */
  readonly fetch?: (
    request: { readonly url: string },
    signal?: AbortSignal,
  ) => Promise<{
    readonly url: string
    readonly statusCode: number
    readonly body: WebFetchBodyLike
    readonly truncated: boolean
  }>
}

/** One text generation request. */
export interface GenerateRequest {
  /** System prompt; adapters map it to the provider's system slot. */
  readonly system?: string
  /** The single user turn. */
  readonly prompt: string
  readonly temperature?: number
  readonly maxTokens?: number
  readonly signal?: AbortSignal
  /**
   * Streaming tap: called once per visible text delta as it arrives. Callers
   * use it to surface progress while a long generation runs; keep it cheap (a
   * counter, a throttled note) since it fires once per chunk.
   */
  readonly onDelta?: (text: string) => void
}

/** Build the one-turn message list a generation request needs. */
function userTurn(prompt: string): LlmMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  }
}

/**
 * Run one non-streaming text generation over the streaming service.
 *
 * The stream protocol reports adapter failures as a terminal `finish` chunk
 * rather than a throw, so a failed call would otherwise look like an empty
 * success. Both terminal failure kinds are converted to a throw here, which is
 * what every caller in this plugin is written against.
 * @param llm - the host's llm service.
 * @param route - provider, model, and optional reasoning effort.
 * @param request - system prompt, user prompt, and generation controls.
 * @returns the concatenated visible text.
 * @throws {Error} when the adapter reports an error or the call is aborted.
 */
export async function generateText(
  llm: LlmLike,
  route: ModelRoute,
  request: GenerateRequest,
): Promise<string> {
  const stream = llm.stream({
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
    messages: [userTurn(request.prompt)],
    ...request.system === undefined ? {} : { system: request.system },
    ...request.temperature === undefined ? {} : { temperature: request.temperature },
    ...request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens },
    ...request.signal === undefined ? {} : { signal: request.signal },
  })

  const parts: string[] = []
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      parts.push(chunk.text)
      request.onDelta?.(chunk.text)
      continue
    }
    if (chunk.type !== 'finish') continue
    const reason = chunk.reason
    if (reason === undefined) continue
    if (reason.kind === 'error' || reason.kind === 'aborted') {
      const failure = reason.failure
      const detail = failure?.message ?? failure?.code ?? reason.kind
      throw new Error(`model call ${reason.kind}: ${detail}`)
    }
  }

  const text = parts.join('')
  if (text.trim() === '') throw new Error('the model returned no text')
  return text
}
