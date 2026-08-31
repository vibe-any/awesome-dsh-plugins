/**
 * Plan tab: the model's pick, its scores, the plan document, and the approval
 * gate.
 *
 * Approval is a deliberate human step, mirroring the stage gate the pipeline is
 * built around: nothing reaches the conversation until someone reads the plan and
 * signs off. Regenerating after approval would silently discard that sign-off,
 * so the button asks for a second click first.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryModel, FactoryState } from '../model.ts'
import { CX } from '../styles.ts'
import { ConfirmButton, downloadText, Elapsed, EmptyState, IconButton, Status } from '../ui.tsx'

/**
 * The plan tab.
 * @param props - shared model and its current state.
 * @returns the tab body.
 */
export function PlanTab(props: {
  readonly model: FactoryModel
  readonly state: FactoryState
}): ReactNode {
  const { model, state } = props
  const [raw, setRaw] = useState(false)
  const run = state.snapshot?.activeRun ?? null

  // While the stage runs, the right column tails the plan-stage log entries.
  // Computed unconditionally so the hooks below keep a stable order across the
  // early returns.
  const entries = run === null ? [] : run.log.filter(entry => entry.stage === 'plan')
  const logText = entries.map(entry => `${entry.at.slice(11, 19)} ${entry.message}`).join('\n')
  const logRef = useRef<HTMLPreElement | null>(null)
  useEffect(() => {
    if (logRef.current !== null) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logText])

  if (run === null) {
    return (
      <EmptyState
        title="还没有检索记录"
        hint="先去「创意」跑一次检索，模型才能评估候选并生成计划。"
        action={{ label: '去检索', onClick: () => { model.setTab('ideas') } }}
      />
    )
  }

  const { plan } = run
  if (plan.status === 'idle') {
    return (
      <EmptyState
        title="这次检索还没有生成计划"
        hint="回到「创意」，选好方向后点「生成计划」。"
        action={{ label: '去创意页', onClick: () => { model.setTab('ideas') } }}
      />
    )
  }
  if (plan.status === 'running') {
    return (
      <div className={`${CX}-cols`}>
        <div className={`${CX}-col`} data-narrow="true">
          <div className={`${CX}-card`}>
            <div className={`${CX}-card-head`}>
              <span className={`${CX}-card-title`}>正在评估候选创意并生成计划…</span>
              <Status status="running" />
            </div>
            <div className={`${CX}-card-text`}>
              右侧是本阶段的执行日志，页面每 2.5 秒自动刷新。
              <Elapsed since={plan.startedAt} />
            </div>
            <div className={`${CX}-bar`} style={{ marginTop: 10 }}>
              <button
                type="button"
                className={`${CX}-btn`}
                disabled={state.acting}
                onClick={() => { void model.cancel('plan') }}
              >
                取消生成
              </button>
            </div>
          </div>
        </div>
        <div className={`${CX}-col`}>
          <div className={`${CX}-bar`}>
            <span className={`${CX}-section`} style={{ margin: 0 }}>执行过程</span>
            <span className={`${CX}-spacer`} />
            <span className={`${CX}-hint`}>{entries.length} 条日志</span>
          </div>
          <pre ref={logRef} className={`${CX}-pre`} data-log="true" data-planlog="true">
            {logText === '' ? '等待第一条日志…' : logText}
          </pre>
        </div>
      </div>
    )
  }
  if (plan.status === 'failed') {
    return (
      <div className={`${CX}-col`}>
        <div className={`${CX}-err`}>{plan.error ?? '计划生成失败。'}</div>
        <div className={`${CX}-bar`}>
          <button
            type="button"
            className={`${CX}-btn`}
            data-variant="primary"
            disabled={state.acting}
            onClick={() => { void model.plan() }}
          >
            重新生成
          </button>
        </div>
      </div>
    )
  }

  const chosen = run.ideas.find(idea => idea.id === plan.chosenIdeaId)
  const approved = plan.approvedAt !== undefined
  const scores = Object.entries(plan.scores)

  return (
    <div className={`${CX}-cols`}>
      <div className={`${CX}-col`} data-narrow="true">
        <div className={`${CX}-card`}>
          <div className={`${CX}-card-head`}>
            <span className={`${CX}-card-title`}>{chosen?.title ?? '已选定方向'}</span>
            <Status status={plan.status} />
          </div>
          {chosen?.summary !== undefined && chosen.summary !== '' && (
            <div className={`${CX}-card-text`}>{chosen.summary}</div>
          )}
          {scores.length > 0 && (
            <div className={`${CX}-meta`}>
              {scores.map(([key, value]) => (
                <span key={key} className={`${CX}-chip`}>{key} {value}</span>
              ))}
            </div>
          )}
        </div>

        {plan.decisionReason !== '' && (
          <div className={`${CX}-card`}>
            <div className={`${CX}-card-title`}>为什么选它</div>
            <div className={`${CX}-card-text`}>{plan.decisionReason}</div>
          </div>
        )}

        <div className={`${CX}-bar`}>
          <button
            type="button"
            className={`${CX}-btn`}
            data-variant="primary"
            disabled={approved || state.acting}
            onClick={() => { void model.approve() }}
          >
            {approved ? '已审批' : '审批通过'}
          </button>
          <ConfirmButton
            label="重新生成"
            confirmLabel={approved ? '确认重生成？将清除审批' : '确认重新生成？'}
            variant={approved ? 'danger' : ''}
            disabled={state.acting}
            onConfirm={() => { void model.plan() }}
          />
          <IconButton name="download" label="下载计划 .md" onClick={() => { downloadText(`计划-${run.label}.md`, plan.markdown) }} />
        </div>
        {approved && (
          <div className={`${CX}-hint`}>已审批，去「行动」把任务书交给 dsh。</div>
        )}
      </div>

      <div className={`${CX}-col`}>
        <div className={`${CX}-bar`}>
          <span className={`${CX}-section`} style={{ margin: 0 }}>计划文档</span>
          <span className={`${CX}-spacer`} />
          <button type="button" className={`${CX}-btn`} onClick={() => { setRaw(value => !value) }}>
            {raw ? '渲染视图' : '原始文本'}
          </button>
        </div>
        {/* The docbox pins the document to the column below its toolbar; the
            stylesheet sizes it to the row (left column or window, whichever is
            taller) and scrolls overflow inside, so the page itself never
            scrolls to follow the document. */}
        <div className={`${CX}-docbox`}>
          {raw
            ? <pre className={`${CX}-pre`} data-doc="true">{plan.markdown}</pre>
            : <div className={`${CX}-md`}><MarkdownText text={plan.markdown} /></div>}
        </div>
      </div>
    </div>
  )
}
