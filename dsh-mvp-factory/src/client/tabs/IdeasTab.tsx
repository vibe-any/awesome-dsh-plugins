/**
 * Ideas tab: start a discovery run on the left, read and pin the candidates on
 * the right.
 *
 * The engine selector mirrors what the host can actually do: `web-search` is
 * disabled when the composition reports no search provider, because offering it
 * would only produce a refusal after the click. A running stage can be cancelled
 * and a failed one retried in place, so a bad model call never forces the user
 * back through the form.
 */

import { useState, type ReactNode } from 'react'
import type { FactoryModel, FactoryState } from '../model.ts'
import { CX } from '../styles.ts'
import { Elapsed, Empty, EmptyState, Field, Icon, ScoreBar, Status, urlHost } from '../ui.tsx'
import type { DiscoverEngine, Idea, Run } from '../../types.ts'

/** Labels for the discovery engines. */
const ENGINE_LABELS: ReadonlyArray<{ value: DiscoverEngine; label: string }> = [
  { value: 'web-search', label: '联网搜索（用 dsh 已配置的搜索）' },
  { value: 'tavily', label: 'Tavily 搜索（需 API key）' },
  { value: 'model-only', label: '模型直出（不联网）' },
  { value: 'import', label: '粘贴导入（自己给材料）' },
]

/** One candidate card. */
function IdeaCard(props: {
  readonly idea: Idea
  readonly pinned: boolean
  readonly chosen: boolean
  readonly onPin: () => void
}): ReactNode {
  const { idea } = props
  const [expanded, setExpanded] = useState(false)
  const longSummary = idea.summary.length > 90
  const summary = expanded || !longSummary
    ? idea.summary
    : `${idea.summary.slice(0, 90)}…`
  return (
    <div
      className={`${CX}-card`}
      data-clickable="true"
      data-active={String(props.pinned || props.chosen)}
      role="button"
      tabIndex={0}
      aria-pressed={props.pinned}
      title={props.pinned ? '已指定为优先候选' : '点击指定为优先候选'}
      onClick={props.onPin}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onPin()
        }
      }}
    >
      <div className={`${CX}-card-head`}>
        <span className={`${CX}-chip`}>{idea.rank}</span>
        <span className={`${CX}-card-title`}>{idea.title}</span>
        {props.chosen && <span className={`${CX}-chip`} data-accent="true">已选中</span>}
        <button
          type="button"
          className={`${CX}-pinbtn`}
          data-pinned={String(props.pinned)}
          title={props.pinned ? '取消优先候选' : '指定为优先候选'}
          aria-label={props.pinned ? '取消优先候选' : '指定为优先候选'}
          onClick={event => { event.stopPropagation(); props.onPin() }}
        >
          <Icon name="pin" />
        </button>
      </div>
      {summary !== '' && <div className={`${CX}-card-text`}>{summary}</div>}
      {longSummary && (
        <button type="button" className={`${CX}-expand`} onClick={event => { event.stopPropagation(); setExpanded(value => !value) }}>
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
      <div className={`${CX}-scores`}>
        <ScoreBar label="潜力" value={idea.potentialScore} />
        <ScoreBar label="新颖" value={idea.noveltyScore} />
        <ScoreBar label="可行" value={idea.feasibilityScore} />
      </div>
      {(idea.problem !== '' || idea.targetUsers !== '' || idea.businessModel !== '') && (
        <div className={`${CX}-defs`}>
          {idea.problem !== '' && <div className={`${CX}-def`}><span className={`${CX}-def-term`}>痛点</span><span className={`${CX}-def-desc`}>{idea.problem}</span></div>}
          {idea.targetUsers !== '' && <div className={`${CX}-def`}><span className={`${CX}-def-term`}>用户</span><span className={`${CX}-def-desc`}>{idea.targetUsers}</span></div>}
          {idea.businessModel !== '' && <div className={`${CX}-def`}><span className={`${CX}-def-term`}>模式</span><span className={`${CX}-def-desc`}>{idea.businessModel}</span></div>}
        </div>
      )}
      <div className={`${CX}-meta`}>
        <span className={`${CX}-chip`}>{idea.source}</span>
        {idea.tags.map(tag => <span key={tag} className={`${CX}-chip`}>{tag}</span>)}
        {idea.sourceUrl !== '' && (
          <a
            className={`${CX}-chip ${CX}-chiplink`}
            href={idea.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={idea.sourceUrl}
            onClick={event => { event.stopPropagation() }}
          >
            {urlHost(idea.sourceUrl)}
          </a>
        )}
      </div>
    </div>
  )
}

/** The candidate list, or the reason there is none. */
function Candidates(props: {
  readonly run: Run | null
  readonly pinnedIdeaId: string | undefined
  readonly onPin: (id: string) => void
}): ReactNode {
  const run = props.run
  if (run === null) return null
  if (run.discover.status === 'running') {
    return (
      <div className={`${CX}-card`}>
        <div className={`${CX}-card-head`}>
          <span className={`${CX}-card-title`}>正在检索并结构化…</span>
          <Status status="running" />
        </div>
        <div className={`${CX}-card-text`}>
          通常需要十几秒到一分钟，页面会自动刷新。
          <Elapsed since={run.discover.startedAt} />
        </div>
      </div>
    )
  }
  if (run.discover.status === 'failed') {
    return (
      <div className={`${CX}-err`}>{run.discover.error ?? '检索失败。'}</div>
    )
  }
  if (run.ideas.length === 0) return <Empty>这次检索没有产出候选创意。</Empty>
  return (
    <div className={`${CX}-idea-grid`}>
      {run.ideas.map(idea => (
        <IdeaCard
          key={idea.id}
          idea={idea}
          pinned={props.pinnedIdeaId === idea.id}
          chosen={run.plan.chosenIdeaId === idea.id}
          onPin={() => { props.onPin(idea.id) }}
        />
      ))}
    </div>
  )
}

/**
 * The ideas tab.
 * @param props - shared model and its current state.
 * @returns the tab body.
 */
export function IdeasTab(props: {
  readonly model: FactoryModel
  readonly state: FactoryState
}): ReactNode {
  const { model, state } = props
  const snapshot = state.snapshot
  const run = snapshot?.activeRun ?? null
  const searchAvailable = snapshot?.searchAvailable === true
  const discovering = run?.discover.status === 'running'
  const canPlan = run !== null && run.ideas.length > 0 && run.plan.status !== 'running'
  const noModel = snapshot?.model === null

  return (
    <div className={`${CX}-cols`}>
      <div className={`${CX}-col`} data-narrow="true">
        <Field label="方向" hint="想让模型往哪个领域找机会">
          <input
            className={`${CX}-input`}
            value={state.topicDraft}
            placeholder="例如：AI 工具、开发者工具"
            onChange={event => { model.setDraft({ topic: event.target.value }) }}
          />
        </Field>

        <Field label="检索方式">
          <select
            className={`${CX}-select`}
            value={state.engineDraft}
            onChange={event => { model.setDraft({ engine: event.target.value as DiscoverEngine }) }}
          >
            {ENGINE_LABELS.map(option => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.value === 'web-search' && !searchAvailable}
              >
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {!searchAvailable && state.engineDraft === 'web-search' && (
          <div className={`${CX}-hint`}>
            当前 dsh 组合没有联网搜索 provider，只能用「Tavily」、「模型直出」或「粘贴导入」。
          </div>
        )}

        {state.engineDraft === 'tavily' && (
          <div className={`${CX}-hint`}>
            使用 Tavily 需要在「设置」里填写 Tavily API Key，可前往 https://app.tavily.com/ 注册获取。
          </div>
        )}

        {state.engineDraft === 'import' && (
          <Field label="研究材料" hint="粘贴你收集的笔记或链接，模型会据此结构化">
            <textarea
              className={`${CX}-area`}
              rows={10}
              value={state.notesDraft}
              placeholder="把 Markdown 笔记粘在这里…"
              onChange={event => { model.setDraft({ notes: event.target.value }) }}
            />
          </Field>
        )}

        <div className={`${CX}-bar`}>
          <button
            type="button"
            className={`${CX}-btn`}
            data-variant="primary"
            disabled={state.acting || discovering || noModel || snapshot === null}
            onClick={() => { void model.discover() }}
          >
            {discovering ? '检索中…' : '开始检索'}
          </button>
          <button
            type="button"
            className={`${CX}-btn`}
            disabled={!canPlan || state.acting}
            onClick={() => { void model.plan() }}
            title={state.pinnedIdeaId === undefined ? '让模型自己选最佳创意' : '带上你指定的优先候选'}
          >
            生成计划
          </button>
        </div>

        {noModel && (
          <div className={`${CX}-err`}>
            dsh 还没有配置可用的模型。先去 dsh 的「设置 → 模型」选一个。
          </div>
        )}

        {run !== null && run.discover.status === 'running' && (
          <button
            type="button"
            className={`${CX}-btn`}
            disabled={state.acting}
            onClick={() => { void model.cancel('discover') }}
          >
            取消检索
          </button>
        )}

        {run !== null && run.discover.status === 'failed' && (
          <div className={`${CX}-bar`}>
            <button
              type="button"
              className={`${CX}-btn`}
              disabled={state.acting}
              onClick={() => { void model.retryDiscover() }}
            >
              重试本次检索
            </button>
            <span className={`${CX}-hint`}>用同样的方向和引擎原地重跑</span>
          </div>
        )}

        {run !== null && (
          <div className={`${CX}-card`}>
            <div className={`${CX}-card-head`}>
              <span className={`${CX}-card-title`}>本次检索</span>
              <Status status={run.discover.status} />
            </div>
            <div className={`${CX}-row-sub`}>引擎：{run.discover.engine}</div>
            <div className={`${CX}-row-sub`}>渠道：{run.discover.sources.join('、')}</div>
            <div className={`${CX}-row-sub`}>来源：{run.discover.citations.length} 条</div>
            {run.log.length > 0 && (
              <pre className={`${CX}-pre`} data-log="true">
                {run.log.map(entry => `${entry.at.slice(11, 19)} [${entry.stage}] ${entry.message}`).join('\n')}
              </pre>
            )}
          </div>
        )}
      </div>

      <div className={`${CX}-col`}>
        {run === null && (
          <EmptyState
            title="还没有检索记录"
            hint="在左侧填一个方向，选好检索方式，点「开始检索」。模型会联网找热点并结构化成带评分的候选创意。"
            action={{ label: '开始第一次检索', onClick: () => { void model.discover() }, disabled: state.acting || discovering || noModel || snapshot === null }}
          />
        )}
        <Candidates
          run={run}
          pinnedIdeaId={state.pinnedIdeaId}
          onPin={id => { model.pinIdea(id) }}
        />
      </div>
    </div>
  )
}
