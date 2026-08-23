# dsh-plugin-playwithai-hub · PlayWithAI资源站

DSH Web GUI 插件：把 PlayWithAI 资源站（dsh-resource-hub）的文章装进 Harness——
左侧菜单点开 🐳，主界面（侧边栏右缘起）平铺展示四个栏目的已发布文章，卡片/列表双视图；
点文章从右侧滑出阅读栏读全文，支持滚动与快速回顶。顶部展示站点 logo 与
slogan「**把好内容，留给想做事的人**」。

## 功能

- **左侧菜单入口**：注册到 `sidebar.footer.action`（设置旁的加法位），侧边栏收起时自动变图标态，点击开关文章浏览视图
- **主界面视图**（`shell.overlay` 平铺主区域，非弹窗）：从侧边栏右缘铺满剩余空间，实时跟随侧栏宽度/拖拽/收起（读取 AppFrame 网格列宽）；顶栏为 whale logo + 「PlayWithAI 资源站」品牌组合 + slogan，**右上角卡片 / 列表视图切换**（记忆到 localStorage）+ 关闭；栏目筛选：全部 / 原创分享 / 开源项目 / 技术原理 / 实践总结
- **卡片 / 列表双视图**：卡片 = 封面图 + 栏目徽标 + 标题 + 两行摘要 + 作者 · 日期；列表 = 紧凑行（缩略图 + 单行标题摘要 + 右侧栏目徽标）；列表滚动过长时右下角出现「回到顶部」
- **右侧滑出阅读栏**：点文章从右缘滑入——封面、标题、作者日期、标签、正文 Markdown 阅读（零依赖渲染器，代码块/引用/表格/图片全支持，正文 14.5px 阅读字号）、GitHub / 原文链接 / 在站点查看 深链；独立滚动容器 + 「回到顶部」悬浮钮；Esc 先收文章再退视图；阅读栏滑出时列表自动让位（右内边距过渡）
- **数据走站点 token 读 API**（`list-articles` Edge Function，仅返回已发布内容）：浏览器半调用**宿主同源代理** `/dsh-plugin-playwithai-hub/api/articles`（host 服务端转发并注入密钥），本地/云端部署均无 CORS 问题；401/403/未配置均有中文提示
- **⚙ 密钥设置**：顶栏齿轮弹出设置面板——个人密钥保存到本机 localStorage（`pwa-hub.apiKey`，经 `x-pwai-key` 头随代理请求携带），保存后自动重载文章；云端部署可由管理员用环境变量统一下发，用户本机无需填写

## 安装

```sh
# 构建（需要 esbuild；本仓库内开发可直接 pnpm install）
pnpm install && npm run build

# 装进 web profile（link 模式）
dsh plugin --profile web add link:/path/to/dsh-plugin-playwithai-hub

# 验证
dsh --profile web --dump-config | grep playwithai
```

刷新 Web GUI 后生效。卸载：`dsh plugin --profile web remove dsh-plugin-playwithai-hub`。

> **改代码后如何生效**：浏览器半（client）刷新页面即热载最新构建；
> **宿主半（index.js）运行在常驻 Node 进程里，重新 build 后必须重启 DSH
> 进程才会加载**——否则 `/api/articles` 代理路由不存在，插件会自动回退直连并提示。

## 配置

### 数据链路与 API 密钥

浏览器半**不直连** Supabase（避免 CORS，本地与云端部署行为一致）：读请求走
宿主同源代理 `GET /dsh-plugin-playwithai-hub/api/articles`，由 host 半服务端
转发到站点的 `list-articles` Edge Function。代理密钥按以下优先级解析：

1. **调用方个人密钥**：浏览器半经 `x-pwai-key` 头携带 localStorage(`pwa-hub.apiKey`)
   里保存的密钥（⚙ 设置面板写入）——适合个人自用；
2. **宿主统一下发**（适合云端/多人共享部署）：host 半读取 profile 内联 config 的
   `apiKey` 或环境变量 `PWAI_HUB_API_KEY`。在 cordis.patch.yml 的插件行内加 config 即可：

   ```yaml
   - insert:
       - id: dsh-plugin-playwithai-hub
         name: dsh-plugin-playwithai-hub
         config:
           apiKey: pwai_xxxxxxxx   # 建议使用只勾选「读」权限的密钥
   ```

   宿主配置的密钥只留在服务端注入，`/config` 路由仅暴露 `hasHostKey` 布尔值，
   永不把密钥下发给浏览器。
3. 两者都缺失时代理返回 401 与中文指引。

代理上游为固定 URL + 固定 GET + 查询参数白名单（kind/tag/slug/limit），
不是开放代理。密钥在资源站后台 `/admin → API 密钥` 创建；给插件用建议只勾「读」。

> 兜底：宿主代理不可用（旧版本宿主或极端网络）时，浏览器半回退为直连读 API，
> 该路径依赖读接口对本机回环来源的 CORS 放行与个人密钥。

### 其他部署值

Supabase URL / 站点域名同样由 host 半 config 路由下发（支持内联 config 覆写），
不可用时回退到 `src/shared/config.js` 内置默认。用户还可在浏览器 localStorage 用
`pwa-hub.siteOrigin` 覆盖站点域名以启用「在站点查看」深链（为空时该按钮隐藏）。

## 结构

```
├── package.json          # dsh.bundle.patch + dsh.client(web) 双半声明
├── cordis.patch.yml      # 向 web profile 组合树插入插件行
├── build.mjs             # esbuild 双半打包（host=ESM 自包含；client=__ModuleLoader__ CJS 握手）+ 构建后真实导入自检
├── lib/                  # 构建产物（git 忽略）：npm run build 生成，npm 发布经 prepublishOnly 自动重建
└── src/
    ├── index.js          # host 半：config 下发 + 读 API 同源代理（密钥服务端注入）
    ├── shared/config.js  # 两半共用的部署常量与栏目映射
    └── client/
        ├── index.jsx     # 入口按钮 + 主界面视图 + 右侧滑出阅读栏 + ⚙ 密钥设置
        ├── data.js       # 读 API 调用（同源代理优先、直连兜底）+ 配置解析
        ├── markdown.js   # 零依赖 Markdown 渲染（先转义后白名单 href）
        └── styles.js     # 阅读样式单次注入
```

## 设计说明

- **只加不改**：两个插槽都是 list 型加法位，绝不替换官方 sidebar/conversation 表面；
  插槽缺失时经 `ctx.slots.inject` 静默等待而非拖垮启动。
- **安全**：Markdown 先 HTML 转义再渲染，链接 href 白名单 http(s)/相对路径；
  封面与正文外链图片带 `referrerpolicy=no-referrer`。
- **主题一致**：全部颜色走 DSH web 的 CSS 变量并带深色兜底，浅色/深色主题自适应。

## 许可

[MIT](../LICENSE) © PlayWithAI

