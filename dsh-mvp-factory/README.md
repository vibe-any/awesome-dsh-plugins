# dsh-mvp-factory

一条跑在 DeepSeek Harness 里的 AI 产品流水线：**联网找热点 → 模型评估出计划 → 交给 dsh 自己开发 → 回收结果 → 本地跑起来看效果**。

从 `easy-mvp`（Next.js + SQLite + Supabase Edge Function）抽取而来，但三处关键能力改成了直接用 dsh 已经配好的东西：

| 能力 | easy-mvp 的做法 | 本插件的做法 |
|---|---|---|
| 调模型 | Supabase Edge Function + 自带 API key | `ctx.llm` + `ctx.agentDefaultModel`，**跟随你在 dsh 里选的模型** |
| 联网检索 | Tavily / Unifuncs，需要各自的 API key | `ctx.web.search`，**用 profile 里已装的搜索 provider**，不需要额外 key |
| 写代码 | 后台 spawn `codex` / `claude` CLI | **dsh 自己就是那个 coding agent**：任务书送进输入框，用当前会话的工作目录和权限开工 |
| 存储 | SQLite（`better-sqlite3` 原生模块） | `$DSH_HOME/mvp-factory/` 下的 JSON 文件，零原生依赖，可在 UI 外直接编辑 |

## 安装

```sh
cd /path/to/dsh-mvp-factory
npm install && npm run build
dsh plugin --profile web add .      # 在 deepseek-harness 源码树里跑：pnpm dsh plugin --profile web add .
```

重启 dsh 后，**左侧侧边栏最底部、设置按钮上方**会多一个「MVP 工厂」入口，点开是一个占据主区域的面板。装成功的标志是 profile 的 `package.json` 里 `dsh.profile.bundles` 末尾出现了 `dsh-mvp-factory`。

## 六个模块

| 模块 | 做什么 |
|---|---|
| **创意** | 填一个方向 → 联网检索 → 模型结构化成候选创意（带评分、痛点、目标用户、商业模式、来源链接）。候选卡片**自适应网格**（宽屏一行 3 个，随窗口收窄降为 2 / 1 个）；可点卡片指定「优先候选」（落盘）；运行中可取消，失败可原地重试 |
| **计划** | 模型选出最佳方向，给出评分拆解、决策理由和完整计划文档。左右栏 1:2，文档高度取 `max(左栏高度, 窗口高)`，超出部分文档内滚动，不用整页翻。**需要人工点「审批通过」**；审批后重新生成需二次确认 |
| **行动** | 任务书可先编辑再交付。点「送入输入框」，任务书填进当前会话的输入框，你确认后按发送，dsh 就开始写代码 |
| **结果** | 用你配的安装/启动命令把产物跑起来，给出访问地址和实时运行日志，可随时停止 |
| **历史** | 所有轮次的记录，点开看候选创意、计划文档、阶段日志；任意一条可「设为当前」，可删除（二次确认） |
| **设置** | 检索方向与渠道、深度检索、候选条数、模型覆盖、产物根目录与命令、两份提示词模板（可一键恢复默认） |

## 构建回收：插件怎么知道 dsh 跑完了

任务书会自动追加两条指令：

1. **产物位置**：把项目创建在 `<产物根目录>/<项目名>/`，多轮项目互不干扰；
2. **完成回执**：全部完成后在项目根目录写 `.mvp-factory/build-done.json`（`{"summary": "<一句话总结>"}`）。

插件在交付后轮询项目目录：目录出现 → 「dsh 构建中」；读到回执 → 「已完成」，summary 与时间写入 run 文档和日志，行动页「构建回收」卡片、结果页状态、顶部步骤条同步更新。**重启 dsh 时会补录扫描**：把此前已交付、但没被监视到的 run 按磁盘现状补上状态（有回执读回执；仅有 `package.json` 按文档化启发式记为已完成；目录不存在则挂上监视等它出现）。

「结果」页启动时自动进入对应项目目录：优先 run 记录的目录，其次根目录本身，再次根目录下唯一含 `package.json` 的子目录；无法判断时拒绝并列出候选，让你先在「历史」选中 run。

## 界面

视觉遵循仓库根目录的 `DESIGN.md`：奶油画布 + 暖墨文字 + 珊瑚色只给主操作，代码/日志块为常暗表面；调色板声明为 CSS 变量并跟随 `body[data-ds-dark-theme]` 在 dsh 深浅色间切换。侧边栏入口与面板标题使用插件 logo，标题旁的 ⓘ 打开「关于」弹窗（logo、版本、开源地址、© PlayWithAI）。

## 检索方式

- **联网搜索**（默认）：`ctx.web.search`，按渠道逐条查。组合里没有搜索 provider 时自动禁用。
- **Tavily 搜索**：需在设置里自备 API key。
- **模型直出**：不联网，最快，但没有实时热点和来源。
- **粘贴导入**：自己贴 Markdown 笔记/链接，模型据此结构化。

「深度检索」开启时，检索完成后用 `ctx.web.fetch` 抓取前 3 条来源正文并入研究材料——更慢，但创意更有依据。

## 配置

插件条目的 `config`（`cordis.patch.yml` 里）：`root`（状态目录，默认 `$DSH_HOME/mvp-factory`）、`maxRunBytes`（单个 run 文档上限，默认 4 MiB）。其余都在面板「设置」里，存成 `<root>/settings.json`；`modelOverride` 留空跟随 dsh 默认模型；`tavilyApiKey` 快照永远掩码返回。

## 已知限制

- 「送入输入框」需要先打开一个会话（只有会话内的插槽能写输入框草稿）；只能追加到草稿末尾，不会自动发送。
- 产物进程同时只能有一个，且随 dsh 退出而结束；检索/计划运行中重启 dsh 会把 run 留在 `running`，点「取消」即可修正为可重试。
- 构建回执依赖 dsh 遵循任务书指令；不回写时状态停在「dsh 构建中」，以磁盘为准直接去「结果」启动即可。
- 搜索与模型依赖你在 dsh 里配好的账号，provider 报错会原样显示在对应模块。
- 「结果」阶段执行的是你自己填的 shell 命令；所有写操作路由都做了同源校验。

## 开发回路

`add <目录>` 装的是 `link:`，改完代码重新 `npm run build` + 重启 dsh 即生效（浏览器半边由 dsh 的插件 HMR 热更新，host 半边需重启）。

```sh
npm run typecheck                    # tsc --noEmit
npm test                             # node --test（零依赖，纯逻辑单测）
npm run build                        # typecheck + tsdown，产出 lib/index.js 与 lib/client.js
```

自检：

```sh
head -c 76 lib/client.js                              # 应以 window.__ModuleLoader__.load({ id: "dsh-mvp-factory" 开头
grep -o 'require("[^"]*")' lib/client.js | sort -u     # 只应看到 react、react/jsx-runtime 与 ui-primitives
dsh --profile web --dump-config | grep mvp-factory     # 确认组合树里有这一行，且没有 patch 警告
```

换 logo：shell 只给插件发一个 `client.js`（无静态资源路由），logo 以 data URL 内联进 bundle。替换根目录 `logo.png` 后：

```sh
sips -z 128 128 logo.png --out assets/logo-128.png    # macOS；其它平台任意缩放工具
node scripts/embed-logo.mjs                           # 重新生成 src/client/logo.ts，再 npm run build
```

## 卸载

```sh
dsh plugin --profile web remove dsh-mvp-factory
```

历史记录留在 `$DSH_HOME/mvp-factory/`，要一起清掉就手动删这个目录。

## 结构

```
assets/
└── logo-128.png      根目录 logo.png 的 128×128 缩放版，嵌入用源图
logo.png              原始 logo（只作源图，不进 bundle）
scripts/
└── embed-logo.mjs    由 assets/logo-128.png 重新生成 src/client/logo.ts
src/
├── types.ts          两侧共享的契约、路由路径、Result
├── settings.ts       默认值 + 唯一的归一化入口 + 提示词模板（产物位置 / 完成回执指令）
├── store.ts          JSON 文件读写（原子写、run id 校验、摘要 stat 缓存）
├── harness.ts        host 服务的结构化声明（llm / web.search / web.fetch）+ generateText
├── json.ts           从模型输出里捞 JSON
├── discover.ts       创意阶段（检索 + 可选深度抓取 + 结构化）
├── planner.ts        计划阶段（评估 + 计划文档 + 任务书）
├── build-watch.ts    构建回收：项目目录轮询 + 完成回执解析
├── app-runner.ts     结果阶段（本地进程）
├── service.ts        流水线协调（后台任务、构建监视接线、启动补录）
├── routes.ts         HTTP 表面（同源校验、体积上限、方法校验）
├── index.ts          host 插件入口
└── client/           浏览器半边（侧边栏入口、面板、关于弹窗、六个 tab、composer 桥）
```

插件不 import 任何 `@deepseek-ai/*` npm 包：用到的 host 与 client 服务都按结构化类型声明。浏览器半边运行时从 shell 的冻结模块表 require `react` 与 `@deepseek-ai/dsh-client-ui-primitives`（MarkdownText、writeClipboard），只在本插件 `src/client/primitives.d.ts` 里声明用到的成员，不构成 npm 依赖。

## License

MIT
