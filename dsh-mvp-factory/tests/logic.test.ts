/**
 * Unit tests for the pure logic: settings coercion, JSON recovery from model
 * output, id validation, and the two parsers that turn model responses into
 * pipeline values.
 *
 * Only `.ts` modules are imported. Node's type stripping does not compile JSX, so
 * the `.tsx` surfaces are covered by the browser check in the README instead.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildQueries, htmlToText, parseIdeas } from '../src/discover.ts'
import { generateText, type LlmLike } from '../src/harness.ts'
import { asScore, asTextList, parseJsonLoose } from '../src/json.ts'
import { buildPlanMarkdown, fallbackExecutionPrompt, IDLE_PLAN, runPlan } from '../src/planner.ts'
import { FactoryService } from '../src/service.ts'
import { DEFAULT_SETTINGS, normalizeSettings, parseModelOverride, renderTemplate, sanitizeDirName, workspaceDirective } from '../src/settings.ts'
import { FactoryStore, isRunId, newRunId, summarize } from '../src/store.ts'
import type { Idea, Run } from '../src/types.ts'

test('normalizeSettings fills every field from an empty document', () => {
  const settings = normalizeSettings(undefined)
  assert.deepEqual(settings, DEFAULT_SETTINGS)
})

test('normalizeSettings coerces and bounds hand-edited values', () => {
  const settings = normalizeSettings({
    sources: 'Product Hunt, , Reddit ',
    maxResults: '99',
    ideaCount: 0,
    engine: 'nonsense',
    workspace: '  /tmp/app  ',
  })
  assert.deepEqual(settings.sources, ['Product Hunt', 'Reddit'])
  assert.equal(settings.maxResults, 20, 'clamped to the upper bound')
  assert.equal(settings.ideaCount, 3, 'clamped to the lower bound')
  assert.equal(settings.engine, 'web-search', 'unknown engine falls back to the default')
  assert.equal(settings.workspace, '/tmp/app', 'trimmed')
})

test('normalizeSettings keeps an empty workspace empty rather than defaulting it', () => {
  assert.equal(normalizeSettings({ workspace: '   ' }).workspace, '')
})

test('normalizeSettings treats deepResearch as a strict boolean flag', () => {
  assert.equal(normalizeSettings({ deepResearch: true }).deepResearch, true)
  assert.equal(normalizeSettings({ deepResearch: 'yes' }).deepResearch, false)
  assert.equal(normalizeSettings(undefined).deepResearch, false)
})

test('htmlToText strips markup and collapses whitespace', () => {
  const text = htmlToText('<html><script>evil()</script><style>.x{}</style><body><h1>Title</h1> <p>Hello&nbsp;&amp; world</p></body></html>')
  assert.equal(text, 'Title Hello & world')
})

test('renderTemplate substitutes known placeholders and leaves typos visible', () => {
  const rendered = renderTemplate('a {{one}} b {{typo}}', { one: 'X' })
  assert.equal(rendered, 'a X b {{typo}}')
})

test('parseModelOverride accepts provider/model and rejects partial input', () => {
  assert.deepEqual(parseModelOverride('deepseek-official/deepseek-v4'), {
    provider: 'deepseek-official',
    model: 'deepseek-v4',
  })
  for (const bad of ['', 'no-slash', '/model', 'provider/', ' / ']) {
    assert.equal(parseModelOverride(bad), undefined, `should reject ${JSON.stringify(bad)}`)
  }
})

test('parseJsonLoose recovers JSON from bare, fenced, and prose-wrapped output', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 })
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonLoose('Sure! Here it is:\n{"a":1}\nHope that helps.'), { a: 1 })
  assert.deepEqual(parseJsonLoose('[1,2]'), [1, 2])
})

test('parseJsonLoose does not end the scan on a brace inside a string', () => {
  assert.deepEqual(parseJsonLoose('prefix {"a":"}"} suffix'), { a: '}' })
})

test('parseJsonLoose returns undefined when nothing parses', () => {
  assert.equal(parseJsonLoose('not json at all'), undefined)
  assert.equal(parseJsonLoose(''), undefined)
})

test('asScore clamps to 0-100 integers and rejects junk', () => {
  assert.equal(asScore(150), 100)
  assert.equal(asScore(-4), 0)
  assert.equal(asScore('72'), 72)
  assert.equal(asScore(71.6), 72)
  assert.equal(asScore('abc'), 0)
  assert.equal(asScore(null), 0)
})

test('asTextList drops blanks and honours the limit', () => {
  assert.deepEqual(asTextList(['a', '', ' b ', 'c'], 2), ['a', 'b'])
  assert.deepEqual(asTextList('not an array'), [])
})

test('buildQueries makes one query per source and still works with none', () => {
  assert.deepEqual(buildQueries('AI 工具', ['Product Hunt', 'Reddit']), [
    'Product Hunt 最新热门产品 AI 工具',
    'Reddit 最新热门产品 AI 工具',
  ])
  assert.equal(buildQueries('AI 工具', []).length, 1)
  assert.match(buildQueries('   ', []).join(''), /新产品/, 'a blank topic still yields a usable query')
})

test('parseIdeas assigns stable ids and ranks, and honours the limit', () => {
  const ideas = parseIdeas(JSON.stringify({
    ideas: [
      { title: 'One', summary: 's1', noveltyScore: 80, feasibilityScore: 60, potentialScore: 90 },
      { title: 'Two', summary: 's2', noveltyScore: 40, feasibilityScore: 20 },
      { title: 'Three' },
    ],
  }), 2)
  assert.equal(ideas.length, 2)
  assert.deepEqual(ideas.map(idea => idea.id), ['i1', 'i2'])
  assert.deepEqual(ideas.map(idea => idea.rank), [1, 2])
  assert.equal(ideas[0]?.potentialScore, 90)
  assert.equal(ideas[1]?.potentialScore, 30, 'a missing composite score is derived from the other two')
})

test('parseIdeas skips entries without a title and tolerates unusable output', () => {
  assert.deepEqual(parseIdeas(JSON.stringify({ ideas: [{ summary: 'no title' }] }), 5), [])
  assert.deepEqual(parseIdeas('garbage', 5), [])
})

test('parseIdeas accepts a bare array as well as an ideas object', () => {
  const ideas = parseIdeas('[{"title":"Solo"}]', 5)
  assert.equal(ideas.length, 1)
  assert.equal(ideas[0]?.title, 'Solo')
})

/** A minimal idea for the plan builders. */
const IDEA: Idea = {
  id: 'i1',
  rank: 1,
  title: 'Title',
  summary: 'Summary',
  source: 'Product Hunt',
  sourceUrl: 'https://example.com/x',
  problem: 'Problem',
  targetUsers: 'Users',
  businessModel: 'Subs',
  noveltyScore: 70,
  feasibilityScore: 80,
  potentialScore: 75,
  tags: ['ai'],
}

test('buildPlanMarkdown titles from the product name and includes every section', () => {
  const markdown = buildPlanMarkdown(IDEA, {
    decisionReason: 'because',
    scores: { total: 88 },
    productPlan: { name: 'Widget', coreFeatures: ['f1', 'f2'] },
    designPlan: { uiStyle: 'clean' },
    technicalPlan: { frontend: 'react' },
  })
  assert.match(markdown, /^# Widget/)
  assert.match(markdown, /## 为什么选它/)
  assert.match(markdown, /- total: 88/)
  assert.match(markdown, /- f1/)
  assert.match(markdown, /## 技术计划/)
})

test('buildPlanMarkdown falls back to the idea title when the plan has no name', () => {
  const markdown = buildPlanMarkdown(IDEA, {
    decisionReason: '',
    scores: {},
    productPlan: {},
    designPlan: {},
    technicalPlan: {},
  })
  assert.match(markdown, /^# Title/)
  assert.match(markdown, /（模型未给出理由）/)
})

test('fallbackExecutionPrompt produces a usable brief without a model prompt', () => {
  const prompt = fallbackExecutionPrompt(IDEA, {
    productPlan: { name: 'Widget', oneLiner: 'does things' },
    designPlan: {},
    technicalPlan: {},
  })
  assert.match(prompt, /产品：Widget/)
  assert.match(prompt, /简介：does things/)
  assert.match(prompt, /灵感来源：https:\/\/example\.com\/x/)
  assert.match(prompt, /验收标准/)
})

test('isRunId accepts generated ids and rejects traversal attempts', () => {
  assert.equal(isRunId(newRunId(new Date('2026-08-18T12:00:00'))), true)
  for (const bad of ['', '../etc/passwd', 'run/1', '20260818-120000', '20260818-120000-ABCDEF', 42, null]) {
    assert.equal(isRunId(bad), false, `should reject ${JSON.stringify(bad)}`)
  }
})

test('newRunId sorts chronologically as a string', () => {
  const earlier = newRunId(new Date('2026-08-18T09:00:00'))
  const later = newRunId(new Date('2026-08-18T10:00:00'))
  assert.ok(earlier < later, `${earlier} should sort before ${later}`)
})

test('summarize projects the flags the history list renders', () => {
  const run: Run = {
    id: '20260818-120000-abc123',
    createdAt: '2026-08-18T12:00:00.000Z',
    updatedAt: '2026-08-18T12:05:00.000Z',
    label: 'Widget',
    discover: {
      status: 'ready',
      engine: 'web-search',
      topic: 'AI',
      sources: ['Product Hunt'],
      queries: ['q'],
      citations: [],
      digest: 'd',
    },
    ideas: [IDEA],
    plan: { ...IDLE_PLAN, status: 'ready', approvedAt: '2026-08-18T12:04:00.000Z' },
    log: [],
  }
  assert.deepEqual(summarize(run), {
    id: run.id,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    label: 'Widget',
    discoverStatus: 'ready',
    ideaCount: 1,
    planStatus: 'ready',
    approved: true,
    handedOff: false,
  })
})

/** A fake llm whose stream replays the given chunks. */
function llmReplaying(chunks: ReadonlyArray<{ type: string; text?: string; reason?: { kind: string } }>): LlmLike {
  return {
    async * stream() {
      for (const chunk of chunks) yield chunk
    },
  }
}

test('generateText forwards text deltas to onDelta and joins the full text', async () => {
  const deltas: string[] = []
  const llm = llmReplaying([
    { type: 'text-delta', text: 'He' },
    { type: 'block-end' },
    { type: 'text-delta', text: 'llo' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const text = await generateText(llm, { provider: 'p', model: 'm' }, { prompt: 'x', onDelta: d => { deltas.push(d) } })
  assert.equal(text, 'Hello')
  assert.deepEqual(deltas, ['He', 'llo'])
})

test('runPlan reports streaming progress and still returns a ready plan', async () => {
  const planJson = JSON.stringify({
    chosenIdeaId: 'i1',
    decisionReason: 'r'.repeat(2600),
    scores: { total: 80 },
    productPlan: { name: 'Widget' },
    designPlan: {},
    technicalPlan: {},
    executionPrompt: 'build it',
  })
  const third = Math.ceil(planJson.length / 3)
  const llm = llmReplaying([
    { type: 'text-delta', text: planJson.slice(0, third) },
    { type: 'text-delta', text: planJson.slice(third, 2 * third) },
    { type: 'text-delta', text: planJson.slice(2 * third) },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const updates: number[] = []
  const outcome = await runPlan(
    { llm, route: { provider: 'p', model: 'm' } },
    { settings: normalizeSettings(undefined), ideas: [IDEA], onUpdate: log => { updates.push(log.length) } },
  )
  assert.equal(outcome.plan.status, 'ready')
  assert.equal(outcome.plan.chosenIdeaId, 'i1')
  // Reports arrive after every entry and never shrink.
  assert.ok(updates.length >= 5, `expected several progress reports, got ${updates.length}`)
  assert.deepEqual(updates, [...updates].sort((a, b) => a - b))
  const messages = outcome.log.map(entry => entry.message)
  assert.ok(messages.some(m => m.includes('调用模型')))
  assert.ok(messages.some(m => m.includes('模型开始输出')))
  assert.ok(messages.some(m => m.includes('模型输出中')), 'a >2000-char output crosses a milestone')
  assert.ok(messages.some(m => m.includes('模型输出完成')))
  assert.ok(messages.some(m => m.includes('评估完成')))
})

test('runPlan pins the brief to a project directory under the workspace root', async () => {
  const workspace = '/Users/you/projects'
  const planJson = JSON.stringify({
    chosenIdeaId: 'i1',
    decisionReason: 'because',
    scores: { total: 80 },
    productPlan: {},
    designPlan: {},
    technicalPlan: {},
    executionPrompt: 'build it',
  })
  const llm = llmReplaying([
    { type: 'text-delta', text: planJson },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const settings = { ...normalizeSettings(undefined), workspace }
  const outcome = await runPlan({ llm, route: { provider: 'p', model: 'm' } }, { settings, ideas: [IDEA] })
  assert.equal(outcome.projectDir, 'Title', 'the directory name comes from the chosen product')
  assert.ok(outcome.plan.executionPrompt.includes('产物位置'))
  assert.ok(outcome.plan.executionPrompt.includes(`${workspace}/Title`), 'the brief names the project directory')
  // No workspace configured: no directive, but the directory name is still decided.
  const bare = await runPlan(
    { llm, route: { provider: 'p', model: 'm' } },
    { settings: normalizeSettings(undefined), ideas: [IDEA] },
  )
  assert.equal(bare.plan.executionPrompt.includes('产物位置'), false)
  assert.equal(bare.projectDir, 'Title')
})

test('service.appStart locates the project directory under the workspace root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mvp-run-'))
  const mk = (name: string): void => {
    mkdirSync(join(root, name), { recursive: true })
    writeFileSync(join(root, name, 'package.json'), '{}')
  }
  const store = new FactoryStore({ root: mkdtempSync(join(tmpdir(), 'mvp-run-store-')), maxRunBytes: 1024 * 1024 })
  const service = new FactoryService(store, {
    llm: llmReplaying([]),
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  })
  await store.writeSettings({ workspace: root, installCommand: '', devCommand: 'echo hi', appUrl: 'http://127.0.0.1:1' })
  const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 20) })

  // Empty root: nothing to start.
  const empty = await service.appStart({})
  assert.equal(empty.ok, false)

  // A single child project is entered without needing a run id.
  mk('flowboard')
  const single = await service.appStart({})
  assert.ok(single.ok)
  assert.equal(single.value.workspace, join(root, 'flowboard'))
  await service.appStop()
  await settle()

  // A run that names its own project directory wins over any heuristic.
  const run: Run = {
    id: '20260830-130000-abcdef',
    createdAt: 'x', updatedAt: 'x', label: 'My App',
    projectDir: 'my-app',
    discover: { status: 'ready', engine: 'model-only', topic: 't', sources: [], queries: [], citations: [], digest: 'd' },
    ideas: [IDEA],
    plan: IDLE_PLAN,
    log: [],
  }
  await store.writeRun(run)
  mk('my-app')
  const pinned = await service.appStart({ id: run.id })
  assert.ok(pinned.ok)
  assert.equal(pinned.value.workspace, join(root, 'my-app'))
  await service.appStop()
  await settle()

  // Several projects and no run to disambiguate: refuse instead of guessing.
  mk('second-app')
  const multi = await service.appStart({})
  assert.equal(multi.ok, false)
  if (!multi.ok) assert.equal(multi.code, 'conflict')
  await service.appStop()
})

test('workspaceDirective is empty without a workspace and names the project directory otherwise', () => {
  assert.equal(workspaceDirective('   '), '')
  assert.match(workspaceDirective(' /tmp/app '), /^产物位置：把项目创建在 \/tmp\/app/)
  assert.match(workspaceDirective('/tmp/app', 'flow-board'), /把项目创建在 \/tmp\/app\/flow-board 目录下/)
  assert.match(workspaceDirective('/tmp/app', ''), /把项目创建在 \/tmp\/app 目录下/)
})

test('sanitizeDirName keeps CJK, strips separators, and collapses dashes', () => {
  assert.equal(sanitizeDirName('  AI  周报 助手  '), 'AI-周报-助手')
  assert.equal(sanitizeDirName('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij')
  assert.equal(sanitizeDirName('---x---'), 'x')
  assert.equal(sanitizeDirName('   '), '')
})

test('service.plan persists progress live and never resurrects a deleted run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mvp-plan-'))
  const store = new FactoryStore({ root, maxRunBytes: 1024 * 1024 })
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const llm: LlmLike = {
    async * stream() {
      await gate
      yield { type: 'text-delta', text: JSON.stringify({ chosenIdeaId: 'i1', decisionReason: 'x', scores: { total: 70 }, productPlan: {}, designPlan: {}, technicalPlan: {} }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const service = new FactoryService(store, {
    llm,
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  })
  const run: Run = {
    id: '20260830-120000-abcdef',
    createdAt: 'x', updatedAt: 'x', label: 'L',
    discover: { status: 'ready', engine: 'model-only', topic: 't', sources: [], queries: [], citations: [], digest: 'd' },
    ideas: [IDEA],
    plan: IDLE_PLAN,
    log: [],
  }
  await store.writeRun(run)
  const started = await service.plan({ id: run.id })
  assert.ok(started.ok)
  const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 30) })
  await settle()
  // Progress entries reached the document while the model call is still gated.
  const mid = await store.readRun(run.id)
  assert.ok(mid.ok)
  assert.equal(mid.value.plan.status, 'running')
  assert.ok(mid.value.log.some(entry => entry.message.includes('开始评估')))
  // Deleting mid-flight is respected by every later write.
  await store.removeRun(run.id)
  release()
  await settle()
  assert.equal((await store.listRuns()).length, 0)
})
