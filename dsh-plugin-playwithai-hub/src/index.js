/**
 * dsh-plugin-playwithai-hub — host half.
 *
 * Client-only UI plugin: the browser half (exports "./client") renders the
 * sidebar entry and the article-browser overlay. The host half exists to (a)
 * give the package a valid loader entry and (b) serve, same-origin:
 *
 *   · GET /dsh-plugin-playwithai-hub/config            — deployment config
 *   · GET /dsh-plugin-playwithai-hub/api/articles?…    — read-API proxy
 *
 * The proxy relays the hub's `list-articles` Edge Function server-side, so the
 * browser never makes a cross-origin call (works identically for local and
 * cloud DSH deployments — no CORS whitelist needed) and the shared key can
 * stay on the server.
 *
 * Key resolution for proxied calls: caller header `x-pwai-key` (personal key
 * from the plugin settings popover) → profile inline config `{ apiKey }` →
 * environment variable `PWAI_HUB_API_KEY` → none (401 with guidance). The
 * /config route only reports `hasHostKey`, never the key itself. Upstream is
 * a fixed URL with a fixed method and a sanitized query allow-list — this is
 * not an open proxy.
 *
 * @module dsh-plugin-playwithai-hub
 */

import { DISPLAY_NAME, READ_API_PATH, SITE_ORIGIN, SUPABASE_URL } from './shared/config.js'

/** Required services: the route registry. */
export const inject = ['webServer']

function resolveConfiguredKey(config) {
  const fromConfig = typeof config?.apiKey === 'string' ? config.apiKey.trim() : ''
  if (fromConfig) return fromConfig
  for (const name of ['PWAI_HUB_API_KEY', 'PLAYWITHAI_HUB_API_KEY']) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** Query allow-list: anything else is dropped before it reaches upstream. */
const PARAM_RULES = {
  kind: /^[a-z-]{1,20}$/,
  tag: /^[a-z0-9-]{1,50}$/,
  slug: /^[a-z0-9-]{1,200}$/,
  limit: /^\d{1,3}$/,
}

function pickParams(url) {
  const clean = {}
  for (const [name, pattern] of Object.entries(PARAM_RULES)) {
    const raw = url.searchParams.get(name)
    if (raw !== null && pattern.test(raw)) clean[name] = raw.toLowerCase()
  }
  return clean
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

async function proxyArticles(req, res, { apiKey, supabaseUrl }) {
  const url = new URL(req.url ?? '/api/articles', 'http://internal')
  const callerKey = String(req.headers['x-pwai-key'] ?? '').trim()
  const key = callerKey || apiKey
  if (!key) {
    sendJson(res, 401, {
      error:
        '尚未配置 API 密钥：请在插件 ⚙ 设置里粘贴资源站后台签发的 pwai_ 密钥（勾选「读」权限），或由宿主通过环境变量 PWAI_HUB_API_KEY 统一配置。',
    })
    return
  }

  const query = new URLSearchParams(pickParams(url))
  let upstream
  try {
    upstream = await fetch(`${supabaseUrl}${READ_API_PATH}?${query}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    console.warn('[pwa-hub] read-api proxy upstream failure:', error?.message ?? error)
    sendJson(res, 502, { error: '无法连接资源站读接口，请稍后重试。' })
    return
  }

  const text = await upstream.text().catch(() => '{}')
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = { error: text.slice(0, 200) || `upstream ${upstream.status}` }
  }
  sendJson(res, upstream.status, payload)
}

function requestPath(req) {
  try {
    return new URL(req.url ?? '/', 'http://internal').pathname
  } catch {
    return '/config'
  }
}

/**
 * Mount the config + proxy routes. Never throws at request time; failures
 * answer { ok:false } and the client falls back to its built-in defaults.
 * @param ctx - context carrying webServer.
 * @param config - optional inline plugin config ({ apiKey?, supabaseUrl?, siteOrigin? }).
 */
export function apply(ctx, config = {}) {
  const apiKey = resolveConfiguredKey(config)
  const supabaseUrl =
    typeof config?.supabaseUrl === 'string' && config.supabaseUrl.trim() ? config.supabaseUrl.trim() : SUPABASE_URL
  const siteOrigin = typeof config?.siteOrigin === 'string' ? config.siteOrigin.trim() : SITE_ORIGIN

  ctx.effect(
    () => {
      const handler = async (req, res) => {
        try {
          if (requestPath(req).endsWith('/api/articles')) {
            await proxyArticles(req, res, { apiKey, supabaseUrl })
            return
          }
          // Default: deployment config. The key itself never leaves the host.
          sendJson(res, 200, {
            ok: true,
            complete: true,
            displayName: DISPLAY_NAME,
            supabaseUrl,
            hasHostKey: Boolean(apiKey),
            siteOrigin,
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      }
      return ctx.webServer.register({ kind: 'prefix', path: '/dsh-plugin-playwithai-hub', handler })
    },
    'dsh-plugin-playwithai-hub: config route + read-api proxy',
  )
}
