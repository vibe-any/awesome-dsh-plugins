/**
 * One stylesheet for every surface, injected as a single `<style>` tag keyed by
 * this plugin's id. The shell's module loader removes `style[data-plugin]` tags
 * belonging to a plugin when it unloads, so hot reload leaves no residue and no
 * CSS build step is needed.
 *
 * The visual system follows the repo's DESIGN.md: a warm cream canvas with dark
 * warm-ink text, coral reserved for primary CTAs, borderless cream cards, and
 * code/log blocks living on always-dark surfaces — the cream↔dark contrast is
 * the pacing mechanism. Radius is hierarchical (8 controls / 12 cards / 16
 * dialogs), display text runs a serif stack at weight 400 with negative
 * tracking, body text a humanist sans, code a mono stack.
 *
 * The palette is declared once as CSS variables on `body` (TOKENS below) and
 * re-declared under `body[data-ds-dark-theme]` — the same hook the shell's
 * `ui-theme` uses for its own dark tokens. That is the coordination contract
 * with the running shell: light theme gets the cream brand palette, dark theme
 * gets the spec's own dark surfaces, and both stay one flip away from the
 * shell's theme switch. The dark code-surface variables intentionally do NOT
 * flip: terminal chrome is dark in both themes, like the shell's own code
 * blocks. Every `var()` still carries a literal fallback so a shell that
 * somehow drops the tag's variables degrades to the brand palette instead of
 * transparent.
 *
 * Severity rides a FOREGROUND colour over neutral surfaces. Spacing keeps the
 * 4px rhythm (4 / 8 / 12 / 16 / 24); the content column has no width cap —
 * pages follow the window, and only form controls carry a readability cap.
 *
 * Note also that the CSS below is a template literal: a backtick inside it ends
 * the string, so token names are never quoted in the rules themselves.
 */

/** The plugin id, matching the bundle's loader id and the style tag's owner. */
export const PLUGIN_ID = 'dsh-mvp-factory'

/** Class-name prefix keeping these rules from colliding with shell styles. */
export const CX = 'dsh-mf'

/**
 * The DESIGN.md palette as variables. Light = the brand default; dark mirrors
 * the spec's own dark surfaces so the plugin keeps following the shell's theme
 * switch instead of fighting it.
 */
const TOKENS = `
body {
  --mf-canvas: #faf9f5;
  --mf-soft: #f5f0e8;
  --mf-card: #efe9de;
  --mf-strong: #e8e0d2;
  --mf-hairline: #e6dfd8;
  --mf-hairline-soft: #ebe6df;
  --mf-ink: #141413;
  --mf-body-strong: #252523;
  --mf-body: #3d3d3a;
  --mf-muted: #6c6a64;
  --mf-muted-soft: #8e8b82;
  --mf-primary: #cc785c;
  --mf-primary-active: #a9583e;
  --mf-primary-disabled: #e6dfd8;
  --mf-on-primary: #ffffff;
  --mf-teal: #5db8a6;
  --mf-amber: #b8860b;
  --mf-error: #c64545;
  --mf-success: #5db872;
  --mf-code-bg: #1f1e1b;
  --mf-on-dark: #faf9f5;
  --mf-on-dark-soft: #a09d96;
  --mf-shadow: rgba(20,20,19,.08);
}
body[data-ds-dark-theme] {
  --mf-canvas: #181715;
  --mf-soft: #1f1e1b;
  --mf-card: #252320;
  --mf-strong: #2e2a25;
  --mf-hairline: #3a352e;
  --mf-hairline-soft: #322e28;
  --mf-ink: #faf9f5;
  --mf-body-strong: #efece4;
  --mf-body: #d8d4cb;
  --mf-muted: #a09d96;
  --mf-muted-soft: #7d7a72;
  --mf-primary-active: #b8694e;
  --mf-primary-disabled: #3a352e;
  --mf-amber: #d4a017;
  --mf-code-bg: #252320;
  --mf-shadow: rgba(0,0,0,.28);
}
`

/** Text. */
const TEXT = 'var(--mf-ink, #141413)'
const TEXT_2 = 'var(--mf-body, #3d3d3a)'
const TEXT_3 = 'var(--mf-muted, #6c6a64)'
const TEXT_INV = 'var(--mf-on-primary, #fff)'
const LINK = 'var(--mf-primary, #cc785c)'
const DANGER = 'var(--mf-error, #c64545)'
const BUSINESS = 'var(--mf-teal, #5db8a6)'
const SUCCESS = 'var(--mf-success, #5db872)'

/** Surfaces: canvas floor, cream cards, and the two darker cream steps. */
const BG = 'var(--mf-canvas, #faf9f5)'
const BG_CARD = 'var(--mf-card, #efe9de)'
const BG_SUNKEN = 'var(--mf-soft, #f5f0e8)'
const HOVER = 'var(--mf-soft, #f5f0e8)'
const ACTIVE = 'var(--mf-strong, #e8e0d2)'
const BORDER = 'var(--mf-hairline, #e6dfd8)'

/** Brand: coral is the only accent; it darkens on press, nothing else moves. */
const BRAND = 'var(--mf-primary, #cc785c)'
const BRAND_HOVER = 'var(--mf-primary-active, #a9583e)'
const BRAND_LINE = 'var(--mf-primary, #cc785c)'

/** Code/log chrome is always dark, in both themes — spec's product surface. */
const CODE_BG = 'var(--mf-code-bg, #1f1e1b)'
const ON_DARK = 'var(--mf-on-dark, #faf9f5)'

/** Type stacks: serif display (400 + negative tracking), humanist sans, mono. */
const DISPLAY = `'Tiempos Headline', Garamond, 'Songti SC', 'STSong', 'Times New Roman', serif`
const SANS = `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Roboto, sans-serif`
const MONO = `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

const CSS = TOKENS + `
.${CX}-entry {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; border: 0; border-radius: 8px;
  background: transparent; cursor: pointer; text-align: left;
  font: inherit; font-size: 13px; color: ${TEXT_2};
}
.${CX}-entry:hover { background: ${HOVER}; }
.${CX}-entry[data-active="true"] { background: ${ACTIVE}; color: ${TEXT}; }
.${CX}-entry-icon { display: inline-flex; flex: 0 0 auto; }
.${CX}-entry-logo { display: block; border-radius: 5px; object-fit: cover; }
.${CX}-entry-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${CX}-entry[data-rail="true"] { justify-content: center; padding: 8px 0; }
.${CX}-dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: ${BRAND}; }

/* Panel shell: fills the main area to the right of the sidebar column. The
   warm shadow is the spec's own 0 1px 3px rgba(20,20,19,.08) family — depth
   comes from the surface colour, the drop shadow only lifts the overlay. */
.${CX}-panel {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 40;
  display: flex; flex-direction: column;
  background: ${BG}; color: ${TEXT};
  border-left: 1px solid ${BORDER};
  box-shadow: -12px 0 32px var(--mf-shadow, rgba(20,20,19,.08));
  pointer-events: auto; font-size: 13px;
  font-family: ${SANS};
  animation: ${CX}-in .16s ease-out;
}
@keyframes ${CX}-in {
  from { opacity: 0; transform: translateX(10px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .${CX}-panel, .${CX}-about-backdrop, .${CX}-about { animation: none; }
  .${CX}-status-dot[data-pulse="true"] { animation: none; }
}

.${CX}-head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 20px 12px;
}
.${CX}-head-logo { display: block; flex: 0 0 auto; border-radius: 6px; object-fit: cover; }
/* The one serif display on the panel: the product wordmark, weight 400 with
   negative tracking per spec — never bolded. */
.${CX}-title {
  font-family: ${DISPLAY}; font-size: 17px; font-weight: 400;
  letter-spacing: -.02em; color: ${TEXT};
}
/* Quiet info button riding the title; meaning rides the tooltip. */
.${CX}-titleinfo {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: ${TEXT_3}; cursor: pointer;
}
.${CX}-titleinfo:hover { background: ${HOVER}; color: ${TEXT}; }
.${CX}-sub {
  font-size: 11px; font-weight: 500; color: ${TEXT_3};
  padding: 2px 9px; border-radius: 999px; background: ${BG_CARD};
}
.${CX}-sub[data-historic="true"] { color: var(--mf-amber, #b8860b); background: ${ACTIVE}; }
.${CX}-spacer { flex: 1 1 auto; }

/* About dialog: one centred card over a dimmed backdrop, one layer above the
   panel. The backdrop is the slot root, so it spans the whole window. */
.${CX}-about-backdrop {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  background: rgba(20,20,19,.32);
  pointer-events: auto;
  animation: ${CX}-fade .14s ease-out;
}
@keyframes ${CX}-fade { from { opacity: 0; } to { opacity: 1; } }
.${CX}-about {
  position: relative; width: min(360px, calc(100vw - 48px)); box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center;
  padding: 28px 24px 18px; border-radius: 16px;
  background: ${BG}; border: 1px solid ${BORDER};
  box-shadow: 0 24px 64px var(--mf-shadow, rgba(20,20,19,.08));
  animation: ${CX}-pop .16s ease-out;
}
@keyframes ${CX}-pop {
  from { opacity: 0; transform: translateY(6px) scale(.98); }
  to { opacity: 1; transform: none; }
}
.${CX}-about-close {
  position: absolute; top: 10px; right: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border: 0; border-radius: 8px;
  background: transparent; color: ${TEXT_3}; cursor: pointer;
}
.${CX}-about-close:hover { background: ${HOVER}; color: ${TEXT}; }
.${CX}-about-logo { display: block; width: 56px; height: 56px; border-radius: 14px; }
.${CX}-about-name {
  margin-top: 12px; font-family: ${DISPLAY}; font-size: 20px; font-weight: 400;
  letter-spacing: -.02em; color: ${TEXT};
}
.${CX}-about-id {
  margin-top: 8px; padding: 2px 9px; border-radius: 999px;
  font-family: ${MONO}; font-size: 11px; line-height: 1.4;
  background: ${BG_CARD}; color: ${TEXT_3};
}
.${CX}-about-desc { margin: 13px 0 0; font-size: 12.5px; line-height: 1.7; color: ${TEXT_2}; text-align: center; }
.${CX}-about-links {
  margin-top: 16px; padding-top: 8px; width: 100%;
  border-top: 1px solid ${BORDER};
  display: flex; flex-direction: column;
}
.${CX}-about-link {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px;
  color: ${TEXT_2}; text-decoration: none; font-size: 12.5px;
}
.${CX}-about-link svg { flex: 0 0 auto; color: ${TEXT_3}; }
.${CX}-about-link:hover { background: ${HOVER}; color: ${TEXT}; }
.${CX}-about-link-host { margin-left: auto; font-size: 11px; color: ${TEXT_3}; }
.${CX}-about-link:hover .${CX}-about-link-host { color: ${LINK}; }

/* Icon-only header buttons; meaning rides the tooltip. */
.${CX}-iconbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border-radius: 8px;
  border: 0; background: transparent; color: ${TEXT_2}; cursor: pointer;
}
.${CX}-iconbtn:hover:not(:disabled) { background: ${HOVER}; color: ${TEXT}; }
.${CX}-iconbtn[data-danger="true"]:hover:not(:disabled) { color: ${DANGER}; }
.${CX}-iconbtn:disabled { opacity: .45; cursor: default; }

/* Pipeline stepper: numbered flow tabs, then loose utility tabs. Spec's
   category-tab pattern — quiet until active; the active tab is a cream card,
   not an underline. */
.${CX}-tabs {
  display: flex; align-items: center; gap: 2px;
  padding: 6px 16px; border-bottom: 1px solid ${BORDER};
}
.${CX}-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border: 0;
  background: transparent; color: ${TEXT_3}; font: inherit; font-size: 13px;
  cursor: pointer; border-radius: 8px;
  transition: color .12s ease, background-color .12s ease;
}
.${CX}-tab:hover { background: ${HOVER}; color: ${TEXT}; }
.${CX}-tab[data-active="true"] { background: ${BG_CARD}; color: ${TEXT}; font-weight: 500; }
.${CX}-tab[data-active="true"]:hover { background: ${ACTIVE}; }
.${CX}-tab-step {
  display: inline-flex; align-items: center; justify-content: center;
  width: 17px; height: 17px; border-radius: 50%;
  border: 1px solid ${BORDER}; font-size: 10px; line-height: 1; color: ${TEXT_3};
}
.${CX}-tab[data-done="true"] .${CX}-tab-step {
  border-color: transparent; background: ${BRAND}; color: ${TEXT_INV};
}
.${CX}-tab-sep { width: 1px; height: 16px; margin: 0 8px; background: ${BORDER}; }
.${CX}-tab-badge {
  min-width: 15px; padding: 0 5px; text-align: center;
  border-radius: 999px; font-size: 10px; line-height: 15px; background: ${ACTIVE}; color: ${TEXT_2};
}
.${CX}-tab[data-active="true"] .${CX}-tab-badge { background: ${BG}; }
.${CX}-tab-live { width: 6px; height: 6px; border-radius: 50%; background: ${SUCCESS}; }

/* Body: scrollable; the content column follows the panel's full width so wide
   windows get wide pages instead of a centred strip. Body is a flex column so
   the content can stretch to at least the window height (see data-tab rules
   below); it never shrinks below its natural height, so long pages scroll the
   body exactly as before. */
.${CX}-body { flex: 1 1 auto; overflow: auto; min-height: 0; display: flex; flex-direction: column; }
.${CX}-content {
  flex: 1 0 auto;
  padding: 20px 28px 36px;
  display: flex; flex-direction: column; gap: 12px;
}
.${CX}-cols { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
.${CX}-col { flex: 1 1 380px; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.${CX}-col[data-narrow="true"] { flex: 0 1 340px; }

/* Candidate grid: three cards per row on a standard PC window, stepping down
   to two and then one as the column narrows. The track floor is
   max(260px, a third of the row) — the 260px drives the 3->2->1 collapse, the
   third-of-row term caps the count at three no matter how wide the window gets.
   Grid stretch keeps sibling cards equal-height per row. */
.${CX}-idea-grid {
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, max(260px, calc((100% - 24px) / 3))), 1fr));
  align-items: stretch;
}
.${CX}-idea-grid .${CX}-card { display: flex; flex-direction: column; }
.${CX}-idea-grid .${CX}-card-title { font-size: 13.5px; }
/* -meta (source chip + tags) always renders last, so its auto margin pins the
   card tail to the bottom edge and equal-height rows stay visually aligned. */
.${CX}-idea-grid .${CX}-meta { margin-top: auto; padding-top: 10px; }

/* Cream card: the surface IS the elevation — no border, no shadow (spec).
   Clickable deepens one cream step; selection is the one place a coral line
   appears outside primary CTAs. */
.${CX}-card {
  border: 1px solid transparent; border-radius: 12px; padding: 14px 16px;
  background: ${BG_CARD};
  transition: background-color .12s ease, border-color .12s ease;
}
.${CX}-card[data-clickable="true"] { cursor: pointer; }
.${CX}-card[data-clickable="true"]:hover { background: ${ACTIVE}; }
.${CX}-card[data-active="true"] { border-color: ${BRAND_LINE}; background: ${ACTIVE}; }
.${CX}-card-head { display: flex; align-items: baseline; gap: 8px; }
.${CX}-card-title { font-weight: 500; flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.${CX}-card-text { margin-top: 8px; line-height: 1.65; color: ${TEXT_2}; }

/* Clamped multi-line text with an explicit expand affordance. */
.${CX}-clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.${CX}-expand {
  border: 0; background: transparent; padding: 2px 0; margin-top: 4px;
  color: ${LINK}; font: inherit; font-size: 12px; cursor: pointer; text-align: left;
}
.${CX}-expand:hover { text-decoration: underline; }

/* Pin affordance on a candidate card: quiet until active. */
.${CX}-pinbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border-radius: 7px;
  border: 0; background: transparent; color: ${TEXT_3}; cursor: pointer;
}
.${CX}-pinbtn:hover { background: ${HOVER}; color: ${TEXT}; }
.${CX}-pinbtn[data-pinned="true"] { color: ${BRAND_LINE}; }

/* Definition rows: a quiet two-column grid for 痛点/用户/模式. */
.${CX}-defs { margin-top: 10px; display: flex; flex-direction: column; gap: 5px; }
.${CX}-def { display: flex; gap: 8px; font-size: 12px; line-height: 1.55; }
.${CX}-def-term { flex: 0 0 3em; color: ${TEXT_3}; }
.${CX}-def-desc { flex: 1 1 auto; color: ${TEXT_2}; min-width: 0; }

.${CX}-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
/* Pill badges: canvas fill + hairline so they read on the cream cards that
   carry them; accent stays a coral text, never a coral block. */
.${CX}-chip {
  padding: 2px 9px; border-radius: 999px; font-size: 11px;
  background: ${BG}; border: 1px solid ${BORDER}; color: ${TEXT_2};
}
.${CX}-chip[data-accent="true"] { color: ${BRAND_LINE}; }
.${CX}-chiplink { color: ${LINK}; text-decoration: none; }
.${CX}-chiplink:hover { text-decoration: underline; }

/* Scores: thin proportional bars instead of bare numbers. */
.${CX}-scores { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.${CX}-scorebar { display: flex; align-items: center; gap: 8px; font-size: 11px; color: ${TEXT_3}; }
.${CX}-scorebar-label { flex: 0 0 3em; }
.${CX}-scorebar-track {
  flex: 1 1 auto; height: 4px; border-radius: 2px; background: ${ACTIVE};
  overflow: hidden;
}
.${CX}-scorebar-fill { display: block; height: 100%; border-radius: 2px; background: ${BRAND_LINE}; }
.${CX}-scorebar-fill[data-level="mid"] { opacity: .65; }
.${CX}-scorebar-fill[data-level="low"] { opacity: .35; }
.${CX}-scorebar-num { flex: 0 0 2em; text-align: right; font-variant-numeric: tabular-nums; color: ${TEXT_2}; }

.${CX}-field { display: flex; flex-direction: column; gap: 5px; }
.${CX}-label {
  display: flex; align-items: baseline; gap: 8px;
  font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: ${TEXT_3};
}
.${CX}-label-extra { text-transform: none; letter-spacing: 0; }
.${CX}-label-extra .${CX}-btn { padding: 1px 7px; font-size: 11px; }
.${CX}-input, .${CX}-area, .${CX}-select {
  width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 8px;
  border: 1px solid ${BORDER}; background: ${BG}; color: ${TEXT};
  font: inherit; font-size: 13px;
}
/* Form controls follow their column but stop short of absurd line lengths on
   very wide windows; free-standing editors (the build brief) stay full width. */
.${CX}-field .${CX}-input, .${CX}-field .${CX}-select, .${CX}-field .${CX}-area { max-width: 760px; }
/* Form focus is the spec's input-focused state: coral border plus a 3px
   coral-at-15% outer ring. No default outline — the ring is the focus. */
.${CX}-input:focus, .${CX}-area:focus, .${CX}-select:focus {
  outline: none; border-color: ${BRAND_LINE};
  box-shadow: 0 0 0 3px rgba(204,120,92,.15);
}
.${CX}-area { resize: vertical; min-height: 80px; line-height: 1.65; }
.${CX}-area[data-mono="true"] { font-family: ${MONO}; font-size: 12px; }
.${CX}-hint { font-size: 12px; color: ${TEXT_3}; line-height: 1.5; }

.${CX}-btn {
  padding: 6px 14px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12.5px;
  font-weight: 500;
  border: 1px solid ${BORDER}; background: ${BG}; color: ${TEXT};
  transition: background-color .12s ease, border-color .12s ease, color .12s ease;
}
.${CX}-btn:hover:not(:disabled) { background: ${HOVER}; }
/* Primary is the coral CTA: coral fill, white text, darkens on press — the
   hover state the spec encodes; nothing else changes. */
.${CX}-btn[data-variant="primary"] { border-color: transparent; background: ${BRAND}; color: ${TEXT_INV}; }
.${CX}-btn[data-variant="primary"]:hover:not(:disabled) { background: ${BRAND_HOVER}; }
.${CX}-btn[data-variant="primary"]:disabled {
  background: var(--mf-primary-disabled, #e6dfd8); color: var(--mf-muted-soft, #8e8b82); opacity: 1;
}
.${CX}-btn[data-variant="danger"] { color: ${DANGER}; }
.${CX}-btn[data-variant="danger"]:hover:not(:disabled) { background: ${HOVER}; }
.${CX}-btn[data-armed="true"] {
  border-color: ${DANGER}; color: ${DANGER}; background: ${BG};
}
.${CX}-btn:disabled { opacity: .45; cursor: default; }
.${CX}-btn-icon { display: inline-flex; margin-right: 5px; vertical-align: -2px; }
.${CX}-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* Settings save bar: sticky above the scroll edge so it never scrolls away.
   Negative margins mirror the content column's padding; actions sit at the
   far edge like a conventional form footer. */
.${CX}-savebar {
  position: sticky; bottom: 0; z-index: 2;
  display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap;
  margin: 8px -28px -36px; padding: 12px 28px 20px;
  background: linear-gradient(to top, ${BG} 78%, transparent);
}

/* Settings flow: group cards auto-balance across as many columns as the
   panel fits (max 2, each at least 380px), so neither side strands blank
   space no matter which groups are expanded. */
.${CX}-flow { columns: 380px 2; column-gap: 24px; }
.${CX}-flow > * {
  break-inside: avoid; margin: 0 0 12px;
}

.${CX}-note { color: ${TEXT_3}; padding: 10px 2px; line-height: 1.65; }
.${CX}-err {
  color: ${DANGER}; padding: 10px 12px; line-height: 1.6;
  background: transparent;
  border: 1px solid ${BORDER}; border-left: 3px solid ${DANGER};
  border-radius: 0 8px 8px 0;
}
.${CX}-ok { padding: 10px 12px; border-radius: 8px; line-height: 1.6; background: ${BG_SUNKEN}; color: ${TEXT_2}; }
.${CX}-stale {
  padding: 5px 16px; font-size: 12px; color: var(--mf-amber, #b8860b);
  background: ${BG_SUNKEN}; border-bottom: 1px solid ${BORDER};
}

/* First-load skeleton. */
.${CX}-skeleton { display: flex; flex-direction: column; gap: 12px; padding: 8px 2px; }
.${CX}-skeleton-bar {
  height: 14px; border-radius: 7px;
  background: linear-gradient(90deg, ${BG_SUNKEN} 25%, ${ACTIVE} 50%, ${BG_SUNKEN} 75%);
  background-size: 200% 100%;
  animation: ${CX}-shimmer 1.4s ease infinite;
  width: calc(var(--w, 60) * 1%);
}
.${CX}-skeleton-bar[data-w="38"] { --w: 38; }
.${CX}-skeleton-bar[data-w="86"] { --w: 86; }
.${CX}-skeleton-bar[data-w="64"] { --w: 64; }
@keyframes ${CX}-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

/* Full empty state: glyph, sentence, next action. */
.${CX}-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 48px 16px; color: ${TEXT_3}; text-align: center;
}
.${CX}-empty-title { font-size: 13px; font-weight: 500; color: ${TEXT_2}; }
.${CX}-empty-hint { font-size: 12px; line-height: 1.6; max-width: 40em; }
.${CX}-empty .${CX}-btn { margin-top: 8px; }

/* Code/log chrome: the spec's dark product surface. Terminal output is dark in
   BOTH themes — it is the cream page's pacing accent, matching the shell's own
   dark code blocks. */
.${CX}-pre {
  margin: 0; padding: 14px 16px; border-radius: 12px; overflow: auto; max-height: 420px;
  border: 0; background: ${CODE_BG}; color: ${ON_DARK};
  font-family: ${MONO}; font-size: 12px; line-height: 1.65;
  white-space: pre-wrap; word-break: break-word;
}
/* Selection inside dark chrome keeps the coral accent readable. */
.${CX}-pre::selection { background: rgba(204,120,92,.4); }
.${CX}-pre[data-log="true"] { max-height: 260px; }
/* The plan stage's live progress log is the page's primary content while waiting. */
.${CX}-pre[data-planlog="true"] { max-height: 480px; }
.${CX}-logbar { display: flex; align-items: center; gap: 10px; font-size: 12px; color: ${TEXT_3}; }
.${CX}-check { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
.${CX}-check input { accent-color: ${BRAND_LINE}; margin: 0; }

/* Status badge: dot carries the colour, text stays quiet. */
.${CX}-status {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 9px; border-radius: 10px; font-size: 11px;
  background: transparent; border: 1px solid ${BORDER}; color: ${TEXT_2};
}
.${CX}-status-dot { width: 6px; height: 6px; border-radius: 50%; background: ${TEXT_3}; flex: 0 0 auto; }
.${CX}-status[data-status="running"] .${CX}-status-dot,
.${CX}-status[data-status="starting"] .${CX}-status-dot,
.${CX}-status[data-status="installing"] .${CX}-status-dot {
  background: ${BUSINESS};
  animation: ${CX}-pulse 1.6s ease-in-out infinite;
}
.${CX}-status[data-status="ready"] .${CX}-status-dot { background: ${SUCCESS}; }
.${CX}-status[data-status="failed"] .${CX}-status-dot { background: ${DANGER}; }
.${CX}-status[data-status="running"], .${CX}-status[data-status="starting"], .${CX}-status[data-status="installing"] { color: ${BUSINESS}; }
.${CX}-status[data-status="ready"] { color: ${SUCCESS}; }
.${CX}-status[data-status="failed"] { color: ${DANGER}; }
@keyframes ${CX}-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .3; }
}

.${CX}-elapsed { font-size: 12px; color: ${TEXT_3}; font-variant-numeric: tabular-nums; }

.${CX}-section { font-weight: 500; margin: 12px 0 0; }
.${CX}-group { display: flex; flex-direction: column; gap: 12px; }
.${CX}-details {
  border: 0; border-radius: 12px; background: ${BG_CARD};
}
.${CX}-details > summary {
  cursor: pointer; padding: 12px 16px; font-weight: 500;
  list-style: none; display: flex; align-items: center; gap: 8px; user-select: none;
}
.${CX}-details > summary::-webkit-details-marker { display: none; }
.${CX}-details > summary::after {
  content: '▸'; margin-left: auto; color: ${TEXT_3};
  transition: transform .15s ease;
}
.${CX}-details[open] > summary::after { transform: rotate(90deg); }
.${CX}-details-body { padding: 2px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.${CX}-rows { display: flex; flex-direction: column; gap: 8px; }
.${CX}-row {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  border-radius: 8px; border: 1px solid ${BORDER}; background: ${BG};
}
.${CX}-row-main { flex: 1 1 auto; min-width: 0; }
.${CX}-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${CX}-row-sub { font-size: 12px; color: ${TEXT_3}; margin-top: 2px; }
.${CX}-link { color: ${LINK}; word-break: break-all; }
.${CX}-link:hover { text-decoration: underline; }

/* Markdown container: the shell renderer brings its own typography. Content
   card per spec — canvas fill with a hairline border, the document reads as
   the page's editorial body. It grows with its content — the panel body is the
   page scroller, so the plan document is never squeezed into an inner
   scrollbar. */
.${CX}-md {
  border: 1px solid ${BORDER}; border-radius: 12px; padding: 16px 20px;
  background: ${BG}; font-size: 13px; line-height: 1.7;
}
.${CX}-md > :first-child { margin-top: 0; }
.${CX}-md > :last-child { margin-bottom: 0; }

/* Plan tab: left column takes a third (1:2 against the document), the two stay
   side by side at any panel width, and the row stretches to the tallest of the
   left column and the visible window — exactly max(左栏, 窗口高), because the
   content column already stretches to the body (flex: 1 0 auto) and only ever
   exceeds it when the left column runs taller than the window. */
.${CX}-content[data-tab="plan"] .${CX}-cols { flex-wrap: nowrap; flex: 1 1 auto; align-items: stretch; }
.${CX}-content[data-tab="plan"] .${CX}-col[data-narrow="true"] {
  flex: 0 0 calc((100% - 24px) / 3); min-width: 0;
}
.${CX}-content[data-tab="plan"] .${CX}-col:last-child { flex: 1 1 0; min-height: 0; }
/* The document box is the only stretch child after the toolbar, and the
   document itself is absolutely positioned inside it: absolute content never
   contributes intrinsic height, so the row's height is decided by the left
   column (or the window) alone, never by the document's length. Overflow
   scrolls inside the document — the page does not grow to follow it. */
.${CX}-docbox { position: relative; flex: 1 1 0; min-height: 0; }
.${CX}-docbox .${CX}-md, .${CX}-docbox .${CX}-pre {
  position: absolute; inset: 0; overflow: auto; max-height: none;
}

/* Keyboard reachability: one visible ring for every interactive element. */
.${CX}-btn:focus-visible, .${CX}-iconbtn:focus-visible, .${CX}-tab:focus-visible,
.${CX}-entry:focus-visible, .${CX}-expand:focus-visible, .${CX}-titleinfo:focus-visible,
.${CX}-about-close:focus-visible, .${CX}-about-link:focus-visible {
  outline: 2px solid ${BRAND_LINE}; outline-offset: 1px;
}
.${CX}-card[role="button"]:focus-visible {
  outline: 2px solid ${BRAND_LINE}; outline-offset: 2px;
}
`

/**
 * Inject the stylesheet once.
 * @returns a disposer removing the tag.
 */
export function installStyles(): () => void {
  const marker = `${PLUGIN_ID}/styles`
  const existing = document.querySelector(`style[data-plugin-css="${marker}"]`)
  if (existing !== null) return () => { existing.remove() }
  const tag = document.createElement('style')
  tag.dataset['plugin'] = PLUGIN_ID
  tag.dataset['pluginCss'] = marker
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
