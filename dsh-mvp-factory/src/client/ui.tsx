/**
 * Small presentational pieces every tab reuses. Keeping the status vocabulary
 * and the timestamp format in one place is what stops the six tabs from each
 * inventing their own wording for the same state.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CX } from './styles.ts'
import type { AppStatus, StageStatus } from '../types.ts'

/** Chinese label for every stage and process state. */
const STATUS_TEXT: Readonly<Record<StageStatus | AppStatus, string>> = {
  idle: '未开始',
  running: '进行中',
  ready: '已完成',
  failed: '失败',
  stopped: '未运行',
  installing: '安装依赖',
  starting: '启动中',
}

/** One state badge: a status dot (pulsing while running) plus the label. */
export function Status(props: { readonly status: StageStatus | AppStatus }): ReactNode {
  return (
    <span className={`${CX}-status`} data-status={props.status}>
      <span className={`${CX}-status-dot`} />
      {STATUS_TEXT[props.status]}
    </span>
  )
}

/** One labelled form field. */
export function Field(props: {
  readonly label: string
  readonly hint?: ReactNode
  readonly extra?: ReactNode
  readonly children: ReactNode
}): ReactNode {
  return (
    <div className={`${CX}-field`}>
      <span className={`${CX}-label`}>
        {props.label}
        {props.extra !== undefined && <span className={`${CX}-label-extra`}>{props.extra}</span>}
      </span>
      {props.children}
      {props.hint !== undefined && <span className={`${CX}-hint`}>{props.hint}</span>}
    </div>
  )
}

/** The failure and confirmation strip shared by every tab. */
export function Messages(props: {
  readonly error?: string | undefined
  readonly notice?: string | undefined
}): ReactNode {
  if (props.error === undefined && props.notice === undefined) return null
  return (
    <>
      {props.error !== undefined && <div className={`${CX}-err`}>{props.error}</div>}
      {props.notice !== undefined && <div className={`${CX}-ok`}>{props.notice}</div>}
    </>
  )
}

/** An empty-state line. */
export function Empty(props: { readonly children: ReactNode }): ReactNode {
  return <div className={`${CX}-note`}>{props.children}</div>
}

/**
 * A full empty state: centred glyph, one sentence, and the primary action the
 * user should take next, so a blank tab never dead-ends.
 */
export function EmptyState(props: {
  readonly title: string
  readonly hint?: ReactNode
  readonly action?: { readonly label: string; readonly onClick: () => void; readonly disabled?: boolean }
}): ReactNode {
  return (
    <div className={`${CX}-empty`}>
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19.5V8l4.5 2.8V8L13 10.8V5.5l7 4v10z" />
        <path d="M3 19.5h18" />
      </svg>
      <div className={`${CX}-empty-title`}>{props.title}</div>
      {props.hint !== undefined && <div className={`${CX}-empty-hint`}>{props.hint}</div>}
      {props.action !== undefined && (
        <button
          type="button"
          className={`${CX}-btn`}
          data-variant="primary"
          disabled={props.action.disabled}
          onClick={props.action.onClick}
        >
          {props.action.label}
        </button>
      )}
    </div>
  )
}

/** First-load placeholder: three shimmering bars instead of a bare sentence. */
export function Skeleton(): ReactNode {
  return (
    <div className={`${CX}-skeleton`} aria-hidden="true">
      <div className={`${CX}-skeleton-bar`} data-w="38" />
      <div className={`${CX}-skeleton-bar`} data-w="86" />
      <div className={`${CX}-skeleton-bar`} data-w="64" />
    </div>
  )
}

/**
 * Two-step destructive/irreversible button: the first click arms it (label and
 * colour change), the second confirms, and arming decays after a few seconds.
 * Avoids a modal while still preventing one-click data loss.
 */
export function ConfirmButton(props: {
  readonly label: string
  readonly confirmLabel: string
  readonly onConfirm: () => void
  readonly disabled?: boolean
  readonly variant?: '' | 'danger'
}): ReactNode {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (timer.current !== undefined) clearTimeout(timer.current) }, [])
  const click = (): void => {
    if (!armed) {
      setArmed(true)
      if (timer.current !== undefined) clearTimeout(timer.current)
      timer.current = setTimeout(() => { setArmed(false) }, 2600)
      return
    }
    if (timer.current !== undefined) clearTimeout(timer.current)
    setArmed(false)
    props.onConfirm()
  }
  return (
    <button
      type="button"
      className={`${CX}-btn`}
      data-variant={props.variant === 'danger' || armed ? 'danger' : undefined}
      data-armed={String(armed)}
      disabled={props.disabled}
      onClick={click}
    >
      {armed ? props.confirmLabel : props.label}
    </button>
  )
}

/**
 * Live elapsed-seconds counter for a running stage, driven by the stage's own
 * `startedAt` so a re-render cannot inflate it.
 */
export function Elapsed(props: { readonly since?: string | undefined }): ReactNode {
  const [now, setNow] = useState(() => Date.now())
  const startedAt = props.since === undefined ? undefined : new Date(props.since).getTime()
  const live = startedAt !== undefined && !Number.isNaN(startedAt)
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [live])
  if (!live || startedAt === undefined) return null
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000))
  const text = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  return <span className={`${CX}-elapsed`}>已用时 {text}</span>
}

/** Icon names this plugin's surfaces draw. */
export type IconName = 'refresh' | 'close' | 'copy' | 'download' | 'pin' | 'edit' | 'check' | 'stop' | 'info'

/** The shared 16px stroke icon set, at the shell's nav-icon size. */
export function Icon(props: { readonly name: IconName; readonly size?: number }): ReactNode {
  const size = props.size ?? 14
  const paths: Readonly<Record<IconName, ReactNode>> = {
    refresh: <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.8v2.7h-2.7" />,
    close: <path d="M4 4l8 8M12 4l-8 8" />,
    copy: <>
      <rect x="5.5" y="5.5" width="7" height="7" rx="1.2" />
      <path d="M10.5 3.5h2A1.5 1.5 0 0 1 14 5v6" />
    </>,
    download: <path d="M8 2.5v7.5M5 7.5l3 3 3-3M3 13.5h10" />,
    pin: <path d="M8 14V9.5M5.5 2.5h5l-.7 4 1.7 2.5H4.5L6.2 6.5z" />,
    edit: <path d="M3 13h10M9.5 3l3.5 3.5-6 6H3.5V9z" />,
    check: <path d="M3 8.5l3.2 3.2L13 5" />,
    stop: <rect x="4" y="4" width="8" height="8" rx="1.5" />,
    info: (
      <>
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 7.4v3.4" />
        <path d="M8 5.15h.01" />
      </>
    ),
  }
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[props.name]}
    </svg>
  )
}

/** A compact header button carrying its meaning in a tooltip, not text. */
export function IconButton(props: {
  readonly name: IconName
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly danger?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      className={`${CX}-iconbtn`}
      data-danger={props.danger === true ? 'true' : undefined}
      disabled={props.disabled}
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
    >
      <Icon name={props.name} />
    </button>
  )
}

/** One labelled score with a thin proportional bar — numbers gain shape. */
export function ScoreBar(props: { readonly label: string; readonly value: number }): ReactNode {
  return (
    <span className={`${CX}-scorebar`}>
      <span className={`${CX}-scorebar-label`}>{props.label}</span>
      <span className={`${CX}-scorebar-track`}>
        <span className={`${CX}-scorebar-fill`} data-level={props.value >= 70 ? 'high' : props.value >= 40 ? 'mid' : 'low'} style={{ width: `${Math.min(100, Math.max(0, props.value))}%` }} />
      </span>
      <span className={`${CX}-scorebar-num`}>{props.value}</span>
    </span>
  )
}

/**
 * Render one ISO timestamp in the user's locale, minute precision.
 * @param iso - the stored timestamp, or undefined.
 * @returns display text, or an em dash when absent or unparseable.
 */
export function formatTime(iso: string | undefined): string {
  if (iso === undefined) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Render one ISO timestamp as a coarse relative age for list rows, with the
 * absolute time one hover away via `title`.
 * @param iso - the stored timestamp.
 * @returns "刚刚" / "N 分钟前" / "N 小时前" / a short date.
 */
export function formatRelative(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} 天前`
  return formatTime(iso)
}

/**
 * The host part of a URL, for showing where a citation leads without printing
 * a full link in a chip.
 * @param url - the citation URL.
 * @returns the hostname, or the original text when parsing fails.
 */
export function urlHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Download one text payload as a file, the way a plain browser link would.
 * @param filename - suggested file name.
 * @param text - the payload.
 * @param mime - the payload's media type.
 */
export function downloadText(filename: string, text: string, mime = 'text/markdown'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
