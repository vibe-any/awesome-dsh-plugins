/**
 * History tab: every past run, with one opened in full beside the list.
 *
 * The list rows come from the snapshot's projections; the full document is only
 * fetched when a row is opened, so a long history does not make every poll
 * expensive. Any row can be promoted to the run the pipeline tabs operate on —
 * the tabs are not hardwired to the newest document any more.
 */

import type { ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryModel, FactoryState } from '../model.ts'
import { CX } from '../styles.ts'
import { ConfirmButton, Empty, Status, formatTime, formatRelative } from '../ui.tsx'

/**
 * The history tab.
 * @param props - shared model and its current state.
 * @returns the tab body.
 */
export function HistoryTab(props: {
  readonly model: FactoryModel
  readonly state: FactoryState
}): ReactNode {
  const { model, state } = props
  const runs = state.snapshot?.runs ?? []
  const activeId = state.snapshot?.activeRunId ?? null
  const detail = state.detail

  return (
    <div className={`${CX}-cols`}>
      <div className={`${CX}-col`} data-narrow="true">
        <div className={`${CX}-section`}>全部记录（{runs.length}）</div>
        {runs.length === 0 && <Empty>还没有任何记录。</Empty>}
        <div className={`${CX}-rows`}>
          {runs.map(row => (
            <div
              key={row.id}
              className={`${CX}-card`}
              data-clickable="true"
              data-active={String(detail?.id === row.id || activeId === row.id)}
              role="button"
              tabIndex={0}
              onClick={() => { void model.openDetail(row.id) }}
              onKeyDown={event => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void model.openDetail(row.id)
                }
              }}
            >
              <div className={`${CX}-card-head`}>
                <span className={`${CX}-card-title`}>{row.label}</span>
                {activeId === row.id && <span className={`${CX}-chip`} data-accent="true">当前</span>}
              </div>
              <div className={`${CX}-row-sub`} title={formatTime(row.createdAt)}>{formatRelative(row.createdAt)}</div>
              <div className={`${CX}-meta`}>
                <span className={`${CX}-chip`}>创意 {row.ideaCount}</span>
                {row.approved && <span className={`${CX}-chip`}>已审批</span>}
                {row.handedOff && <span className={`${CX}-chip`}>已开发</span>}
                <Status status={row.planStatus === 'idle' ? row.discoverStatus : row.planStatus} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${CX}-col`}>
        {detail === null && <Empty>点左侧任意一条记录查看详情。</Empty>}
        {detail !== null && (
          <>
            <div className={`${CX}-bar`}>
              <span className={`${CX}-section`} style={{ margin: 0 }}>{detail.label}</span>
              <span className={`${CX}-spacer`} />
              {activeId !== detail.id && (
                <button
                  type="button"
                  className={`${CX}-btn`}
                  disabled={state.acting}
                  onClick={() => { model.setActiveRun(detail.id) }}
                  title="让「创意 / 计划 / 行动 / 结果」四个页签操作这条记录"
                >
                  设为当前
                </button>
              )}
              <ConfirmButton
                label="删除"
                confirmLabel="确认删除？"
                variant="danger"
                disabled={state.acting}
                onConfirm={() => { void model.removeRun(detail.id) }}
              />
            </div>

            <div className={`${CX}-card`}>
              <div className={`${CX}-row-sub`} title={formatTime(detail.createdAt)}>创建于 {formatRelative(detail.createdAt)}</div>
              <div className={`${CX}-row-sub`}>方向：{detail.discover.topic}</div>
              <div className={`${CX}-row-sub`}>引擎：{detail.discover.engine} · 来源 {detail.discover.citations.length} 条</div>
              <div className={`${CX}-meta`}>
                <Status status={detail.discover.status} />
                <span className={`${CX}-chip`}>创意 {detail.ideas.length}</span>
                {detail.plan.status !== 'idle' && <Status status={detail.plan.status} />}
                {detail.handoffAt !== undefined && <span className={`${CX}-chip`}>已交给 dsh</span>}
              </div>
            </div>

            {detail.ideas.length > 0 && (
              <>
                <div className={`${CX}-section`}>候选创意</div>
                <div className={`${CX}-rows`}>
                  {detail.ideas.map(idea => (
                    <div key={idea.id} className={`${CX}-row`}>
                      <div className={`${CX}-row-main`}>
                        <div className={`${CX}-row-title`}>{idea.rank}. {idea.title}</div>
                        <div className={`${CX}-row-sub`}>潜力 {idea.potentialScore} · {idea.source}</div>
                      </div>
                      {detail.plan.chosenIdeaId === idea.id && <span className={`${CX}-chip`}>已选中</span>}
                    </div>
                  ))}
                </div>
              </>
            )}

            {detail.plan.markdown !== '' && (
              <>
                <div className={`${CX}-section`}>计划文档</div>
                <div className={`${CX}-md`}><MarkdownText text={detail.plan.markdown} /></div>
              </>
            )}

            {detail.log.length > 0 && (
              <>
                <div className={`${CX}-section`}>阶段日志</div>
                <pre className={`${CX}-pre`} data-log="true">
                  {detail.log.map(entry => `${entry.at.slice(0, 19).replace('T', ' ')} [${entry.stage}] ${entry.message}`).join('\n')}
                </pre>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
