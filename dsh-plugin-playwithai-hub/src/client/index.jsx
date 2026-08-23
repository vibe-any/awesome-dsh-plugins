/**
 * dsh-plugin-playwithai-hub — browser half.
 *
 * Two additive registrations, both defensive (a missing slot declaration is
 * logged and skipped, never fatal to boot):
 *
 * - `sidebar.footer.action` — the left-menu entry: whale logo + label beside
 *   the settings seat; renders icon-only while the sidebar rail is collapsed.
 *   Clicking toggles the hub view.
 * - `shell.overlay` — the hub VIEW: a flush main-area surface that starts at
 *   the sidebar's right edge and fills the rest of the frame (no scrim, no
 *   dialog chrome — it reads as the main interface, not a popup). Header
 *   carries the brand lockup + slogan with the card/list view toggle at its
 *   right; below sit kind-filter chips and a responsive card grid or compact
 *   rows. Clicking an article slides the reading panel in from the RIGHT
 *   edge — its own scroll container with a quick back-to-top control.
 *
 * Data comes straight from the hub's Supabase published rows (anon read key,
 * RLS-protected) with four tables merged by publish date; deployment values
 * are fetched from the host half's config route with baked-in fallbacks.
 *
 * All DOM/runtime wiring failures are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws.
 *
 * @module dsh-plugin-playwithai-hub/client
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_FALLBACKS,
  KIND_ORDER,
  invalidateConfig,
  resolveConfig,
  fetchArticles,
  fetchDetail,
} from './data.js'
import { KIND_META } from '../shared/config.js'
import { renderMarkdown } from './markdown.js'
import { ensureStyles } from './styles.js'

/** Required services: slot registry only (data flows over fetch). */
export const inject = ['slots']

// ---------------------------------------------------------------------------
// Tiny shared store (entry button ↔ view live in different slot trees)
// ---------------------------------------------------------------------------

function createStore(initial) {
  let state = initial
  const subscribers = new Set()
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
      subscribers.forEach(notify => notify(state))
    },
    subscribe(notify) {
      subscribers.add(notify)
      return () => subscribers.delete(notify)
    },
  }
}

const VIEW_KEY = 'pwa-hub.view'
const ORIGIN_KEY = 'pwa-hub.siteOrigin'
const API_KEY_KEY = 'pwa-hub.apiKey'

function storedView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'card'
  } catch {
    return 'card'
  }
}

function originOverride() {
  try {
    return localStorage.getItem(ORIGIN_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Plugin-settings API key (localStorage); wins over the host-delivered one. */
function apiKeyOverride() {
  try {
    return localStorage.getItem(API_KEY_KEY) ?? ''
  } catch {
    return ''
  }
}

function storeApiKey(value) {
  try {
    if (value) localStorage.setItem(API_KEY_KEY, value)
    else localStorage.removeItem(API_KEY_KEY)
  } catch (cause) {
    console.warn('[pwa-hub] failed to persist API key:', cause)
  }
}

const store = createStore({
  open: false,
  view: storedView(),
  kindFilter: 'all',
  config: DEFAULT_FALLBACKS,
  articles: undefined, // undefined = loading
  error: undefined,
  selectedId: undefined,
  expanded: false, // fullscreen reading (detail replaces the list area)
  settingsOpen: false,
})

/** Articles visible under the current kind filter — shared by list + prev/next. */
function filterArticles(articles, kindFilter) {
  return (articles ?? []).filter(article => kindFilter === 'all' || article.kind === kindFilter)
}

const actions = {
  toggleOpen: () => {
    const next = !store.get().open
    store.set({ open: next, ...(next ? {} : { selectedId: undefined, settingsOpen: false, expanded: false }) })
    if (next) void ensureArticles()
  },
  close: () => store.set({ open: false, selectedId: undefined, settingsOpen: false, expanded: false }),
  closeDetail: () => store.set({ selectedId: undefined, expanded: false }),
  select: id => store.set({ selectedId: id, expanded: false }),
  toggleExpanded: () => store.set({ expanded: !store.get().expanded }),
  /** Step to the previous/next article within the filtered list (fullscreen reading). */
  stepArticle: delta => {
    const s = store.get()
    if (s.selectedId === undefined) return
    const list = filterArticles(s.articles, s.kindFilter)
    const index = list.findIndex(article => article.id === s.selectedId)
    if (index === -1) return
    const target = list[index + delta]
    if (target !== undefined) store.set({ selectedId: target.id })
  },
  setView: view => {
    store.set({ view })
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      /* persistence is best-effort */
    }
  },
  setKindFilter: kindFilter => store.set({ kindFilter }),
  toggleSettings: () => store.set({ settingsOpen: !store.get().settingsOpen }),
}

let articlesPromise = null

/** Load config + articles once; safe to call repeatedly. */
async function ensureArticles() {
  if (articlesPromise !== null) return articlesPromise
  store.set({ articles: undefined, error: undefined })
  articlesPromise = (async () => {
    try {
      const config = await resolveConfig(originOverride(), apiKeyOverride())
      store.set({ config })
      const articles = await fetchArticles(config)
      store.set({ articles })
    } catch (cause) {
      console.error('[pwa-hub] loading articles failed:', cause)
      store.set({ error: String(cause?.message ?? cause) })
    } finally {
      articlesPromise = null
    }
  })()
  return articlesPromise
}

/** Persist an API key change and reload data with the new credential. */
function applyApiKeyChange(value) {
  storeApiKey(value.trim())
  invalidateConfig()
  detailCache.clear()
  articlesPromise = null
  store.set({ settingsOpen: false, error: undefined })
  if (store.get().open) void ensureArticles()
}

/** Subscribe a component to the shared store. */
function useHubStore() {
  const [snapshot, setSnapshot] = useState(store.get)
  useEffect(() => store.subscribe(next => setSnapshot(next)), [])
  return snapshot
}

// ---------------------------------------------------------------------------
// Styling primitives (CSS variables follow the DSH web theme)
// ---------------------------------------------------------------------------

const C = {
  /** App-background token: makes the hub read as a main-area page. */
  pageBg: 'var(--dsw-alias-bg-base, #12161f)',
  panelBg: 'var(--dsw-specific-tip, #1e2533)',
  surfaceSoft: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))',
  border: 'var(--dsw-alias-border-l1, rgba(128,128,128,0.3))',
  borderSoft: 'var(--dsw-alias-border-l2, rgba(128,128,128,0.18))',
  label: 'var(--dsw-alias-label-primary, #e6ebf2)',
  label2: 'var(--dsw-alias-label-secondary, #c9d2e0)',
  label3: 'var(--dsw-alias-label-tertiary, #8a94a6)',
  accent: 'var(--dsw-alias-label-primary-bluish, #4cc9f0)',
}

const KIND_TINT = {
  original: '#4cc9f0',
  'open-source': '#5ad19c',
  tech: '#b48cf2',
  practice: '#f2b04c',
}

const sx = (...parts) => Object.assign({}, ...parts.filter(Boolean))

// ---------------------------------------------------------------------------
// Icons (slim inline SVG, no asset dependency)
// ---------------------------------------------------------------------------

function IconClose(props) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" {...props}>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}
function IconRows(props) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" {...props}>
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
function IconGrid(props) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" {...props}>
      <rect x="2" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
function IconArrow(props) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" {...props}>
      <path d="M4 12L12 4M6.5 4H12v5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}
function IconTop(props) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" {...props}>
      <path d="M3 10l5-5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M3 13.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function IconGear(props) {
  // 标准「设置」齿轮造型：外圈齿冠 + 中轴孔（此前的圆点+分离放射线视觉上像太阳）
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" {...props}>
      <path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        stroke="currentColor"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" fill="none" />
    </svg>
  )
}
function IconExpand(props) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" {...props}>
      <path
        d="M9.5 2H14v4.5M14 2L9.2 6.8M6.5 14H2V9.5M2 14l4.8-4.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
function IconCollapse(props) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" {...props}>
      <path
        d="M14 6.5H9.5V2M9.7 6.3L14 2M2 9.5h4.5V14M6.3 9.7L2 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
function IconChevron({ dir = 'left' }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
function WhaleMark({ size = 22 }) {
  return (
    <img
      src={store.get().config.logoUrl}
      alt=""
      width={size}
      height={size}
      decoding="async"
      style={{ borderRadius: Math.round(size * 0.28), objectFit: 'cover', display: 'block' }}
    />
  )
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })

function formatDate(iso) {
  const date = new Date(iso ?? '')
  if (Number.isNaN(date.getTime())) return ''
  return dateFormatter.format(date)
}

function kindTint(kind) {
  return KIND_TINT[kind] ?? C.accent
}

/** Site deep link for an article, or null when no origin is configured. */
function siteLink(config, article) {
  const origin = String(config.siteOrigin ?? '').replace(/\/+$/, '')
  if (!origin) return null
  const path = KIND_META[article.kind]?.path
  if (!path) return null
  return `${origin}/${path}/${article.slug}`
}

// ---------------------------------------------------------------------------
// Shared small parts
// ---------------------------------------------------------------------------

function KindChip({ kind }) {
  const tint = kindTint(kind)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.02em',
        color: tint,
        background: 'color-mix(in srgb, currentColor 14%, transparent)',
        border: '1px solid color-mix(in srgb, currentColor 34%, transparent)',
        whiteSpace: 'nowrap',
      }}
    >
      {KIND_META[kind]?.label ?? kind}
    </span>
  )
}

function CoverImage({ src, alt, style }) {
  const [failed, setFailed] = useState(false)
  const resolved = !failed && src ? src : DEFAULT_FALLBACKS.defaultCover
  return (
    <img
      src={resolved}
      alt={alt ?? ''}
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      onError={() => setFailed(true)}
      style={sx({ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }, style)}
    />
  )
}

function ArticleMeta({ article }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.label3 }}>
      {article.author ? <span>{article.author}</span> : null}
      {article.author ? <span style={{ opacity: 0.55 }}>·</span> : null}
      <span>{formatDate(article.publishedAt)}</span>
    </span>
  )
}

/**
 * Floating quick-back-to-top control for a scroll container. Renders nothing
 * until the container has scrolled past ~260px; smooth-scrolls to top.
 */
function BackToTop({ targetRef, offsetRight = 18 }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = targetRef.current
    if (el === null) return undefined
    const onScroll = () => setVisible(el.scrollTop > 260)
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [targetRef])
  if (!visible) return null
  return (
    <button
      type="button"
      title="回到顶部"
      aria-label="回到顶部"
      onClick={() => {
        const el = targetRef.current
        if (el !== null) el.scrollTo({ top: 0, behavior: 'smooth' })
      }}
      style={{
        position: 'absolute',
        right: offsetRight,
        bottom: 18,
        width: 34,
        height: 34,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        border: `1px solid ${C.border}`,
        background: C.panelBg,
        color: C.label2,
        cursor: 'pointer',
        boxShadow: '0 6px 18px rgba(0,0,0,.35)',
        zIndex: 5,
      }}
    >
      <IconTop />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Left-menu entry (sidebar.footer.action)
// ---------------------------------------------------------------------------

function HubEntryButton({ wide }) {
  const snapshot = useHubStore()
  const active = snapshot.open
  return (
    <button
      type="button"
      onClick={actions.toggleOpen}
      title="PlayWithAI资源站 · 文章浏览"
      aria-label="打开 PlayWithAI资源站"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: wide ? '100%' : 32,
        height: 32,
        justifyContent: wide ? 'flex-start' : 'center',
        padding: wide ? '0 8px' : 0,
        border: `1px solid ${active ? kindTint('tech') : 'transparent'}`,
        borderRadius: 9,
        background: active ? C.surfaceSoft : 'transparent',
        color: active ? C.label : C.label2,
        cursor: 'pointer',
        transition: 'background .15s ease, color .15s ease',
      }}
      onMouseEnter={event => {
        if (!active) event.currentTarget.style.background = C.surfaceSoft
      }}
      onMouseLeave={event => {
        if (!active) event.currentTarget.style.background = 'transparent'
      }}
    >
      <WhaleMark size={20} />
      {wide ? <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>PlayWithAI资源站</span> : null}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Article surfaces
// ---------------------------------------------------------------------------

function CardItem({ article, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(article.id)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        textAlign: 'left',
        overflow: 'hidden',
        border: `1px solid ${C.borderSoft}`,
        borderRadius: 14,
        background: C.panelBg,
        padding: 0,
        cursor: 'pointer',
        color: C.label,
        transition: 'border-color .15s ease, transform .15s ease',
      }}
      onMouseEnter={event => {
        event.currentTarget.style.borderColor = kindTint(article.kind)
        event.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={event => {
        event.currentTarget.style.borderColor = C.borderSoft
        event.currentTarget.style.transform = 'none'
      }}
    >
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: C.surfaceSoft }}>
        <CoverImage src={article.coverUrl} alt="" />
        <span style={{ position: 'absolute', top: 8, left: 8 }}>
          <KindChip kind={article.kind} />
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px 12px' }}>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            lineHeight: '19px',
            maxHeight: 38,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {article.title}
        </span>
        <span
          style={{
            fontSize: 12,
            lineHeight: '17px',
            color: C.label3,
            maxHeight: 34,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {article.excerpt}
        </span>
        <ArticleMeta article={article} />
      </div>
    </button>
  )
}

/**
 * Waterfall (masonry) grid: every card is measured at the real column width,
 * then placed under the currently-shortest column, so vertical gaps stay
 * exactly `gap` px everywhere while column bottoms stagger naturally.
 * Falls back to round-robin distribution until the first measurement lands.
 */
function MasonryGrid({ items, renderItem, gap = 14, minColWidth = 238 }) {
  const wrapRef = useRef(null)
  const measureRef = useRef(null)
  const measuredSig = useRef('')
  const [width, setWidth] = useState(0)
  const [heights, setHeights] = useState([])

  // Sync width before first paint, then track resizes.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (el !== null && el.clientWidth > 0) setWidth(el.clientWidth)
  }, [])
  useEffect(() => {
    const el = wrapRef.current
    if (el === null) return undefined
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const count = items.length
  const cols = Math.max(1, Math.min(count || 1, Math.floor((width + gap) / (minColWidth + gap))))
  const colWidth = width > 0 ? Math.floor((width - gap * (cols - 1)) / cols) : 0

  // Measure only when the item set or column count actually changed.
  const signature = `${count}|${cols}|${items.map(article => article.id).join(',')}`
  const needsMeasure = width > 0 && colWidth > 0 && measuredSig.current !== signature

  useLayoutEffect(() => {
    if (!needsMeasure) return
    const layer = measureRef.current
    if (layer === null || layer.children.length !== count) return
    const next = []
    for (const node of layer.children) next.push(node.offsetHeight)
    measuredSig.current = signature
    setHeights(next)
  })

  // Shortest-column-first placement keeps near-chronological reading order.
  const columns = useMemo(() => {
    const buckets = Array.from({ length: cols }, () => [])
    const fills = new Array(cols).fill(0)
    const measured = heights.length === count && count > 0
    items.forEach((item, index) => {
      let target
      if (measured) {
        target = 0
        for (let c = 1; c < cols; c += 1) if (fills[c] < fills[target]) target = c
      } else {
        target = index % cols
      }
      buckets[target].push(item)
      if (measured) fills[target] += heights[index] + gap
    })
    return buckets
  }, [items, cols, heights, gap, count])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {needsMeasure ? (
        <div
          ref={measureRef}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -99999,
            top: 0,
            width: colWidth,
            visibility: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {items.map(article => (
            <div key={article.id}>{renderItem(article)}</div>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap }}>
        {columns.map((bucket, index) => (
          <div
            key={index}
            style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap }}
          >
            {bucket.map(article => renderItem(article))}
          </div>
        ))}
      </div>
    </div>
  )
}

function ListItem({ article, onSelect }) {  return (
    <button
      type="button"
      onClick={() => onSelect(article.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        textAlign: 'left',
        width: '100%',
        padding: '10px 14px',
        border: 'none',
        background: 'transparent',
        color: C.label,
        cursor: 'pointer',
      }}
      onMouseEnter={event => {
        event.currentTarget.style.background = C.surfaceSoft
      }}
      onMouseLeave={event => {
        event.currentTarget.style.background = 'transparent'
      }}
    >
      <div style={{ width: 104, aspectRatio: '16 / 10', borderRadius: 10, overflow: 'hidden', flex: 'none', background: C.surfaceSoft }}>
        <CoverImage src={article.coverUrl} alt="" />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: '19px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {article.title}
        </span>
        <span style={{ fontSize: 12, color: C.label3, lineHeight: '17px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {article.excerpt}
        </span>
        <ArticleMeta article={article} />
      </div>
      <KindChip kind={article.kind} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Right slide-in reading panel
// ---------------------------------------------------------------------------

const detailCache = new Map()

async function loadDetail(config, article) {
  const cached = detailCache.get(article.id)
  if (cached !== undefined) return cached
  const detail = await fetchDetail(config, article)
  detailCache.set(article.id, detail)
  return detail
}

function ReadingPanel({ snapshot, expanded = false }) {
  const { config, articles, selectedId, kindFilter } = snapshot
  const summary = useMemo(
    () => (articles ?? []).find(article => article.id === selectedId) ?? null,
    [articles, selectedId],
  )
  const list = useMemo(() => filterArticles(articles, kindFilter), [articles, kindFilter])
  const index = summary !== null ? list.findIndex(article => article.id === summary.id) : -1
  const position = index >= 0 ? index + 1 : 0
  const hasPrev = index > 0
  const hasNext = index >= 0 && index < list.length - 1
  const [detail, setDetail] = useState(undefined)
  const [error, setError] = useState(undefined)
  const bodyRef = useRef(null)

  useEffect(() => {
    setDetail(undefined)
    setError(undefined)
    // Fresh article → start at the top of a fresh scroll.
    if (bodyRef.current !== null) bodyRef.current.scrollTop = 0
    if (summary === null) return undefined
    let alive = true
    void loadDetail(config, summary)
      .then(row => {
        if (alive) setDetail(row)
      })
      .catch(cause => {
        console.error('[pwa-hub] detail load failed:', cause)
        if (alive) setError(String(cause?.message ?? cause))
      })
    return () => {
      alive = false
    }
  }, [config, summary])

  const visible = summary !== null
  const link = visible && summary ? siteLink(config, summary) : null
  const githubLink = visible && summary?.githubUrl ? summary.githubUrl : null
  const externalLink = visible && summary?.externalUrl ? summary.externalUrl : null

  return (
    <aside
      aria-hidden={!visible}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: expanded ? '100%' : 'min(532px, 52%)',
        display: 'flex',
        flexDirection: 'column',
        background: C.pageBg,
        borderLeft: expanded ? 'none' : `1px solid ${C.borderSoft}`,
        boxShadow: visible && !expanded ? '-28px 0 60px rgba(0,0,0,.38)' : 'none',
        transform: visible ? 'translateX(0)' : 'translateX(103%)',
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'transform .26s cubic-bezier(.2,.7,.3,1), width .26s cubic-bezier(.2,.7,.3,1)',
        zIndex: 4,
      }}
    >
      {visible && summary ? (
        <>
          {/* fullscreen reading toolbar: prev / position / next + restore + close.
              No cover image in this mode — the whole viewport belongs to content. */}
          {expanded ? (
            <div
              style={{
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 16px',
                borderBottom: `1px solid ${C.borderSoft}`,
                background: C.panelBg,
              }}
            >
              <button
                type="button"
                onClick={() => actions.stepArticle(-1)}
                disabled={!hasPrev}
                title="上一篇文章（←）"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  height: 26,
                  padding: '0 10px',
                  borderRadius: 8,
                  border: `1px solid ${C.borderSoft}`,
                  background: C.panelBg,
                  color: hasPrev ? C.label2 : C.label3,
                  cursor: hasPrev ? 'pointer' : 'default',
                  opacity: hasPrev ? 1 : 0.55,
                  fontSize: 12,
                }}
              >
                <IconChevron dir="left" />
                上一篇
              </button>
              <span style={{ fontSize: 11.5, color: C.label3, fontVariantNumeric: 'tabular-nums' }}>
                {position} / {list.length}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => actions.stepArticle(1)}
                disabled={!hasNext}
                title="下一篇文章（→）"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  height: 26,
                  padding: '0 10px',
                  borderRadius: 8,
                  border: `1px solid ${C.borderSoft}`,
                  background: C.panelBg,
                  color: hasNext ? C.label2 : C.label3,
                  cursor: hasNext ? 'pointer' : 'default',
                  opacity: hasNext ? 1 : 0.55,
                  fontSize: 12,
                }}
              >
                下一篇
                <IconChevron dir="right" />
              </button>
              <span style={{ width: 1, height: 16, background: C.borderSoft }} aria-hidden="true" />
              <button
                type="button"
                onClick={() => actions.toggleExpanded()}
                title="还原为右侧阅读栏（Esc）"
                aria-label="还原为右侧阅读栏"
                style={{
                  width: 27,
                  height: 27,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.panelBg,
                  color: C.label2,
                  cursor: 'pointer',
                }}
              >
                <IconCollapse />
              </button>
              <button
                type="button"
                onClick={() => actions.closeDetail()}
                title="收起文章（Esc）"
                aria-label="收起文章"
                style={{
                  width: 27,
                  height: 27,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.panelBg,
                  color: C.label2,
                  cursor: 'pointer',
                }}
              >
                <IconClose />
              </button>
            </div>
          ) : (
            <>
              {/* fixed head: cover (side-panel mode only) */}
              <div style={{ flex: 'none', position: 'relative', borderBottom: `1px solid ${C.borderSoft}` }}>
                <div style={{ height: 168, background: C.surfaceSoft }}>
                  <CoverImage src={summary.coverUrl} alt="" />
                </div>
                <button
                  type="button"
                  onClick={() => actions.toggleExpanded()}
                  title="全屏阅读"
                  aria-label="全屏阅读"
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 45,
                    width: 27,
                    height: 27,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: C.panelBg,
                    color: C.label2,
                    cursor: 'pointer',
                  }}
                >
                  <IconExpand />
                </button>
                <button
                  type="button"
                  onClick={() => actions.closeDetail()}
                  title="收起文章（Esc）"
                  aria-label="收起文章"
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    width: 27,
                    height: 27,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: C.panelBg,
                    color: C.label2,
                    cursor: 'pointer',
                  }}
                >
                  <IconClose />
                </button>
              </div>
            </>
          )}
          {/* scrolling body */}
          <div ref={bodyRef} style={{ position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div style={{ padding: '16px 24px 28px', ...(expanded ? { maxWidth: 820, margin: '0 auto' } : {}) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <KindChip kind={summary.kind} />
                <span style={{ fontSize: 11.5, color: C.label3 }}>{formatDate(summary.publishedAt)}</span>
              </div>
              <h2 style={{ margin: '0 0 6px', fontSize: 20, lineHeight: '28px', fontWeight: 650, color: C.label }}>{summary.title}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 12, color: C.label3 }}>
                {summary.author ? <span>{summary.author}</span> : null}
                {summary.author ? <span>·</span> : null}
                <span>PlayWithAI资源站</span>
              </div>
              {(summary.tagSlugs ?? []).length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {summary.tagSlugs.map(tag => (
                    <span
                      key={tag}
                      style={{ fontSize: 11, color: C.label2, padding: '2px 8px', borderRadius: 999, border: `1px solid ${C.borderSoft}` }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {link !== null || githubLink !== null || externalLink !== null ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  {link !== null ? (
                    <a className="pwa-linkbtn" href={link} target="_blank" rel="noopener noreferrer">
                      在站点查看 <IconArrow />
                    </a>
                  ) : null}
                  {githubLink !== null ? (
                    <a className="pwa-linkbtn" href={githubLink} target="_blank" rel="noopener noreferrer">
                      GitHub <IconArrow />
                    </a>
                  ) : null}
                  {externalLink !== null ? (
                    <a className="pwa-linkbtn" href={externalLink} target="_blank" rel="noopener noreferrer">
                      原文链接 <IconArrow />
                    </a>
                  ) : null}
                </div>
              ) : null}
              {error !== undefined ? (
                <p style={{ fontSize: 12.5, color: C.label3 }}>正文加载失败：{error}</p>
              ) : detail === undefined ? (
                <p style={{ fontSize: 12.5, color: C.label3 }}>正文加载中…</p>
              ) : (
                <div
                  className="pwa-md"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.contentMd) }}
                  style={{
                    fontSize: expanded ? 15.5 : 14.5,
                    lineHeight: expanded ? '28px' : '26px',
                    color: C.label2,
                    wordBreak: 'break-word',
                  }}
                />
              )}
            </div>
          </div>
          <BackToTop targetRef={bodyRef} offsetRight={20} />
        </>
      ) : null}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Hub main-area view (shell.overlay occupant)
// ---------------------------------------------------------------------------

/**
 * Width of the layout's sidebar column in px (0-safe fallback). Reads the
 * AppFrame grid: `[data-shell-overlay]`'s parent carries
 * `grid-template-columns: <sidebar>px minmax(0,1fr) <details>px`, so the live
 * value — including drag-resize and collapse — is one parse away.
 */
function measureSidebarWidth(frameEl) {
  try {
    if (frameEl === null) return 0
    const first = Number.parseFloat(frameEl.style?.gridTemplateColumns ?? '')
    return Number.isFinite(first) ? first : 0
  } catch {
    return 0
  }
}

/** Track the live sidebar column width while the hub view is open. */
function useSidebarWidth(enabled) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    let observer = null
    try {
      const frame = document.querySelector('[data-shell-overlay]')?.parentElement ?? null
      if (frame === null) {
        console.warn('[pwa-hub] app frame not found; hub view anchors to the viewport left edge')
        setWidth(0)
        return undefined
      }
      const update = () => setWidth(measureSidebarWidth(frame))
      update()
      observer = new ResizeObserver(update)
      observer.observe(frame)
      if (frame.children[0] !== undefined) observer.observe(frame.children[0])
      window.addEventListener('resize', update)
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', update)
      }
    } catch (cause) {
      console.warn('[pwa-hub] sidebar measurement failed:', cause)
      setWidth(0)
      return undefined
    }
  }, [enabled])
  return width
}

function ViewToggle({ view }) {
  const segment = (value, label, icon) => (
    <button
      type="button"
      onClick={() => actions.setView(value)}
      title={label}
      aria-pressed={view === value}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 26,
        padding: '0 10px',
        border: 'none',
        borderRadius: 8,
        fontSize: 12,
        cursor: 'pointer',
        color: view === value ? C.label : C.label3,
        background: view === value ? C.surfaceSoft : 'transparent',
      }}
    >
      {icon}
      {label}
    </button>
  )
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 2, borderRadius: 10, border: `1px solid ${C.borderSoft}` }}>
      {segment('card', '卡片', <IconGrid />)}
      {segment('list', '列表', <IconRows />)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plugin settings: read-API key management (localStorage-backed)
// ---------------------------------------------------------------------------

function SettingsPopover({ hasHostKey }) {
  const [value, setValue] = useState(apiKeyOverride())
  const local = apiKeyOverride()
  const status = local ? '已保存在本机' : hasHostKey ? '管理员已统一配置' : '未配置'
  return (
    <div
      role="dialog"
      aria-label="API 密钥设置"
      style={{
        position: 'absolute',
        top: 38,
        right: 0,
        width: 330,
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        background: C.panelBg,
        boxShadow: '0 18px 44px rgba(0,0,0,.4)',
        zIndex: 9,
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        textAlign: 'left',
      }}
    >
      <strong style={{ fontSize: 13, fontWeight: 650, color: C.label }}>API 密钥</strong>
      <span style={{ fontSize: 11.5, lineHeight: '17px', color: C.label3 }}>
        填写管理员分配的 token，保存在本地浏览器即可工作。
      </span>
      <input
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && value.trim()) applyApiKeyChange(value)
          if (event.key === 'Escape') actions.toggleSettings()
        }}
        placeholder="pwai_…"
        spellCheck={false}
        autoComplete="off"
        style={{
          height: 30,
          padding: '0 10px',
          borderRadius: 8,
          border: `1px solid ${C.border}`,
          background: C.pageBg,
          color: C.label,
          fontSize: 12,
          outline: 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 10.5, color: C.label3 }}>{status}</span>
        <button
          type="button"
          onClick={() => {
            setValue('')
            applyApiKeyChange('')
          }}
          style={{ height: 26, padding: '0 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.label2, cursor: 'pointer', fontSize: 12 }}
        >
          清除
        </button>
        <button
          type="button"
          onClick={() => applyApiKeyChange(value)}
          disabled={!value.trim()}
          style={{
            height: 26,
            padding: '0 14px',
            borderRadius: 8,
            border: 'none',
            // Literal colors: theme label vars can resolve dark, which made the
            // button read as black-on-black. Cyan bg + near-black text always.
            background: '#4cc9f0',
            color: '#06202c',
            fontWeight: 650,
            cursor: value.trim() ? 'pointer' : 'default',
            fontSize: 12,
            opacity: value.trim() ? 1 : 0.55,
          }}
        >
          保存并重载
        </button>
      </div>
    </div>
  )
}

function KindFilterBar({ value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {KIND_ORDER.map(kind => {
        const active = value === kind
        return (
          <button
            key={kind}
            type="button"
            onClick={() => actions.setKindFilter(kind)}
            style={{
              height: 24,
              padding: '0 10px',
              borderRadius: 999,
              fontSize: 11.5,
              cursor: 'pointer',
              border: `1px solid ${active ? kindTint(kind === 'all' ? 'tech' : kind) : C.borderSoft}`,
              background: active ? C.surfaceSoft : 'transparent',
              color: active ? C.label : C.label3,
            }}
          >
            {KIND_META[kind].label}
          </button>
        )
      })}
    </div>
  )
}

function StatusHint({ text, retry }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: C.label3, fontSize: 13 }}>
      <span>{text}</span>
      {retry ? (
        <button
          type="button"
          onClick={() => {
            store.set({ error: undefined })
            void ensureArticles()
          }}
          style={{ height: 26, padding: '0 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.label2, cursor: 'pointer', fontSize: 12 }}
        >
          重试
        </button>
      ) : null}
    </div>
  )
}

function HubView() {
  const snapshot = useHubStore()
  const open = snapshot.open
  const sidebarWidth = useSidebarWidth(open)
  const listRef = useRef(null)

  // Keys: Esc folds inward (settings popover → fullscreen reading → side panel
  // → close); in fullscreen reading, ←/→ step through the filtered list.
  useEffect(() => {
    if (!open) return undefined
    const onKey = event => {
      const target = event.target
      const typing =
        target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true)
      if (!typing && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const s = store.get()
        if (s.open && s.expanded && s.selectedId !== undefined) {
          event.preventDefault()
          actions.stepArticle(event.key === 'ArrowLeft' ? -1 : 1)
        }
        return
      }
      if (event.key !== 'Escape') return
      const s = store.get()
      if (s.settingsOpen) actions.toggleSettings()
      else if (s.expanded && s.selectedId !== undefined) actions.toggleExpanded()
      else if (s.selectedId !== undefined) actions.closeDetail()
      else actions.close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const { view, kindFilter, articles, error, selectedId, expanded, settingsOpen } = snapshot
  const filtered = filterArticles(articles, kindFilter)
  const detailOpen = selectedId !== undefined
  const readingExpanded = expanded && detailOpen && (articles ?? []).some(article => article.id === selectedId)

  return (
    <div aria-label="PlayWithAI资源站" style={{ position: 'fixed', inset: 0, zIndex: 30, pointerEvents: 'none' }}>
      {/* Flush main-area surface: starts at the sidebar's right edge. */}
      <section
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: Math.max(sidebarWidth, 0),
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          background: C.pageBg,
          pointerEvents: 'auto',
          animation: 'pwaHubIn .18s ease',
        }}
      >
        {/* header: brand lockup + slogan | view toggle + close */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 20px',
            height: 56,
            flex: 'none',
            borderBottom: `1px solid ${C.borderSoft}`,
          }}
        >
          <WhaleMark size={26} />
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }}>
            <strong style={{ fontSize: 15, fontWeight: 700, color: C.label }}>PlayWithAI</strong>
            <small style={{ fontSize: 12, color: C.label2 }}>资源站</small>
          </span>
          <span style={{ width: 1, height: 18, background: C.borderSoft }} aria-hidden="true" />
          <span style={{ fontSize: 12, color: C.label3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            把好内容，留给想做事的人
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => actions.toggleSettings()}
              title="API 密钥设置"
              aria-label="API 密钥设置"
              aria-expanded={settingsOpen}
              style={{
                width: 28,
                height: 28,
                marginRight: 6,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 9,
                border: `1px solid ${settingsOpen ? kindTint('tech') : C.borderSoft}`,
                background: settingsOpen ? C.surfaceSoft : 'transparent',
                color: C.label2,
                cursor: 'pointer',
              }}
            >
              <IconGear />
            </button>
            {settingsOpen ? <SettingsPopover hasHostKey={snapshot.config.hasHostKey} /> : null}
          </span>
          <ViewToggle view={view} />
          <button
            type="button"
            onClick={() => actions.close()}
            title="关闭（Esc）"
            aria-label="关闭 PlayWithAI资源站"
            style={{
              width: 28,
              height: 28,
              marginLeft: 6,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 9,
              border: `1px solid ${C.borderSoft}`,
              background: 'transparent',
              color: C.label2,
              cursor: 'pointer',
            }}
          >
            <IconClose />
          </button>
        </header>

        {/* filter row (hidden while fullscreen reading replaces the list) */}
        <div
          style={{
            display: readingExpanded ? 'none' : 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 24px 8px',
            flex: 'none',
          }}
        >
          <KindFilterBar value={kindFilter} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: C.label3 }}>
            {articles === undefined ? '' : `${filtered.length} 篇`}
          </span>
        </div>

        {/* content: list scrolls here; the reading panel slides over its right edge,
            expanding to REPLACE the list entirely in fullscreen reading mode. */}
        <main style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {error !== undefined ? (
            <StatusHint text={`加载失败：${error}`} retry />
          ) : articles === undefined ? (
            <StatusHint text="正在加载文章…" />
          ) : filtered.length === 0 ? (
            <StatusHint text="暂无已发布的文章" />
          ) : (
            <div
              ref={listRef}
              style={{
                position: 'absolute',
                inset: 0,
                overflowY: 'auto',
                paddingRight: detailOpen ? 'min(532px, 52%)' : '0',
                display: readingExpanded ? 'none' : 'block',
                transition: 'padding-right .26s cubic-bezier(.2,.7,.3,1)',
                boxSizing: 'border-box',
              }}
            >
              {view === 'card' ? (
                <div style={{ maxWidth: 1240, margin: '0 auto', padding: '6px 24px 28px' }}>
                  <MasonryGrid
                    gap={14}
                    minColWidth={238}
                    items={filtered}
                    renderItem={article => (
                      <CardItem key={article.id} article={article} onSelect={actions.select} />
                    )}
                  />
                </div>
              ) : (
                <div style={{ maxWidth: 1080, margin: '0 auto', padding: '6px 24px 28px' }}>
                  <div style={{ border: `1px solid ${C.borderSoft}`, borderRadius: 12, overflow: 'hidden' }}>
                    {filtered.map((article, index) => (
                      <React.Fragment key={article.id}>
                        {index > 0 ? <div style={{ height: 1, background: C.borderSoft }} /> : null}
                        <ListItem article={article} onSelect={actions.select} />
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* list quick back-to-top (hidden while the reading panel covers this edge) */}
          {!detailOpen && !readingExpanded && !(error !== undefined || articles === undefined || filtered.length === 0) ? (
            <BackToTop targetRef={listRef} offsetRight={18} />
          ) : null}

          {/* right slide-in reading panel (only when an article is selected);
              stays mounted so expand/collapse morphs smoothly */}
          <ReadingPanel snapshot={snapshot} expanded={readingExpanded} />
        </main>
      </section>
      <style>{`@keyframes pwaHubIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plugin apply: two additive slot registrations
// ---------------------------------------------------------------------------

/** Apply the browser half: sidebar entry + main-area hub view. */
export function apply(ctx) {
  // Class-styled parts (markdown reading view, link buttons) share one sheet.
  ensureStyles()

  ctx.effect(
    () => {
      const disposeEntry = ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'pwa-hub-entry', order: 80, label: 'PlayWithAI资源站' },
          HubEntryButton,
        ),
      )
      const disposeOverlay = ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'pwa-hub-view', order: 50, label: 'PlayWithAI资源站文章浏览' },
          HubView,
        ),
      )
      return () => {
        disposeEntry()
        disposeOverlay()
      }
    },
    'dsh-plugin-playwithai-hub: sidebar entry + main-area view',
  )

  // Warm the config so the first paint of the whale mark uses host overrides.
  void resolveConfig(originOverride(), apiKeyOverride())
    .then(config => store.set({ config }))
    .catch(cause => console.warn('[pwa-hub] config route unavailable, using baked-in defaults:', cause))
}
