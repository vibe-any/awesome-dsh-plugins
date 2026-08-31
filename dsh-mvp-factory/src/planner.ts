/**
 * Plan stage: score the candidates, pick one, and produce both a human-readable
 * plan document and the build prompt handed to the coding agent.
 *
 * The model is asked for the build prompt too, because it has the full plan in
 * context. When it omits one, `fallbackExecutionPrompt` assembles an equivalent
 * brief from the structured fields rather than leaving the build stage with
 * nothing to hand over.
 */

import { generateText, type LlmLike, type ModelRoute } from './harness.ts'
import { asRecord, asScore, asText, asTextList, parseJsonLoose } from './json.ts'
import { renderTemplate, sanitizeDirName, workspaceDirective } from './settings.ts'
import type { Idea, PlanStage, RunLogEntry, Settings } from './types.ts'

/** Services and route one plan run needs. */
export interface PlanDeps {
  readonly llm: LlmLike
  readonly route: ModelRoute
}

/** What to plan over. */
export interface PlanInput {
  readonly settings: Settings
  readonly ideas: readonly Idea[]
  /** The candidate the user pinned, if any; the model may still argue against it. */
  readonly preferredIdeaId?: string | undefined
  readonly signal?: AbortSignal
  /**
   * Progress tap: called after every new plan-stage log entry, including
   * streaming milestones from inside the model call. The array is owned by
   * `runPlan` — treat it as read-only and consume it synchronously; persistence
   * cadence is the caller's decision (the service throttles writes).
   */
  readonly onUpdate?: ((log: readonly RunLogEntry[]) => void) | undefined
}

/** The stage outcome, ready to be written into a run document. */
export interface PlanOutcome {
  readonly plan: PlanStage
  /** Directory name under the workspace root where the project should live. */
  readonly projectDir: string
  readonly log: readonly RunLogEntry[]
}

/**
 * Emit a `模型输出中…` log entry after every this many received characters, so
 * a long generation keeps the progress log moving without one entry per chunk.
 */
const CHAR_MILESTONE = 2000

/** An empty plan stage, used as the initial value and after a reset. */
export const IDLE_PLAN: PlanStage = {
  status: 'idle',
  decisionReason: '',
  scores: {},
  productPlan: {},
  designPlan: {},
  technicalPlan: {},
  markdown: '',
  executionPrompt: '',
}

/** Note one stage event. */
function note(log: RunLogEntry[], message: string): void {
  log.push({ at: new Date().toISOString(), stage: 'plan', message })
}

/** Coerce every value in the model's score object, and derive `total` if absent. */
function normalizeScores(raw: unknown): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRecord(raw))) scores[key] = asScore(value)
  if (scores['total'] === undefined) {
    const values = Object.values(scores)
    scores['total'] = values.length === 0
      ? 0
      : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  }
  return scores
}

/** Render one labelled bullet list, or nothing when the field is empty. */
function bullets(title: string, value: unknown): string[] {
  const items = asTextList(value, 20)
  if (items.length === 0) return []
  return [`**${title}**`, ...items.map(item => `- ${item}`), '']
}

/** Render one labelled single-line field, or nothing when empty. */
function line(title: string, value: unknown): string[] {
  const text = asText(value)
  return text === '' ? [] : [`- **${title}**: ${text}`]
}

/**
 * Assemble the plan document the UI renders.
 * @param idea - the chosen candidate.
 * @param plan - the parsed plan fields.
 * @returns Markdown.
 */
export function buildPlanMarkdown(
  idea: Idea,
  plan: {
    readonly decisionReason: string
    readonly scores: Readonly<Record<string, number>>
    readonly productPlan: Readonly<Record<string, unknown>>
    readonly designPlan: Readonly<Record<string, unknown>>
    readonly technicalPlan: Readonly<Record<string, unknown>>
  },
): string {
  const { productPlan: product, designPlan: design, technicalPlan: technical } = plan
  return [
    `# ${asText(product['name'], idea.title)}`,
    '',
    '## 为什么选它',
    plan.decisionReason === '' ? '（模型未给出理由）' : plan.decisionReason,
    '',
    '## 评分',
    ...Object.entries(plan.scores).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## 产品计划',
    ...line('一句话', product['oneLiner']),
    ...line('目标用户', product['targetUsers'] ?? idea.targetUsers),
    ...line('商业模式', product['monetization'] ?? idea.businessModel),
    '',
    ...bullets('核心功能', product['coreFeatures']),
    ...bullets('MVP 范围', product['mvpScope']),
    ...bullets('后续里程碑', product['nextMilestones']),
    ...bullets('增长路径', product['goToMarket']),
    ...bullets('风险', product['risks']),
    '## 设计计划',
    ...line('品牌方向', design['brandDirection']),
    ...line('界面风格', design['uiStyle']),
    ...line('字体', design['typography']),
    '',
    ...bullets('配色', design['colorPalette']),
    ...bullets('交互流程', design['uxFlow']),
    ...bullets('布局要点', design['layoutNotes']),
    '## 技术计划',
    ...line('前端', technical['frontend']),
    ...line('后端', technical['backend']),
    ...line('数据库', technical['database']),
    '',
    ...bullets('API 契约', technical['apiContracts']),
    ...bullets('数据模型', technical['dataModel']),
    ...bullets('交付清单', technical['deliveryChecklist']),
  ].join('\n')
}

/**
 * Assemble a build prompt from the structured plan, for when the model returned
 * none. Everything a coding agent needs is already in those fields, so this is a
 * reformat rather than a second model call.
 * @param idea - the chosen candidate.
 * @param plan - the parsed plan fields.
 * @returns the build prompt.
 */
export function fallbackExecutionPrompt(
  idea: Idea,
  plan: {
    readonly productPlan: Readonly<Record<string, unknown>>
    readonly designPlan: Readonly<Record<string, unknown>>
    readonly technicalPlan: Readonly<Record<string, unknown>>
  },
): string {
  return [
    '请按下面的计划实现一个可以本地运行的 MVP。',
    '',
    `产品：${asText(plan.productPlan['name'], idea.title)}`,
    `简介：${asText(plan.productPlan['oneLiner'], idea.summary)}`,
    idea.sourceUrl === '' ? '' : `灵感来源：${idea.sourceUrl}`,
    '',
    '产品计划：',
    JSON.stringify(plan.productPlan, null, 2),
    '',
    '设计计划：',
    JSON.stringify(plan.designPlan, null, 2),
    '',
    '技术计划：',
    JSON.stringify(plan.technicalPlan, null, 2),
    '',
    '验收标准：',
    '- 有明确的本地启动命令，且能一次跑通',
    '- 核心流程可用，不留占位实现',
    '- API 与数据结构在 README 中写清',
  ].filter(entry => entry !== '').join('\n')
}

/** The candidate fields the evaluation prompt embeds. */
function ideasForPrompt(ideas: readonly Idea[]): string {
  return JSON.stringify(
    ideas.map(idea => ({
      id: idea.id,
      title: idea.title,
      summary: idea.summary,
      source: idea.source,
      sourceUrl: idea.sourceUrl,
      problem: idea.problem,
      targetUsers: idea.targetUsers,
      businessModel: idea.businessModel,
      noveltyScore: idea.noveltyScore,
      feasibilityScore: idea.feasibilityScore,
      potentialScore: idea.potentialScore,
      tags: idea.tags,
    })),
    null,
    2,
  )
}

/**
 * Run the plan stage.
 *
 * Like discovery, a failure is a `failed` stage rather than a throw, so the run
 * document explains itself in the UI.
 * @param deps - host services and the model route.
 * @param input - candidates and the user's preference.
 * @returns the stage and the notes to append to the run log.
 */
export async function runPlan(deps: PlanDeps, input: PlanInput): Promise<PlanOutcome> {
  const log: RunLogEntry[] = []
  const report = (): void => { input.onUpdate?.(log) }
  /** Note one stage event and push it to the progress tap. */
  const progress = (message: string): void => {
    note(log, message)
    report()
  }
  const { settings, ideas } = input
  if (ideas.length === 0) {
    progress('这次检索没有候选创意，无法生成计划。')
    return { plan: { ...IDLE_PLAN, status: 'failed', error: '这次检索没有候选创意，无法生成计划。' }, projectDir: '', log }
  }

  const preference = input.preferredIdeaId === undefined
    ? ''
    : `\n\n用户人工优先的候选 id 是 ${input.preferredIdeaId}。如果它不是最佳选择，请在 decisionReason 里说明为什么。`
  const prompt = `${renderTemplate(settings.evaluatePrompt, {
    today: new Date().toISOString().slice(0, 10),
    ideas: ideasForPrompt(ideas),
  })}${preference}`

  progress(`开始评估 ${ideas.length} 条候选创意。`)
  progress(`调用模型 ${deps.route.provider}/${deps.route.model} 评估并生成计划…`)

  let raw: string
  try {
    let received = 0
    let milestone = CHAR_MILESTONE
    let firstDelta = true
    const callStart = Date.now()
    raw = await generateText(deps.llm, deps.route, {
      system: 'You are a principal product strategist. Return valid JSON only, with no prose and no code fences.',
      prompt,
      temperature: 0.35,
      maxTokens: 8000,
      ...input.signal === undefined ? {} : { signal: input.signal },
      onDelta: (text) => {
        received += text.length
        if (firstDelta) {
          firstDelta = false
          progress('模型开始输出。')
        }
        if (received >= milestone) {
          milestone += CHAR_MILESTONE
          progress(`模型输出中… ${received} 字符`)
        }
      },
    })
    const seconds = Math.max(1, Math.round((Date.now() - callStart) / 1000))
    progress(`模型输出完成，共 ${received} 字符，用时 ${seconds} 秒。`)
  } catch (error) {
    progress(`评估失败：${String(error)}`)
    return { plan: { ...IDLE_PLAN, status: 'failed', error: String(error) }, projectDir: '', log }
  }

  const parsed = asRecord(parseJsonLoose(raw))
  if (Object.keys(parsed).length === 0) {
    progress('模型没有返回可解析的计划 JSON，可以在「设置」里调整评估提示词后重试。')
    return {
      plan: { ...IDLE_PLAN, status: 'failed', error: '模型没有返回可解析的计划 JSON，可以在「设置」里调整评估提示词后重试。' },
      projectDir: '',
      log,
    }
  }

  // The model's pick wins when it names a real candidate; otherwise fall back to
  // the user's preference, then to the highest-potential idea. `ideas[0]` cannot
  // be undefined here — the empty case returned above — but the index signature
  // still needs narrowing.
  const chosenId = asText(parsed['chosenIdeaId'])
  const byPotential = [...ideas].sort((a, b) => b.potentialScore - a.potentialScore)
  const chosen = ideas.find(idea => idea.id === chosenId)
    ?? ideas.find(idea => idea.id === input.preferredIdeaId)
    ?? byPotential[0]
  if (chosen === undefined) {
    progress('无法确定被选中的创意。')
    return { plan: { ...IDLE_PLAN, status: 'failed', error: '无法确定被选中的创意。' }, projectDir: '', log }
  }

  const fields = {
    decisionReason: asText(parsed['decisionReason']),
    scores: normalizeScores(parsed['scores'] ?? parsed['scoreBreakdown']),
    productPlan: asRecord(parsed['productPlan']),
    designPlan: asRecord(parsed['designPlan']),
    technicalPlan: asRecord(parsed['technicalPlan']),
  }
  // The project collects under the workspace root, named after the chosen
  // product, so successive runs sit beside each other and the result stage can
  // enter this run's directory without the user reconfiguring anything.
  const projectDir = sanitizeDirName(chosen.title) || 'mvp-app'
  const modelPrompt = asText(parsed['executionPrompt'] ?? parsed['codexExecutionPrompt'])
  const body = modelPrompt === '' ? fallbackExecutionPrompt(chosen, fields) : modelPrompt
  // The workspace directive rides every brief: the coding agent writes into the
  // receiving conversation's working directory unless the prompt names the
  // location, so an empty prompt suffix would scatter projects across sessions.
  const directives = [
    workspaceDirective(settings.workspace, projectDir),
    settings.buildInstruction === '' ? undefined : `附加要求：\n${settings.buildInstruction}`,
  ].filter((entry): entry is string => entry !== undefined)
  const executionPrompt = directives.length === 0 ? body : `${body}\n\n${directives.join('\n\n')}`

  progress(`评估完成，选定「${chosen.title}」（总分 ${fields.scores['total'] ?? 0}），已生成计划文档与任务书。`)

  return {
    plan: {
      status: 'ready',
      chosenIdeaId: chosen.id,
      ...fields,
      markdown: buildPlanMarkdown(chosen, fields),
      executionPrompt,
    },
    projectDir,
    log,
  }
}
