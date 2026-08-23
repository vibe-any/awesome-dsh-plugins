/**
 * One-time stylesheet injection for the hub overlay's class-styled parts
 * (markdown reading view + link buttons). Inline styles cover layout; this
 * sheet covers element selectors inside rendered Markdown, which inline
 * styles cannot reach. Injection lives in the module factory closure per the
 * client-modules lazy-CJS model; the tag carries a stable id so HMR reloads
 * reuse it instead of stacking duplicates.
 */

const STYLE_ID = 'pwa-hub-styles'

const CSS = `
.pwa-md .pwa-md-h { color: var(--dsw-alias-label-primary, #e6ebf2); font-weight: 650; line-height: 1.35; margin: 18px 0 8px; }
.pwa-md > .pwa-md-h:first-child { margin-top: 2px; }
.pwa-md .pwa-md-p { margin: 0 0 12px; }
.pwa-md .pwa-md-list { margin: 0 0 12px; padding-left: 20px; }
.pwa-md .pwa-md-list li { margin: 4px 0; }
.pwa-md .pwa-md-quote { margin: 0 0 12px; padding: 8px 14px; border-left: 3px solid var(--dsw-static-deepseek-600, rgb(72,104,178)); background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1)); border-radius: 0 10px 10px 0; color: var(--dsw-alias-label-secondary, #c9d2e0); }
.pwa-md .pwa-md-code { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: .88em; padding: 1px 6px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); }
.pwa-md .pwa-md-pre { margin: 0 0 12px; padding: 12px 14px; overflow-x: auto; border-radius: 12px; background: rgba(0,0,0,.28); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); }
.pwa-md .pwa-md-pre code { all: unset; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: .9em; line-height: 1.65; color: var(--dsw-alias-label-primary, #e6ebf2); white-space: pre; }
.pwa-md .pwa-md-twrap { margin: 0 0 12px; overflow-x: auto; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); border-radius: 10px; }
.pwa-md .pwa-md-table { border-collapse: collapse; width: 100%; font-size: .93em; }
.pwa-md .pwa-md-table th { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); color: var(--dsw-alias-label-primary, #e6ebf2); font-weight: 650; }
.pwa-md .pwa-md-table th, .pwa-md .pwa-md-table td { padding: 7px 11px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); }
.pwa-md .pwa-md-table th:not(:last-child), .pwa-md .pwa-md-table td:not(:last-child) { border-right: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); }
.pwa-md .pwa-md-table tbody tr:last-child td { border-bottom: none; }
.pwa-md .pwa-md-table tbody tr:nth-child(even) { background: color-mix(in srgb, var(--dsw-alias-label-primary, #fff) 4%, transparent); }
.pwa-md .pwa-md-img { max-width: 100%; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); margin: 4px 0 12px; display: block; }
.pwa-md .pwa-md-hr { border: none; border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); margin: 16px 0; }
.pwa-md .pwa-md-link { color: var(--dsw-alias-label-primary-bluish, #4cc9f0); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, currentColor 40%, transparent); }
.pwa-md .pwa-md-link:hover { filter: brightness(1.15); }

.pwa-linkbtn { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 11px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3)); background: transparent; color: var(--dsw-alias-label-secondary, #c9d2e0); font-size: 12px; text-decoration: none; cursor: pointer; transition: border-color .15s ease, color .15s ease; }
.pwa-linkbtn:hover { border-color: var(--dsw-alias-label-primary-bluish, #4cc9f0); color: var(--dsw-alias-label-primary-bluish, #4cc9f0); }
`

/** Inject the sheet exactly once per document. Never throws. */
export function ensureStyles() {
  try {
    if (document.getElementById(STYLE_ID) !== null) return
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.textContent = CSS
    document.head.appendChild(tag)
  } catch (cause) {
    console.warn('[pwa-hub] style injection skipped:', cause)
  }
}
