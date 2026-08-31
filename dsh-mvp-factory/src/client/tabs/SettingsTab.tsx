/**
 * Settings tab: an editable copy of the stored document.
 *
 * The panel polls the snapshot every couple of seconds, so the form cannot bind
 * straight to it — a poll landing mid-sentence would discard what was being
 * typed. The draft is therefore local and only re-seeded from the server while it
 * is untouched, which is what `dirty` tracks.
 *
 * The stored Tavily key never travels back to the browser: the snapshot masks it
 * and reports only whether one exists, so the form sends a key only when the user
 * typed one (or asked to clear it).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FactoryModel, FactoryState } from '../model.ts'
import { CX } from '../styles.ts'
import { Field } from '../ui.tsx'
import { DEFAULT_SETTINGS } from '../../settings.ts'
import type { DiscoverEngine, Settings } from '../../types.ts'

/** The form's shape: settings, with the source list held as editable text. */
interface Form extends Omit<Settings, 'sources'> {
  sourcesText: string
}

/** A writable view of `Partial<Settings>`: the stored type is readonly, the patch is not. */
type SettingsPatch = { -readonly [K in keyof Settings]?: Settings[K] }

/** Project stored settings onto the form. */
function toForm(settings: Settings): Form {
  const { sources, ...rest } = settings
  return { ...rest, sourcesText: sources.join(', ') }
}

/**
 * Project the form back onto a settings patch. `tavilyApiKey` is included only
 * when the user typed one or asked to clear the stored one — an untouched empty
 * field must not wipe a key the browser never saw.
 */
function toPatch(form: Form, clearKey: boolean): SettingsPatch {
  const { sourcesText, tavilyApiKey, ...rest } = form
  const patch: SettingsPatch = {
    ...rest,
    sources: sourcesText.split(',').map(item => item.trim()).filter(item => item !== ''),
  }
  if (tavilyApiKey !== '') patch['tavilyApiKey'] = tavilyApiKey
  else if (clearKey) patch['tavilyApiKey'] = ''
  return patch
}

/** One bordered settings group with a section heading. */
function Group(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className={`${CX}-card`}>
      <div className={`${CX}-section`} style={{ margin: '0 0 12px' }}>{props.title}</div>
      <div className={`${CX}-group`}>{props.children}</div>
    </div>
  )
}

/**
 * The settings tab.
 * @param props - shared model and its current state.
 * @returns the tab body.
 */
export function SettingsTab(props: {
  readonly model: FactoryModel
  readonly state: FactoryState
}): ReactNode {
  const { model, state } = props
  const snapshot = state.snapshot
  const settings = snapshot?.settings
  const serialized = JSON.stringify(settings ?? null)

  const [form, setForm] = useState<Form | null>(settings === undefined ? null : toForm(settings))
  const [dirty, setDirty] = useState(false)
  const [clearKey, setClearKey] = useState(false)
  const seeded = useRef(serialized)

  useEffect(() => {
    if (settings === undefined) return
    // An edit in progress owns the form until it is saved or reset.
    if (dirty) return
    if (seeded.current === serialized && form !== null) return
    seeded.current = serialized
    setForm(toForm(settings))
  }, [serialized, dirty])

  if (settings === undefined || form === null) return null

  const edit = (patch: Partial<Form>): void => {
    setForm({ ...form, ...patch })
    setDirty(true)
  }

  const save = (): void => {
    void model.saveSettings(toPatch(form, clearKey)).then(() => {
      setDirty(false)
      setClearKey(false)
    })
  }

  const reset = (): void => {
    setForm(toForm(settings))
    setClearKey(false)
    setDirty(false)
  }

  const keyPresent = snapshot?.tavilyKeyPresent === true

  // The group cards flow through a balanced column layout: no fixed left/right
  // split, so neither side strands blank space no matter what is expanded.
  return (
    <>
      <div className={`${CX}-flow`}>
        <Group title="检索">
          <Field label="默认方向">
            <input
              className={`${CX}-input`}
              value={form.topic}
              onChange={event => { edit({ topic: event.target.value }) }}
            />
          </Field>

          <Field label="渠道" hint="逗号分隔，会拼进每条搜索 query">
            <input
              className={`${CX}-input`}
              value={form.sourcesText}
              onChange={event => { edit({ sourcesText: event.target.value }) }}
            />
          </Field>

          <Field label="默认检索方式">
            <select
              className={`${CX}-select`}
              value={form.engine}
              onChange={event => { edit({ engine: event.target.value as DiscoverEngine }) }}
            >
              <option value="web-search">联网搜索（dsh 已配置的搜索）</option>
              <option value="tavily">Tavily 搜索（需自备 API key）</option>
              <option value="model-only">模型直出</option>
              <option value="import">粘贴导入</option>
            </select>
          </Field>

          {form.engine === 'tavily' && (
            <Field
              label="Tavily API Key"
              hint={keyPresent
                ? '已保存一把 key（不会回传显示）。填写新值即覆盖，或清除后重填。'
                : <>必填，可到 <a href="https://app.tavily.com/" target="_blank" rel="noreferrer noopener">https://app.tavily.com/</a> 注册获取</>}
            >
              <div className={`${CX}-bar`}>
                <input
                  className={`${CX}-input`}
                  style={{ flex: '1 1 160px' }}
                  type="password"
                  value={form.tavilyApiKey}
                  placeholder={keyPresent ? '••••••••（已保存）' : 'tvly-...'}
                  onChange={event => { edit({ tavilyApiKey: event.target.value }) }}
                />
                {keyPresent && (
                  <button
                    type="button"
                    className={`${CX}-btn`}
                    disabled={clearKey}
                    onClick={() => { setForm({ ...form, tavilyApiKey: '' }); setClearKey(true); setDirty(true) }}
                  >
                    清除
                  </button>
                )}
              </div>
            </Field>
          )}

          <Field label="每条 query 取几条来源" hint="1-20">
            <input
              className={`${CX}-input`}
              type="number"
              min={1}
              max={20}
              value={form.maxResults}
              onChange={event => { edit({ maxResults: Number(event.target.value) }) }}
            />
          </Field>

          <Field label="候选创意条数" hint="3-20">
            <input
              className={`${CX}-input`}
              type="number"
              min={3}
              max={20}
              value={form.ideaCount}
              onChange={event => { edit({ ideaCount: Number(event.target.value) }) }}
            />
          </Field>

          <label className={`${CX}-check`}>
            <input
              type="checkbox"
              checked={form.deepResearch}
              onChange={event => { edit({ deepResearch: event.target.checked }) }}
            />
            深度检索：抓取前 3 条来源的正文并入研究材料（更慢，更全）
          </label>
        </Group>

        <Group title="模型">
          <Field
            label="模型覆盖"
            hint={
              snapshot?.model === null
                ? '留空表示跟随 dsh 的默认模型（当前还没配置模型）'
                : `留空表示跟随 dsh 的默认模型（当前：${snapshot?.model?.provider}/${snapshot?.model?.model}${snapshot?.model?.overridden === true ? '，来自这里的覆盖' : ''}）`
            }
          >
            <input
              className={`${CX}-input`}
              value={form.modelOverride}
              placeholder="provider/model"
              onChange={event => { edit({ modelOverride: event.target.value }) }}
            />
          </Field>
        </Group>

        <Group title="产物运行">
          <Field label="产物根目录" hint="绝对路径；每个项目的代码会创建在它下面的子目录里，启动时自动进入对应项目">
            <input
              className={`${CX}-input`}
              value={form.workspace}
              placeholder="/Users/you/projects"
              onChange={event => { edit({ workspace: event.target.value }) }}
            />
          </Field>

          <Field label="安装命令" hint="留空跳过">
            <input
              className={`${CX}-input`}
              value={form.installCommand}
              onChange={event => { edit({ installCommand: event.target.value }) }}
            />
          </Field>

          <Field label="启动命令">
            <input
              className={`${CX}-input`}
              value={form.devCommand}
              onChange={event => { edit({ devCommand: event.target.value }) }}
            />
          </Field>

          <Field label="访问地址">
            <input
              className={`${CX}-input`}
              value={form.appUrl}
              onChange={event => { edit({ appUrl: event.target.value }) }}
            />
          </Field>
        </Group>

        <details className={`${CX}-details`} open>
          <summary>提示词模板</summary>
          <div className={`${CX}-details-body`}>
            <Field label="任务书附加要求" hint="会追加到每份任务书末尾">
              <textarea
                className={`${CX}-area`}
                rows={3}
                value={form.buildInstruction}
                onChange={event => { edit({ buildInstruction: event.target.value }) }}
              />
            </Field>

            <Field
              label="结构化提示词"
              hint="可用占位符：{{digest}} {{sources}} {{today}} {{count}}"
              extra={(
                <button
                  type="button"
                  className={`${CX}-btn`}
                  title="恢复到插件自带的模板"
                  onClick={() => { edit({ structurePrompt: DEFAULT_SETTINGS.structurePrompt }) }}
                >
                  恢复默认
                </button>
              )}
            >
              <textarea
                className={`${CX}-area`}
                data-mono="true"
                rows={14}
                value={form.structurePrompt}
                onChange={event => { edit({ structurePrompt: event.target.value }) }}
              />
            </Field>

            <Field
              label="评估提示词"
              hint="可用占位符：{{ideas}} {{today}}"
              extra={(
                <button
                  type="button"
                  className={`${CX}-btn`}
                  title="恢复到插件自带的模板"
                  onClick={() => { edit({ evaluatePrompt: DEFAULT_SETTINGS.evaluatePrompt }) }}
                >
                  恢复默认
                </button>
              )}
            >
              <textarea
                className={`${CX}-area`}
                data-mono="true"
                rows={16}
                value={form.evaluatePrompt}
                onChange={event => { edit({ evaluatePrompt: event.target.value }) }}
              />
            </Field>
          </div>
        </details>
      </div>

      <div className={`${CX}-savebar`}>
        {dirty && <span className={`${CX}-hint`}>有未保存的修改</span>}
        <button type="button" className={`${CX}-btn`} disabled={!dirty} onClick={reset}>
          放弃修改
        </button>
        <button
          type="button"
          className={`${CX}-btn`}
          data-variant="primary"
          disabled={!dirty || state.acting}
          onClick={save}
        >
          保存设置
        </button>
      </div>
    </>
  )
}
