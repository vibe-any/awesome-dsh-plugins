/**
 * Build tab: hand the approved plan to dsh itself.
 *
 * The original pipeline spawned an external coding CLI here. Inside dsh that
 * detour is unnecessary — dsh *is* the coding agent — so the build step places
 * the task brief in the composer and the user sends it. That also means the build
 * runs with whatever tools, permissions, and workspace the session already has.
 *
 * The brief is editable before it goes out: the edit is saved onto the run
 * document, so what the handoff records is exactly what was sent. The button
 * needs an open session: only a session-scoped surface can write the composer
 * draft, so with no conversation open there is nothing to write into and the tab
 * says so rather than silently dropping the text.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryModel, FactoryState } from '../model.ts'
import { CX } from '../styles.ts'
import { workspaceDirective, sanitizeDirName } from '../../settings.ts'
import { downloadText, EmptyState, formatTime, Icon } from '../ui.tsx'

/**
 * The build tab.
 * @param props - shared model and its current state.
 * @returns the tab body.
 */
export function BuildTab(props: {
  readonly model: FactoryModel
  readonly state: FactoryState
}): ReactNode {
  const { model, state } = props
  const run = state.snapshot?.activeRun ?? null
  const prompt = run?.plan.status === 'ready' ? run.plan.executionPrompt : ''
  const workspace = state.snapshot?.settings.workspace.trim() ?? ''
  // Briefs planned before a workspace was configured (or with it cleared) name
  // no location, and the coding agent then writes into whatever directory the
  // receiving session happens to have open. Say so instead of letting the
  // project land somewhere surprising.
  const missingWorkspace = prompt !== '' && workspace !== '' && !prompt.includes(workspace)

  // The edit draft re-seeds whenever the run (or its stored brief) changes and
  // the user is not mid-edit.
  const [draft, setDraft] = useState(prompt)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!editing) setDraft(prompt) }, [prompt, editing])

  if (run === null) {
    return (
      <EmptyState
        title="还没有检索记录"
        hint="先去「创意」跑一次检索并完成计划审批，这里才能把任务书交给 dsh。"
        action={{ label: '去创意页', onClick: () => { model.setTab('ideas') } }}
      />
    )
  }
  if (run.plan.status !== 'ready') {
    return (
      <EmptyState
        title="计划还没生成完成"
        hint="先去「计划」看看当前进度。"
        action={{ label: '去计划页', onClick: () => { model.setTab('plan') } }}
      />
    )
  }
  if (run.plan.approvedAt === undefined) {
    return (
      <EmptyState
        title="等待计划审批"
        hint="请先在「计划」里审批通过，再把任务书交给 dsh 开发。"
        action={{ label: '去审批', onClick: () => { model.setTab('plan') } }}
      />
    )
  }

  const handedOff = run.handoffAt !== undefined
  const dirty = editing && draft.trimEnd() !== prompt.trimEnd()

  const copy = (): void => {
    void writeClipboard(prompt).then(accepted => { setCopied(accepted) })
  }

  const saveEdit = (): void => {
    void model.savePrompt(draft).then(() => { setEditing(false) })
  }

  return (
    <div className={`${CX}-col`}>
      <div className={`${CX}-card`}>
        <div className={`${CX}-card-title`}>交给 dsh 开发</div>
        <div className={`${CX}-card-text`}>
          点「送入输入框」，下面这份任务书会填进当前会话的输入框，你确认后按发送即可开工。
          dsh 会用这个会话已有的工作目录和权限来写代码。
        </div>
        <div className={`${CX}-bar`} style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`${CX}-btn`}
            data-variant="primary"
            disabled={!state.bridgeReady || editing}
            onClick={() => { model.handOff() }}
            title={state.bridgeReady ? '把任务书填进当前会话的输入框' : '需要先打开一个会话'}
          >
            送入输入框
          </button>
          <button type="button" className={`${CX}-btn`} onClick={copy}>
            <span className={`${CX}-btn-icon`}><Icon name={copied ? 'check' : 'copy'} /></span>
            {copied ? '已复制' : '复制'}
          </button>
          <button type="button" className={`${CX}-btn`} onClick={() => { downloadText(`任务书-${run.label}.md`, prompt, 'text/plain') }}>
            <span className={`${CX}-btn-icon`}><Icon name="download" /></span>
            下载
          </button>
          {editing ? (
            <>
              <button
                type="button"
                className={`${CX}-btn`}
                data-variant="primary"
                disabled={!dirty || state.acting}
                onClick={() => { saveEdit() }}
              >
                保存编辑
              </button>
              <button
                type="button"
                className={`${CX}-btn`}
                onClick={() => { setEditing(false); setDraft(prompt) }}
              >
                放弃
              </button>
            </>
          ) : (
            <button type="button" className={`${CX}-btn`} onClick={() => { setDraft(prompt); setEditing(true) }}>
              <span className={`${CX}-btn-icon`}><Icon name="edit" /></span>
              编辑
            </button>
          )}
          {handedOff && <span className={`${CX}-hint`}>已于 {formatTime(run.handoffAt)} 送入输入框</span>}
        </div>
        {!state.bridgeReady && (
          <div className={`${CX}-hint`} style={{ marginTop: 8 }}>
            当前没有打开的会话。先在 dsh 里新建或选中一个会话，这个按钮就会可用。
          </div>
        )}
        {missingWorkspace && (
          <div className={`${CX}-bar`} style={{ marginTop: 8 }}>
            <span className={`${CX}-hint`}>
              这份任务书没有指定产物目录，dsh 会把项目写进当前会话的工作目录（应在「{workspace}」下的项目子目录里）。
            </span>
            <button
              type="button"
              className={`${CX}-btn`}
              disabled={state.acting}
              onClick={() => {
                const projectDir = run.projectDir ?? (sanitizeDirName(run.label) || undefined)
                void model.savePrompt(`${prompt.trimEnd()}\n\n${workspaceDirective(workspace, projectDir)}`)
              }}
              title="把产物目录指令追加到任务书并保存"
            >
              补写产物位置
            </button>
          </div>
        )}
      </div>

      {/* Build recovery: what the workspace watcher saw after the handoff. The
          run document carries it, so this follows the panel's normal snapshot
          poll and turns green the moment dsh writes its completion receipt. */}
      {run.build !== undefined && (
        <div className={`${CX}-card`}>
          <div className={`${CX}-card-head`}>
            <span className={`${CX}-card-title`}>构建回收</span>
            <span className={`${CX}-chip`} data-accent={run.build.status === 'done' ? 'true' : undefined}>
              {run.build.status === 'waiting' ? '等待产出' : run.build.status === 'active' ? 'dsh 构建中' : '已完成'}
            </span>
          </div>
          <div className={`${CX}-card-text`}>
            {run.build.status === 'waiting' && '任务书已送入，dsh 还没有在产物根目录下创建项目目录。'}
            {run.build.status === 'active' && '已检测到项目目录出现，dsh 正在写代码；完成回执写入后这里会自动更新。'}
            {run.build.status === 'done' && (run.build.summary !== undefined && run.build.summary !== ''
              ? <>dsh 已完成：<span className={`${CX}-card-title`}>{run.build.summary}</span></>
              : 'dsh 已写入完成回执，可以去「结果」启动产物。')}
          </div>
          {run.build.status === 'done' && run.build.completedAt !== undefined && (
            <div className={`${CX}-row-sub`}>完成于 {formatTime(run.build.completedAt)}</div>
          )}
        </div>
      )}

      <div className={`${CX}-section`}>{editing ? '任务书（编辑中）' : '任务书'}</div>
      {editing
        ? (
          <textarea
            className={`${CX}-area`}
            data-mono="true"
            rows={18}
            value={draft}
            onChange={event => { setDraft(event.target.value) }}
          />
        )
        : <pre className={`${CX}-pre`}>{prompt}</pre>}
    </div>
  )
}
