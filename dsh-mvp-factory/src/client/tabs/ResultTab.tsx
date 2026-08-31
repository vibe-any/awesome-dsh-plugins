/**
 * Result tab: run the produced app on this machine and show where to open it.
 *
 * One process at a time, held by the host. The state shown here is the host's
 * live view, so a dev server that exits on its own turns up as `failed` with its
 * output rather than staying green. The log tail follows the output by default
 * and can be frozen for reading.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryModel, FactoryState } from '../model.ts'
import { CX } from '../styles.ts'
import { Elapsed, Status, formatTime } from '../ui.tsx'

/**
 * The result tab.
 * @param props - shared model and its current state.
 * @returns the tab body.
 */
export function ResultTab(props: {
  readonly model: FactoryModel
  readonly state: FactoryState
}): ReactNode {
  const { model, state } = props
  const snapshot = state.snapshot
  const run = snapshot?.activeRun ?? null
  const [follow, setFollow] = useState(true)
  const [copied, setCopied] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const log = snapshot?.app.log ?? ''

  // Keep the newest output in view while follow is on; the effect re-runs as
  // the tail grows.
  useEffect(() => {
    if (!follow || logRef.current === null) return
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log, follow])

  if (snapshot === null) return null

  const { app, settings } = snapshot
  const live = app.status === 'installing' || app.status === 'starting' || app.status === 'running'
  const workspace = settings.workspace.trim()
  const projectDir = run?.projectDir !== undefined && run.projectDir !== ''
    ? (workspace === '' ? run.projectDir : `${workspace}/${run.projectDir}`)
    : undefined

  const copyLog = (): void => {
    void writeClipboard(log).then(accepted => { setCopied(accepted) })
  }

  return (
    <div className={`${CX}-col`}>
      <div className={`${CX}-card`}>
        <div className={`${CX}-card-head`}>
          <span className={`${CX}-card-title`}>产物项目</span>
          <Status status={app.status} />
        </div>
        <div className={`${CX}-card-text`}>
          dsh 写完代码后，在这里用「设置」里配的命令把产物跑起来。
        </div>
        <div className={`${CX}-row-sub`}>产物根目录：{workspace === '' ? '（未配置）' : workspace}</div>
        <div className={`${CX}-row-sub`}>
          {projectDir !== undefined
            ? <>本次项目：<span data-mono="true">{projectDir}</span></>
            : '启动时自动定位项目目录（根目录本身，或其中唯一含 package.json 的子目录）'}
        </div>
        <div className={`${CX}-row-sub`}>启动命令：{settings.devCommand === '' ? '（未配置）' : settings.devCommand}</div>
        {run?.build !== undefined && (
          <div className={`${CX}-row-sub`}>
            构建回收：{run.build.status === 'waiting'
              ? '等待 dsh 开始产出'
              : run.build.status === 'active'
                ? 'dsh 构建中'
                : <>dsh 已完成{run.build.completedAt !== undefined ? ` · ${formatTime(run.build.completedAt)}` : ''}</>}
          </div>
        )}
        {app.startedAt !== undefined && (
          <div className={`${CX}-row-sub`}>
            启动于 {formatTime(app.startedAt)}{app.pid === undefined ? '' : ` · pid ${app.pid}`}
            {live && <> · <Elapsed since={app.startedAt} /></>}
          </div>
        )}

        <div className={`${CX}-bar`} style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`${CX}-btn`}
            data-variant="primary"
            disabled={live || state.acting || workspace === ''}
            onClick={() => { void model.startApp() }}
          >
            {live ? '运行中' : '启动产物'}
          </button>
          <button
            type="button"
            className={`${CX}-btn`}
            data-variant="danger"
            disabled={state.acting || (!live && app.status !== 'failed')}
            onClick={() => { void model.stopApp() }}
          >
            停止
          </button>
          {app.status === 'running' && app.url !== '' && (
            <a className={`${CX}-link`} href={app.url} target="_blank" rel="noreferrer noopener">
              打开 {app.url}
            </a>
          )}
        </div>

        {workspace === '' && (
          <div className={`${CX}-hint`} style={{ marginTop: 8 }}>
            请先在「设置」里填写产物根目录（绝对路径）。
          </div>
        )}
        {app.error !== undefined && (
          <div className={`${CX}-err`} style={{ marginTop: 8 }}>{app.error}</div>
        )}
      </div>

      {log !== '' && (
        <>
          <div className={`${CX}-bar`}>
            <span className={`${CX}-section`} style={{ margin: 0 }}>运行日志</span>
            <span className={`${CX}-spacer`} />
            <label className={`${CX}-check`}>
              <input type="checkbox" checked={follow} onChange={event => { setFollow(event.target.checked) }} />
              跟随输出
            </label>
            <button type="button" className={`${CX}-btn`} onClick={copyLog}>{copied ? '已复制' : '复制日志'}</button>
          </div>
          <pre ref={logRef} className={`${CX}-pre`} data-log="true">{log}</pre>
        </>
      )}
    </div>
  )
}
