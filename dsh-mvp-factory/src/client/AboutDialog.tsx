/**
 * The about dialog, registered into `shell.overlay` above the panel (higher
 * `order`, higher z-index). It lives in its own slot registration — not inside
 * the panel's DOM — so the backdrop covers the whole window including the
 * sidebar column, the same click-through-opt-out trick the panel uses.
 *
 * One centred card: logo, name, package id + version, a one-line description,
 * then two quiet link rows — the open-source home and the copyright holder.
 * Version rides the package.json import, inlined at build time, so the dialog
 * always states the version that was actually built into this bundle.
 */

import { useSyncExternalStore, type ReactNode } from 'react'
import packageJson from '../../package.json'
import type { FactoryModel } from './model.ts'
import { CX } from './styles.ts'
import { Icon } from './ui.tsx'
import { LOGO_URL } from './logo.ts'

/** Where the source lives. */
const GITHUB_URL = 'https://github.com/vibe-any/awesome-dsh-plugins/tree/main/dsh-mvp-factory'
/** The copyright holder's site; the copyright row links here. */
const SITE_URL = 'https://playwithai.fun'

/** A 14px stroke glyph matching the shell's icon language. */
function Glyph(props: { readonly children: ReactNode }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  )
}

/**
 * Build the about dialog bound to one shared model.
 * @param model - shared panel state.
 * @returns the slot component.
 */
export function createAboutDialog(model: FactoryModel) {
  return function MvpFactoryAbout(): ReactNode {
    const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
    if (!state.aboutOpen) return null

    return (
      <div className={`${CX}-about-backdrop`} onClick={() => { model.closeAbout() }}>
        <div
          className={`${CX}-about`}
          role="dialog"
          aria-label="关于 MVP 工厂"
          onClick={(event) => { event.stopPropagation() }}
        >
          <button
            type="button"
            className={`${CX}-about-close`}
            aria-label="关闭"
            onClick={() => { model.closeAbout() }}
          >
            <Icon name="close" size={13} />
          </button>

          <img className={`${CX}-about-logo`} src={LOGO_URL} alt="MVP 工厂 logo" width={56} height={56} />
          <div className={`${CX}-about-name`}>MVP 工厂</div>
          <div className={`${CX}-about-id`}>dsh-mvp-factory · v{packageJson.version}</div>
          <p className={`${CX}-about-desc`}>
            在 DeepSeek Harness 里发现产品创意、评估立项、生成开发计划，一键把任务书送入会话，并在本地运行产物应用。
          </p>

          <div className={`${CX}-about-links`}>
            <a className={`${CX}-about-link`} href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Glyph>
                <path d="M5.5 4.5 2.5 8l3 3.5" />
                <path d="M10.5 4.5 13.5 8l-3 3.5" />
              </Glyph>
              <span>开源地址</span>
              <span className={`${CX}-about-link-host`}>github.com/vibe-any</span>
            </a>
            <a className={`${CX}-about-link`} href={SITE_URL} target="_blank" rel="noreferrer">
              <Glyph>
                <circle cx="8" cy="8" r="6.2" />
                <path d="M1.8 8h12.4" />
                <ellipse cx="8" cy="8" rx="2.8" ry="6.2" />
              </Glyph>
              <span>© {new Date().getFullYear()} PlayWithAI</span>
              <span className={`${CX}-about-link-host`}>playwithai.fun</span>
            </a>
          </div>
        </div>
      </div>
    )
  }
}
