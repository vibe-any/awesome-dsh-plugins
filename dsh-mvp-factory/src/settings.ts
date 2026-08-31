/**
 * Settings defaults and the one normalizer every write passes through.
 *
 * A settings document is user-editable JSON on disk, so nothing read from it is
 * trusted: `normalizeSettings` is total, coercing or replacing every field, and
 * is the only way a `Settings` value is produced. That keeps a hand-edited file
 * with a missing key or a string where a number belongs from reaching the
 * pipeline as `undefined`.
 */

import type { DiscoverEngine, Settings } from './types.ts'

/** Structuring prompt. Placeholders are substituted by `renderTemplate`. */
const STRUCTURE_PROMPT = [
  '今天是 {{today}}。你是资深产品分析师。',
  '请把下面的研究材料整理成候选产品创意，只返回 JSON，不要 Markdown 代码块，不要任何解释文字。',
  '',
  '格式：',
  '{',
  '  "ideas": [',
  '    {',
  '      "title": "产品名",',
  '      "summary": "一段话说清它是什么、为什么现在值得做",',
  '      "source": "来源渠道名",',
  '      "sourceUrl": "来源链接",',
  '      "problem": "解决的真实痛点",',
  '      "targetUsers": "目标用户",',
  '      "businessModel": "怎么赚钱",',
  '      "noveltyScore": 0,',
  '      "feasibilityScore": 0,',
  '      "potentialScore": 0,',
  '      "tags": []',
  '    }',
  '  ]',
  '}',
  '',
  '要求：',
  '1) 返回 {{count}} 条 idea',
  '2) 每个 score 取 0-100 的整数',
  '3) 只保留「小团队 2-4 周能做出 MVP 且有商业潜力」的方向',
  '4) sourceUrl 必须来自材料本身，不要编造',
  '',
  '关注渠道：{{sources}}',
  '',
  '研究材料：',
  '{{digest}}',
].join('\n')

/** Evaluation prompt. Placeholders are substituted by `renderTemplate`. */
const EVALUATE_PROMPT = [
  '今天是 {{today}}。你是连续创业者兼产品负责人。',
  '从商业价值、实现难度、差异化、增长杠杆四个角度评估下面的候选创意，选出唯一最佳的一个，并给出可以直接开工的完整计划。',
  '只返回 JSON，不要 Markdown 代码块，不要任何解释文字。',
  '',
  '格式：',
  '{',
  '  "chosenIdeaId": "候选创意的 id",',
  '  "decisionReason": "为什么选它，也说明为什么没选其他的",',
  '  "scores": { "market": 0, "innovation": 0, "distribution": 0, "moat": 0, "buildSpeed": 0, "total": 0 },',
  '  "productPlan": {',
  '    "name": "", "oneLiner": "", "targetUsers": "", "monetization": "",',
  '    "coreFeatures": [""], "mvpScope": [""], "nextMilestones": [""], "goToMarket": [""], "risks": [""]',
  '  },',
  '  "designPlan": {',
  '    "brandDirection": "", "uiStyle": "", "typography": "",',
  '    "colorPalette": [""], "uxFlow": [""], "layoutNotes": [""]',
  '  },',
  '  "technicalPlan": {',
  '    "frontend": "", "backend": "", "database": "",',
  '    "apiContracts": [""], "dataModel": [""], "deliveryChecklist": [""]',
  '  },',
  '  "executionPrompt": ""',
  '}',
  '',
  '补充要求：',
  '- chosenIdeaId 必须精确等于输入里某条 idea 的 id 字段',
  '- 每个 score 取 0-100 的整数',
  '- executionPrompt 是交给编码 agent 的任务书：要含完整背景、技术栈、页面结构、数据模型、API 设计和验收标准，能被直接执行',
  '- 技术栈必须优先选择本地可运行、无需额外外部服务的主流方案：前端用 Next.js / React 或同类主流框架；UI 组件库优先 shadcn/ui（基于 Tailwind CSS + Radix UI，可完全本地复制并自由定制）或 Mantine / Ant Design 等成熟、美观、可控的方案，避免依赖小众、不可控或视觉风格陈旧的库；后端优先 Next.js API Routes、Express 或 Fastify；数据库优先 SQLite（better-sqlite3 / sqlite3）或本地 JSON/文件存储；缓存/队列用本地文件系统或内存，避免 Redis/Kafka/RabbitMQ 等需独立部署的中间件；避免强依赖 Postgres/MySQL/MongoDB 服务端、AWS S3、Firebase、Supabase 等需要注册或联网外部平台的方案',
  '- 认证、支付、文件存储等能力如非创意核心，应在 MVP 中简化或本地模拟，不要引入外部 SaaS 依赖',
  '- technicalPlan 里要写明本地启动所需的依赖安装命令、环境变量（如有）和启动命令，确保在 macOS/Linux 上 `npm install && npm run dev` 能直接跑起来',
  '',
  '候选创意：',
  '{{ideas}}',
].join('\n')

/** Shipped defaults. Every field has a usable value, so a fresh install runs. */
export const DEFAULT_SETTINGS: Settings = {
  topic: 'DeepSeek Harness',
  sources: ['Product Hunt', 'Hacker News', 'Reddit', 'X'],
  engine: 'web-search',
  maxResults: 6,
  ideaCount: 8,
  structurePrompt: STRUCTURE_PROMPT,
  evaluatePrompt: EVALUATE_PROMPT,
  buildInstruction: '实现完整的可运行项目，保持浅色、简洁、有呼吸感的界面，并附带清晰的本地启动说明。',
  workspace: '',
  installCommand: 'npm install',
  devCommand: 'npm run dev',
  appUrl: 'http://127.0.0.1:3000',
  modelOverride: '',
  tavilyApiKey: '',
  deepResearch: false,
}

/** Engines a stored document may name; anything else falls back to the default. */
const ENGINES: readonly DiscoverEngine[] = ['web-search', 'tavily', 'model-only', 'import']

/** Bounds keeping a hand-edited number from producing an absurd request. */
const MAX_RESULTS_RANGE = { min: 1, max: 20 } as const
const IDEA_COUNT_RANGE = { min: 3, max: 20 } as const

/** Coerce one field to a non-empty string, else take the default. */
function text(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : fallback
}

/** Coerce one field to a string that is allowed to be empty. */
function optionalText(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw.trim() : fallback
}

/** Clamp one field into range, else take the default. */
function counted(raw: unknown, fallback: number, range: { min: number; max: number }): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(range.max, Math.max(range.min, Math.round(value)))
}

/** Accept an array of labels or one comma-separated string. */
function labels(raw: unknown, fallback: readonly string[]): readonly string[] {
  const parts = Array.isArray(raw)
    ? raw.map(item => String(item))
    : typeof raw === 'string' ? raw.split(',') : []
  const cleaned = parts.map(item => item.trim()).filter(item => item !== '')
  return cleaned.length === 0 ? fallback : cleaned
}

/**
 * Produce a complete `Settings` from any untrusted shape.
 * @param raw - a parsed settings document, a partial patch, or anything else.
 * @returns every field resolved, coerced, and bounded.
 */
export function normalizeSettings(raw: unknown): Settings {
  const input: Record<string, unknown> = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const engine = ENGINES.find(candidate => candidate === input['engine']) ?? DEFAULT_SETTINGS.engine
  return {
    topic: text(input['topic'], DEFAULT_SETTINGS.topic),
    sources: labels(input['sources'], DEFAULT_SETTINGS.sources),
    engine,
    maxResults: counted(input['maxResults'], DEFAULT_SETTINGS.maxResults, MAX_RESULTS_RANGE),
    ideaCount: counted(input['ideaCount'], DEFAULT_SETTINGS.ideaCount, IDEA_COUNT_RANGE),
    structurePrompt: text(input['structurePrompt'], DEFAULT_SETTINGS.structurePrompt),
    evaluatePrompt: text(input['evaluatePrompt'], DEFAULT_SETTINGS.evaluatePrompt),
    buildInstruction: optionalText(input['buildInstruction'], DEFAULT_SETTINGS.buildInstruction),
    workspace: optionalText(input['workspace'], DEFAULT_SETTINGS.workspace),
    installCommand: optionalText(input['installCommand'], DEFAULT_SETTINGS.installCommand),
    devCommand: optionalText(input['devCommand'], DEFAULT_SETTINGS.devCommand),
    appUrl: optionalText(input['appUrl'], DEFAULT_SETTINGS.appUrl),
    modelOverride: optionalText(input['modelOverride'], DEFAULT_SETTINGS.modelOverride),
    tavilyApiKey: optionalText(input['tavilyApiKey'], DEFAULT_SETTINGS.tavilyApiKey),
    deepResearch: input['deepResearch'] === true,
  }
}

/**
 * Substitute `{{name}}` placeholders. Unknown placeholders are left in place so
 * a typo in a user-edited template is visible in the prompt rather than silently
 * becoming an empty string.
 * @param template - the prompt template.
 * @param values - replacement text per placeholder name.
 * @returns the rendered prompt.
 */
export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole)
}

/**
 * Split a `provider/model` override into a route.
 * @param override - the settings value; empty means "follow the dsh default".
 * @returns the route, or undefined when unset or malformed.
 */
export function parseModelOverride(override: string): { provider: string; model: string } | undefined {
  const separator = override.indexOf('/')
  if (separator <= 0 || separator === override.length - 1) return undefined
  const provider = override.slice(0, separator).trim()
  const model = override.slice(separator + 1).trim()
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/**
 * Reduce a product name to a safe directory name: filesystem-hostile
 * characters become dashes; CJK characters are kept (valid on macOS and
 * Linux, and product names are usually not ASCII).
 * @param name - the raw name (a product title, typically Chinese).
 * @returns the cleaned name, or '' when nothing survived.
 */
export function sanitizeDirName(name: string): string {
  return name
    .trim()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

/**
 * The one-line instruction that pins the generated project to a directory under
 * the configured workspace root. The coding agent writes wherever the receiving
 * conversation's working directory points — it cannot know the plugin's
 * settings — so the build prompt must carry the location explicitly. The
 * project is a subdirectory of the root, named after the chosen product, so
 * successive runs collect alongside each other and the result stage can enter
 * the right one automatically.
 *
 * Shared by both halves: the host appends it to every generated brief, and the
 * browser offers it as a one-click patch for briefs planned before a workspace
 * was configured.
 * @param workspace - the configured workspace root; empty disables the directive.
 * @param projectDir - directory name under the root; omitted means the root itself.
 * @returns the directive text, or '' when there is no workspace to name.
 */
export function workspaceDirective(workspace: string, projectDir?: string | undefined): string {
  const root = workspace.trim()
  if (root === '') return ''
  const target = projectDir !== undefined && projectDir !== '' ? `${root}/${projectDir}` : root
  return [
    `产物位置：把项目创建在 ${target} 目录下（目录不存在就先创建它），以该目录为项目根，所有源码、配置与文档都放在里面；不要把项目写进当前会话的工作目录或其他位置。`,
    `完成回执：全部工作完成后，在项目根目录下创建文件 .mvp-factory/build-done.json，内容形如 {"summary": "<一句话总结完成了什么>"}；未完成前不要创建它，创建后不要改动。mvp-factory 插件靠这个文件感知构建完成。`,
  ].join('\n')
}
