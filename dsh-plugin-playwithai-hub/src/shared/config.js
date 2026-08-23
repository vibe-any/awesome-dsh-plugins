/**
 * Shared deployment constants for both plugin halves.
 *
 * Reading goes through the hub's token-protected read API
 * (`list-articles` Edge Function，create-article 发文 API 的读侧对应物，
 * 见 dsh-resource-hub 仓库的 LIST_ARTICLES_API.md)。浏览器半使用后台签发的
 * API 密钥（勾选「读」权限的 pwai_ 密钥）调用它；密钥来源优先级：
 *   localStorage(`pwa-hub.apiKey`) > host 配置下发 > 空（提示配置）。
 *
 * Deployment overrides: the host half serves these values from its config
 * route; a user can also override `siteOrigin` per browser through
 * localStorage(`pwa-hub.siteOrigin`).
 */

export const PLUGIN_ID = 'dsh-plugin-playwithai-hub'
export const DISPLAY_NAME = 'PlayWithAI资源站'
export const SLOGAN = '把好内容，留给想做事的人'
export const LOGO_URL =
  'https://zhjrfpuoiblhbstcpkcz.supabase.co/storage/v1/object/public/playwithai-assets/brand/whale-logo.png'

export const SUPABASE_URL = 'https://zhjrfpuoiblhbstcpkcz.supabase.co'

/** Token-protected read API path on the Supabase Edge Functions origin. */
export const READ_API_PATH = '/functions/v1/list-articles'

/** Site origin for "在站点查看" deep links; empty hides the link. */
export const SITE_ORIGIN = ''

export const KIND_ORDER = ['all', 'original', 'open-source', 'tech', 'practice']

export const KIND_META = {
  all: { label: '全部', path: '' },
  original: { label: '原创分享', path: 'original' },
  'open-source': { label: '开源项目', path: 'open-source' },
  tech: { label: '技术原理', path: 'tech' },
  practice: { label: '实践总结', path: 'practice' },
}
