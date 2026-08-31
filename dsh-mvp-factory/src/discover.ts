/**
 * Discovery stage: gather research material, then have the model turn it into
 * ranked candidate ideas.
 *
 * Three engines share one structuring call, differing only in where the digest
 * comes from: `web-search` asks the profile's configured search provider,
 * `import` uses notes the user pasted, and `model-only` sends no digest at all
 * and lets the model propose from its own knowledge. Keeping the structuring
 * step common is what makes the three interchangeable in the UI.
 */

import { generateText, type LlmLike, type ModelRoute, type WebLike, type WebSourceLike } from './harness.ts'
import { asRecord, asScore, asText, asTextList, parseJsonLoose } from './json.ts'
import { renderTemplate } from './settings.ts'
import type { Citation, DiscoverEngine, DiscoverStage, Idea, RunLogEntry, Settings } from './types.ts'

/** Ceiling on the digest handed to the model, in characters. */
const MAX_DIGEST_CHARS = 24000

/** Ceiling on one source's snippet inside the digest. */
const MAX_SNIPPET_CHARS = 1200

/** How many top citations deep research fetches when the setting is on. */
const DEEP_RESEARCH_PAGES = 3

/** Ceiling on one fetched page's text folded into the digest. */
const MAX_PAGE_CHARS = 4000

/** Tavily Search API endpoint. */
const TAVILY_API_URL = 'https://api.tavily.com/search'

/** One Tavily result item as returned by the API. */
interface TavilyResult {
  readonly title?: string
  readonly url?: string
  readonly content?: string
  readonly raw_content?: string
  readonly score?: number
  readonly published_date?: string
}

/** Tavily Search API response shape. */
interface TavilySearchResponse {
  readonly answer?: string
  readonly results?: readonly TavilyResult[]
  readonly query?: string
  readonly response_time?: string
}

/**
 * Call Tavily Search directly over HTTP.
 * @param query - the search query.
 * @param maxResults - upper bound on returned results.
 * @param apiKey - the Tavily API key.
 * @param signal - optional abort signal.
 * @returns normalized content and sources.
 * @throws {Error} when the key is missing or the API returns a failure.
 */
async function searchTavily(
  query: string,
  maxResults: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ readonly content?: string; readonly sources: readonly WebSourceLike[] }> {
  const trimmedKey = apiKey.trim()
  if (trimmedKey === '') {
    throw new Error('缺少 Tavily API key，请先在「设置」中填写，或到 https://app.tavily.com/ 注册获取。')
  }

  const body = {
    api_key: trimmedKey,
    query,
    max_results: maxResults,
    search_depth: 'advanced' as const,
    include_answer: true,
    include_raw_content: false,
    time_range: 'month' as const,
  }

  let response: Response
  try {
    response = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...signal === undefined ? {} : { signal },
    })
  } catch (error) {
    throw new Error(`Tavily 请求失败：${String(error)}`)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error')
    throw new Error(`Tavily API 错误 (HTTP ${response.status})：${text}`)
  }

  const payload = await response.json() as TavilySearchResponse
  const results = (payload.results ?? []).filter((item): item is TavilyResult & { url: string } => {
    return typeof item.url === 'string' && item.url.length > 0
  })

  const sources: WebSourceLike[] = results.map(item => ({
    url: item.url,
    ...typeof item.title === 'string' && item.title.length > 0 ? { title: item.title } : {},
    ...typeof item.content === 'string' && item.content.length > 0
      ? { snippet: clip(item.content, MAX_SNIPPET_CHARS) }
      : {},
    ...typeof item.published_date === 'string' && item.published_date.length > 0
      ? { publishedAt: item.published_date }
      : {},
  }))

  return {
    ...typeof payload.answer === 'string' && payload.answer.length > 0 ? { content: payload.answer } : {},
    sources,
  }
}

/** Services and route one discovery run needs. */
export interface DiscoverDeps {
  readonly llm: LlmLike
  /** Absent when the composition mounts no web capability. */
  readonly web?: WebLike | undefined
  readonly route: ModelRoute
}

/** What the user asked for. */
export interface DiscoverInput {
  readonly settings: Settings
  /** Overrides `settings.topic` for this run only. */
  readonly topic: string
  /** Engine for this run only. */
  readonly engine: DiscoverEngine
  /** Pasted research material; required by the `import` engine. */
  readonly notes: string
  readonly signal?: AbortSignal
}

/** The stage outcome, ready to be written into a run document. */
export interface DiscoverOutcome {
  readonly discover: DiscoverStage
  readonly ideas: readonly Idea[]
  readonly log: readonly RunLogEntry[]
}

/** Note one stage event. */
function note(log: RunLogEntry[], message: string): void {
  log.push({ at: new Date().toISOString(), stage: 'discover', message })
}

/**
 * Build one search query per source label. Sources stay in the query text
 * rather than becoming a provider-specific site filter, because the seam is
 * provider-neutral and different backends express site restriction differently.
 * @param topic - the domain focus.
 * @param sources - source labels.
 * @returns one query per source.
 */
export function buildQueries(topic: string, sources: readonly string[]): string[] {
  const focus = topic.trim() === '' ? '新产品' : topic.trim()
  if (sources.length === 0) return [`${focus} 最新产品 趋势`]
  return sources.map(source => `${source} 最新热门产品 ${focus}`)
}

/** Shorten one snippet so a single verbose source cannot crowd out the rest. */
function clip(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`
}

/**
 * Reduce fetched HTML to readable text: drop script/style blocks and tags,
 * then collapse whitespace. A crude projection is the point — the digest only
 * needs gist-level material for the structuring call.
 * @param html - raw page markup, or already-plain text.
 * @returns visible text.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Deep research: fetch the top citations' page text and fold each into the
 * digest as its own block. Every failure is skipped, not raised — page text is
 * a bonus over the search snippets, never a requirement.
 * @param web - the host web capability; must expose `fetch`.
 * @param citations - sources collected by the search pass.
 * @param signal - abort signal shared with the whole discovery run.
 * @param log - run log to append progress notes to.
 * @returns one pre-rendered digest block per successfully fetched page.
 */
async function fetchPageExcerpts(
  web: WebLike,
  citations: readonly Citation[],
  signal: AbortSignal | undefined,
  log: RunLogEntry[],
): Promise<string[]> {
  const fetchPage = web.fetch
  if (typeof fetchPage !== 'function') return []
  const seen = new Set<string>()
  const targets: Citation[] = []
  for (const citation of citations) {
    if (targets.length >= DEEP_RESEARCH_PAGES) break
    let host: string
    try {
      host = new URL(citation.url).host
    } catch {
      continue
    }
    if (seen.has(host)) continue
    seen.add(host)
    targets.push(citation)
  }
  const blocks: string[] = []
  for (const target of targets) {
    if (signal?.aborted === true) break
    try {
      const result = await fetchPage({ url: target.url }, signal)
      if (result.statusCode !== 200) {
        note(log, `正文抓取跳过（HTTP ${result.statusCode}）：${target.url}`)
        continue
      }
      const text = clip(htmlToText(result.body.content), MAX_PAGE_CHARS)
      if (text.length < 200) {
        note(log, `正文太短，跳过：${target.url}`)
        continue
      }
      blocks.push(`## 正文摘录：${target.title ?? target.url}\nURL: ${target.url}\n\n${text}`)
      note(log, `正文抓取完成：${target.url}（${text.length} 字符）`)
    } catch (error) {
      note(log, `正文抓取失败：${target.url} — ${String(error)}`)
    }
  }
  return blocks
}

/** Project one search source onto the stored citation shape. */
function toCitation(source: WebSourceLike): Citation {
  return {
    url: source.url,
    ...source.title === undefined ? {} : { title: source.title },
    ...source.snippet === undefined ? {} : { snippet: clip(source.snippet, MAX_SNIPPET_CHARS) },
    ...source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt },
  }
}

/**
 * Render the gathered sources as the digest the structuring prompt embeds.
 * @param answers - provider answer text per query, when the provider returns one.
 * @param citations - every source collected.
 * @param excerpts - deep-research page texts, pre-rendered as digest blocks.
 * @returns the digest text, capped at {@link MAX_DIGEST_CHARS}.
 */
function buildDigest(
  answers: readonly string[],
  citations: readonly Citation[],
  excerpts: readonly string[] = [],
): string {
  const blocks: string[] = []
  answers.forEach((answer, index) => {
    if (answer.trim() === '') return
    blocks.push(`## 检索摘要 ${index + 1}`, answer.trim(), '')
  })
  for (const excerpt of excerpts) {
    if (excerpt.trim() === '') continue
    blocks.push(excerpt, '')
  }
  if (citations.length > 0) {
    blocks.push('## 来源列表', '')
    citations.forEach((citation, index) => {
      blocks.push(`### 来源 ${index + 1}: ${citation.title ?? citation.url}`)
      blocks.push(`- URL: ${citation.url}`)
      if (citation.publishedAt !== undefined) blocks.push(`- 时间: ${citation.publishedAt}`)
      if (citation.snippet !== undefined) blocks.push(`- 摘要: ${citation.snippet}`)
      blocks.push('')
    })
  }
  const digest = blocks.join('\n')
  return digest.length <= MAX_DIGEST_CHARS
    ? digest
    : `${digest.slice(0, MAX_DIGEST_CHARS)}\n\n[材料已截断，原长 ${digest.length} 字符]`
}

/**
 * Turn the model's structuring response into ideas with stable ids.
 * @param raw - the model's raw text.
 * @param limit - how many ideas to keep.
 * @returns the parsed ideas, empty when nothing usable came back.
 */
export function parseIdeas(raw: string, limit: number): Idea[] {
  const parsed = parseJsonLoose(raw)
  const list = Array.isArray(parsed) ? parsed : asRecord(parsed)['ideas']
  if (!Array.isArray(list)) return []
  const ideas: Idea[] = []
  for (const entry of list) {
    const source = asRecord(entry)
    const title = asText(source['title'])
    if (title === '') continue
    const novelty = asScore(source['noveltyScore'])
    const feasibility = asScore(source['feasibilityScore'])
    const potentialRaw = asScore(source['potentialScore'])
    ideas.push({
      id: `i${ideas.length + 1}`,
      rank: ideas.length + 1,
      title,
      summary: asText(source['summary'], asText(source['description'])),
      source: asText(source['source'], 'other'),
      sourceUrl: asText(source['sourceUrl'], asText(source['url'])),
      problem: asText(source['problem']),
      targetUsers: asText(source['targetUsers']),
      businessModel: asText(source['businessModel']),
      noveltyScore: novelty,
      feasibilityScore: feasibility,
      // A model that scored the two inputs but skipped the composite gets one
      // derived, so the list can always sort by potential.
      potentialScore: potentialRaw === 0 ? Math.round(novelty * 0.5 + feasibility * 0.5) : potentialRaw,
      tags: asTextList(source['tags'], 6),
    })
    if (ideas.length >= limit) break
  }
  return ideas
}

/**
 * Run the discovery stage end to end.
 *
 * A stage failure is returned as a `failed` {@link DiscoverStage}, not thrown:
 * the run document records what was attempted and why it stopped, which is what
 * the UI shows the user.
 * @param deps - host services and the model route.
 * @param input - user request for this run.
 * @returns the stage, its ideas, and the notes to append to the run log.
 */
export async function runDiscover(deps: DiscoverDeps, input: DiscoverInput): Promise<DiscoverOutcome> {
  const log: RunLogEntry[] = []
  const startedAt = new Date().toISOString()
  const { settings, engine, topic } = input
  const queries = engine === 'web-search' || engine === 'tavily' ? buildQueries(topic, settings.sources) : []
  const citations: Citation[] = []
  const answers: string[] = []

  const base = {
    engine,
    topic,
    sources: settings.sources,
    queries,
    startedAt,
  } as const

  if (engine === 'web-search') {
    if (deps.web === undefined) {
      note(log, '该组合没有装配联网搜索能力，无法使用 web-search 引擎。')
      return {
        discover: { ...base, status: 'failed', citations, digest: '', finishedAt: new Date().toISOString(), error: '当前 dsh 组合没有可用的联网搜索 provider，请改用「模型直出」或「粘贴导入」。' },
        ideas: [],
        log,
      }
    }
    note(log, `开始联网检索，共 ${queries.length} 条 query。`)
    const failures: string[] = []
    for (const query of queries) {
      try {
        const result = await deps.web.search(
          { query, maxResults: settings.maxResults },
          input.signal,
        )
        if (result.content !== undefined && result.content.trim() !== '') answers.push(result.content)
        for (const source of result.sources) citations.push(toCitation(source))
        note(log, `query 完成：${query}（${result.sources.length} 条来源）`)
      } catch (error) {
        // One provider refusal must not lose the other queries' material; the
        // run only fails when nothing at all came back.
        failures.push(`${query}: ${String(error)}`)
        note(log, `query 失败：${query} — ${String(error)}`)
      }
    }
    if (citations.length === 0 && answers.length === 0) {
      return {
        discover: {
          ...base,
          status: 'failed',
          citations,
          digest: '',
          finishedAt: new Date().toISOString(),
          error: failures.length > 0 ? `联网检索全部失败：${failures.join('; ')}` : '联网检索没有返回任何结果。',
        },
        ideas: [],
        log,
      }
    }
  }

  if (engine === 'tavily') {
    note(log, `开始 Tavily 检索，共 ${queries.length} 条 query。`)
    const failures: string[] = []
    for (const query of queries) {
      try {
        const result = await searchTavily(query, settings.maxResults, settings.tavilyApiKey, input.signal)
        if (result.content !== undefined && result.content.trim() !== '') answers.push(result.content)
        for (const source of result.sources) citations.push(toCitation(source))
        note(log, `query 完成：${query}（${result.sources.length} 条来源）`)
      } catch (error) {
        failures.push(`${query}: ${String(error)}`)
        note(log, `query 失败：${query} — ${String(error)}`)
      }
    }
    if (citations.length === 0 && answers.length === 0) {
      return {
        discover: {
          ...base,
          status: 'failed',
          citations,
          digest: '',
          finishedAt: new Date().toISOString(),
          error: failures.length > 0 ? `Tavily 检索全部失败：${failures.join('; ')}` : 'Tavily 没有返回任何结果。',
        },
        ideas: [],
        log,
      }
    }
  }

  if (engine === 'import' && input.notes.trim() === '') {
    return {
      discover: { ...base, status: 'failed', citations, digest: '', finishedAt: new Date().toISOString(), error: '当前引擎为「粘贴导入」，请先粘贴研究材料。' },
      ideas: [],
      log,
    }
  }

  let excerpts: readonly string[] = []
  if (settings.deepResearch && citations.length > 0 && deps.web !== undefined) {
    note(log, `深度检索开启，抓取前 ${Math.min(DEEP_RESEARCH_PAGES, citations.length)} 条来源正文。`)
    excerpts = await fetchPageExcerpts(deps.web, citations, input.signal, log)
    note(log, `深度检索完成，得到 ${excerpts.length} 段正文摘录。`)
  }

  const digest = engine === 'import'
    ? input.notes.slice(0, MAX_DIGEST_CHARS)
    : engine === 'model-only'
      ? `（无检索材料。请基于你自己的知识，围绕「${topic}」提出候选方向。）`
      : buildDigest(answers, citations, excerpts)

  note(log, `开始结构化，材料 ${digest.length} 字符，目标 ${settings.ideaCount} 条创意。`)

  let ideas: Idea[]
  try {
    const raw = await generateText(deps.llm, deps.route, {
      system: 'You are a strict JSON formatter. Return valid JSON only, with no prose and no code fences.',
      prompt: renderTemplate(settings.structurePrompt, {
        today: new Date().toISOString().slice(0, 10),
        sources: settings.sources.join('、'),
        count: String(settings.ideaCount),
        digest,
      }),
      temperature: 0.2,
      maxTokens: 8000,
      ...input.signal === undefined ? {} : { signal: input.signal },
    })
    ideas = parseIdeas(raw, settings.ideaCount)
    if (ideas.length === 0) {
      return {
        discover: { ...base, status: 'failed', citations, digest, finishedAt: new Date().toISOString(), error: '模型没有返回可解析的创意 JSON，可以在「设置」里调整结构化提示词后重试。' },
        ideas: [],
        log,
      }
    }
  } catch (error) {
    note(log, `结构化失败：${String(error)}`)
    return {
      discover: { ...base, status: 'failed', citations, digest, finishedAt: new Date().toISOString(), error: String(error) },
      ideas: [],
      log,
    }
  }

  note(log, `结构化完成，得到 ${ideas.length} 条候选创意。`)
  return {
    discover: { ...base, status: 'ready', citations, digest, finishedAt: new Date().toISOString() },
    ideas,
    log,
  }
}
