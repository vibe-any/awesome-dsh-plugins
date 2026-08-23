/**
 * Data layer for the browser half: deployment-config resolution and reads
 * over the hub's token-protected read API (`list-articles` Edge Function).
 *
 * Every request carries a hub-issued `pwai_` API key with the 「读」 scope
 * (`Authorization: Bearer …`); only published rows are ever returned. The key
 * comes from localStorage (plugin settings popover) or the host config route.
 */

import { KIND_ORDER, READ_API_PATH, SITE_ORIGIN, SUPABASE_URL } from '../shared/config.js'

export { KIND_ORDER }

/** Baked-in defaults used before/without the host config route. */
export const DEFAULT_FALLBACKS = {
  supabaseUrl: SUPABASE_URL,
  readApiPath: READ_API_PATH,
  apiKey: '',
  siteOrigin: SITE_ORIGIN,
  logoUrl: 'https://zhjrfpuoiblhbstcpkcz.supabase.co/storage/v1/object/public/playwithai-assets/brand/whale-logo.png',
  defaultCover: 'https://pic1.imgdb.cn/i/034BYna6AAcR1zwB2m6B8x.jpg',
}

let configPromise = null

/** Drops the cached config so the next resolveConfig re-runs (e.g. after the
 * user saves a new API key in the settings popover). */
export function invalidateConfig() {
  configPromise = null
}

/**
 * Resolve deployment config: host route first (single flight), falling back
 * to baked-in defaults. `originOverride` (localStorage) wins for siteOrigin;
 * `apiKeyOverride` (localStorage, plugin settings) is the personal read key —
 * the host never ships its own configured key to the browser (`hasHostKey`
 * only), proxied calls pick it up server-side.
 */
export function resolveConfig(originOverride = '', apiKeyOverride = '') {
  if (configPromise !== null) return configPromise
  configPromise = (async () => {
    try {
      const response = await fetch('/dsh-plugin-playwithai-hub/config', { headers: { accept: 'application/json' } })
      const body = await response.json()
      if (!body?.ok) throw new Error(body?.error ?? 'bad config response')
      return {
        ...DEFAULT_FALLBACKS,
        supabaseUrl: body.supabaseUrl || DEFAULT_FALLBACKS.supabaseUrl,
        apiKey: apiKeyOverride,
        hasHostKey: Boolean(body.hasHostKey),
        siteOrigin: originOverride || body.siteOrigin || DEFAULT_FALLBACKS.siteOrigin,
      }
    } catch (cause) {
      console.warn('[pwa-hub] config route failed, using defaults:', cause)
      return {
        ...DEFAULT_FALLBACKS,
        apiKey: apiKeyOverride,
        hasHostKey: false,
        siteOrigin: originOverride || DEFAULT_FALLBACKS.siteOrigin,
      }
    } finally {
      // Allow a later retry after transient failures.
      setTimeout(() => {
        configPromise = null
      }, 5_000)
    }
  })()
  return configPromise
}

function authHeaders(config) {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: 'application/json',
  }
}

function readApiUrl(config, params) {
  const base = String(config.supabaseUrl ?? '').replace(/\/+$/, '')
  const path = config.readApiPath || READ_API_PATH
  return `${base}${path}?${new URLSearchParams(params)}`
}

/** Turns direct-call HTTP/JSON failures into actionable zh-CN messages. */
function explainDirectFailure(response, body) {
  if (response.status === 401) return new Error('API 密钥无效或已被删除，请在插件设置中更新密钥。')
  if (response.status === 403) return new Error('该 API 密钥没有「读」权限，请在资源站后台重新创建勾选读取权限的密钥。')
  if (response.status === 429) return new Error('请求过于频繁，请稍后重试。')
  const detail = typeof body?.error === 'string' ? body.error : ''
  return new Error(detail ? `${response.status} ${detail}` : `HTTP ${response.status}`)
}

/** Same-origin proxy route served by the host half (no CORS in any deploy). */
const PROXY_PATH = '/dsh-plugin-playwithai-hub/api/articles'

/**
 * Read-API call, same-origin proxy first: the host half relays the Edge
 * Function server-side and injects its own configured key when the caller has
 * none. Falls back to a direct Edge-Function call when the proxy is
 * unavailable (network error), missing (older host half → 404) or STALE
 * (pre-proxy host answers every prefix path with the config JSON — detected
 * by shape); the direct path relies on the loopback CORS allowance of the
 * read API.
 */
async function callReadApi(config, params) {
  const headers = { accept: 'application/json' }
  if (config.apiKey) headers['x-pwai-key'] = config.apiKey
  let response
  try {
    response = await fetch(`${PROXY_PATH}?${new URLSearchParams(params)}`, { headers })
  } catch {
    return callReadApiDirect(config, params)
  }
  if (response.status === 404) return callReadApiDirect(config, params)
  let body = null
  try {
    body = await response.json()
  } catch {
    /* non-JSON bodies fall through to status-only messages */
  }
  if (response.ok && body !== null && typeof body === 'object' && Array.isArray(body.articles)) return body
  // A 200 without an articles array from the proxy means the running host
  // half predates the read proxy (it echoes the config route). Restart DSH to
  // load the new host bundle; meanwhile try the direct path.
  console.warn('[pwa-hub] proxy answered but not an articles payload — stale host half? restarting DSH reloads it.')
  return callReadApiDirect(config, params, true)
}

/** Direct Edge-Function call (fallback; requires a personal key + loopback). */
async function callReadApiDirect(config, params, staleHost = false) {
  if (!config.apiKey) {
    throw new Error(
      '尚未配置 API 密钥：请点击右上角 ⚙ 填入后台签发的 pwai_ 密钥（需勾选「读」权限），或由宿主通过 PWAI_HUB_API_KEY 统一配置。' +
        (staleHost ? ' 另外检测到宿主插件为旧版本（未含读代理），请重启 DSH 进程后刷新页面。' : ''),
    )
  }
  const response = await fetch(readApiUrl(config, params), { headers: authHeaders(config) })
  let body = null
  try {
    body = await response.json()
  } catch {
    /* non-JSON error bodies fall through to status-only messages */
  }
  if (!response.ok) throw explainDirectFailure(response, body)
  return body
}

/**
 * Fetch published articles across every kind, merged newest-first by the API.
 * One failing kind fails the whole load (the UI offers retry).
 */
export async function fetchArticles(config) {
  const body = await callReadApi(config, { limit: '100' })
  const articles = Array.isArray(body?.articles) ? body.articles : []
  return articles.map(row => normalize(row, row.kind))
}

/** Fetch one article's full payload (content included); returns null if gone. */
export async function fetchDetail(config, summary) {
  if (!summary?.kind || !summary?.slug) throw new Error(`unknown article: ${summary?.id ?? ''}`)
  const body = await callReadApi(config, { kind: summary.kind, slug: summary.slug })
  if (!body || typeof body !== 'object' || !body.id) return null
  return normalize(body, summary.kind)
}

function normalize(row, kind) {
  return {
    id: row.id ?? '',
    kind: kind ?? row.kind ?? '',
    title: row.title ?? '',
    slug: row.slug ?? '',
    excerpt: row.excerpt ?? '',
    coverUrl: row.coverUrl ?? '',
    author: row.author ?? null,
    externalUrl: row.externalUrl ?? null,
    githubUrl: row.githubUrl ?? null,
    tagSlugs: Array.isArray(row.tags) ? row.tags : [],
    publishedAt: row.publishedAt ?? '',
    contentMd: typeof row.contentMd === 'string' ? row.contentMd : undefined,
  }
}
