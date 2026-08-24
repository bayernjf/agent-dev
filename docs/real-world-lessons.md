# Agent-Dev 真实链路经验沉淀

> 来源：三个真实项目（`Receipt Test` 1/3、`Workspace Verify Fresh` 2/3、`Link Vault` 3/3）从 Blueprint 到 Preview/Production 的完整周期验证。
> 用途：记录只有真实云端链路才能暴露的缺陷、由缺陷沉淀的架构规则、以及环境前提——避免把环境问题误判为产品缺陷。
> 更新时间：2026-08-24

## 1. 真实缺陷清单

以下缺陷**没有一个是既有单元测试能发现的**，全部由真实链路或真跑一次生成物暴露。每条含：表现 → 根因 → 修复（提交）。

### 1.1 项目 1（`Receipt Test`）暴露的 6 个

| # | 缺陷 | 提交 | 关键教训 |
| --- | --- | --- | --- |
| 1 | **Agent 写的代码从来没被提交** | `874fd3c` | 流水线每次 commit 只 `git add` 自己刚写的报告文件，Agent 自己不提交，被推送/被评审的分支上只有脚手架。现在 Runtime 成功后由平台提交 Agent 改动。 |
| 2 | **`git add -A` 把密钥和 Provider 状态提交进产品仓库** | `7d3b6b0` | workspace 有真实凭据的 `.env`/`.vercel/`/`.wrangler/`/`.agent-dev/`。补全 `.gitignore` 并加拦截：暂存区出现 `.env` 时不提交、判 `failed`（此处不能用 `throw`，运行状态已写 `running`，抛错会卡死无法重试）。 |
| 3 | **新仓库没有 PR 的基线分支** | `5e38f69` | `gh repo create --push` 只发布 feature 分支，`feature/* -> dev -> main` 第一个 PR 开不出来。改为在基线（root）提交上创建 `dev`/`main` 并把 `main` 设为默认分支（用基线而非 HEAD，避免待评审功能躺在生产分支）。 |
| 4 | **已存在的仓库永远补不到这两个分支** | `89b3585` | 上一条只在"新建仓库"分支执行，修复前建的仓库重跑 apply 也不补。改为 apply 每次都确保声明分支存在（容忍 `Reference already exists`）。 |
| 5 | **PR 只能靠人手抄 URL** | `a39be2b` | 新增 `POST .../delivery/pull-request`（`OPEN_PULL_REQUEST`）：平台自己推送并开 PR 再回填证据。前置校验：revision 一致、任务已批准、已验收、apply 已完成、工作区干净；推送前校验 `origin` 必须等于资源清单记录的仓库，并要求 HEAD **包含**被验收提交（不是相等——验收后平台还会提交报告）。 |
| 6 | **生产发布用的是被保护的部署 URL** | `8afb9bd` | `vercel deploy --prod` 回传不可变部署地址，被 Deployment Protection 挡着（302 到 SSO），健康检查把健康 API 判坏，且会把用户访问不到的地址写进 `VITE_API_BASE_URL`。改为 `vercel inspect --format=json` 取最短别名。 |

### 1.2 项目 2（`Workspace Verify Fresh`）暴露的缺陷

| # | 缺陷 | 提交 | 关键教训 |
| --- | --- | --- | --- |
| 7 | **Codex 创建外部 symlink 绕过产物提交拦截** | `1179738` 前 | Codex 为了跑测试把 `/private/tmp/.../node_modules` 以**绝对路径符号链接**挂进 workspace。`.gitignore` 的 `node_modules/`（目录模式）不匹配符号链接，死链被提交进产品仓库。修复：`commitAgentChanges` 加「workspace 外部符号链接」拦截（`lstat`+`readlink`+`resolve` 判断是否逃出 workspace）；模板 `.gitignore` 从 `node_modules/` 改为 `node_modules`（同时匹配目录、文件、符号链接）。 |
| 8 | **生成的 CI 在首个 PR 必然失败** | `e0b2d7d` | `actions/setup-node@v5` 默认开启依赖缓存，仓库根没有 lock 文件就硬报 `Dependencies lock file is not found`。模板 `quality.yml` 给 `setup-node` 加 `cache: ''`（禁用缓存探测），让 `npm install` 自己生成 lock 文件。 |

### 1.3 项目 3（`Link Vault`）暴露的缺陷

| # | 缺陷 | 修复方式 | 关键教训 |
| --- | --- | --- | --- |
| 9 | **被验收提交不在 `main` 上导致生产发布被拒** | 补开 dev→main PR #2 后 `release/retry` | `release/approve` 只校验「被验收提交是 `main` 祖先」，不会自动把 `dev` 合入 `main`。**若 PR 目标分支是 `dev`，发布前需显式把 `dev` 提升到 `main`**（`requirePullRequest: true` 即补开 dev→main PR）。 |

### 1.4 Dual Preview 编排（`packages/deployment-composer`）暴露的 5 个

| # | 缺陷 | 关键教训 |
| --- | --- | --- |
| 10 | **生成的 API 模板在 Vercel 上永久挂起** | `export default handle(app)` 返回 Web fetch 风格 `Response`，Vercel 按传统 `(req,res)=>void` 处理默认导出并丢弃返回值。改为按 HTTP 方法导出 fetch-style handler（`export const GET/POST/OPTIONS = handle(app)`）；本地 `serve()` 守卫改为精确的 `!process.env.VERCEL`。 |
| 11 | **生成的 API 模板没有 CORS 中间件** | Composer 一直注入 `ALLOWED_ORIGIN` 但模板从不读它。补 `hono/cors`：`origin: process.env.ALLOWED_ORIGIN ?? '*'`。 |
| 12 | **生成的前端从不消费 `VITE_API_BASE_URL`** | 注入变量但模板无引用，构建产物找不到该 URL。`index.html` 加 `<meta name="api-base-url" content="%VITE_API_BASE_URL%">` 走 Vite HTML 变量替换，`main.tsx` 真的 `fetch(${apiBaseUrl}/api/health)` 并渲染状态。 |
| 13 | **`WRANGLER_LOG: 'none'` 破坏幂等性和 URL 解析** | 幂等判断依赖 stderr 的 `already exists` 文本、URL 解析依赖 Wrangler 回传的真实 URL，该变量把两者都压掉。移除该变量并加断言 create 调用 env 不含 `WRANGLER_LOG` 的回归测试。 |
| 14 | **联合 Smoke 的 CORS 校验对象错了** | API 的 CORS 锁在**分支别名** `preview.<project>.pages.dev`，但 Smoke 拿每次部署的**哈希域名**校验。统一用别名（Reviewer 打开的稳定链接）。此前只是因 URL 解析失败退化才"碰巧"通过。 |

### 1.5 平台自身与 CI 的缺陷

| # | 缺陷 | 关键教训 |
| --- | --- | --- |
| 15 | **`npm ci` 在 Node 20 下必然失败** | `wrangler@4.120.0` 要求 node ≥22，`.npmrc` 的 `engine-strict=true` 使其成为硬错误。新增 `.node-version`（`22`）作为 fnm 与 CI `actions/setup-node` 唯一来源，`engines.node` 提升为 `>=22.0.0`。 |
| 16 | **CI 测试依赖本机环境而非产品契约** | 有测试断言 runtime catalog 含 `id:'codex'`，但 catalog 只返回 PATH 上真实存在的 Agent，runner 没装 Codex 就返回空数组。改为断言路由真正拥有的契约。用最小 PATH 复现验证，排除同类环境依赖测试潜伏。 |
| 17 | **`workspace.ts` 用 `node:fs` 被拖进 Vite 打包** | blueprint 的 barrel 再导出 `workspace.ts`，Studio 浏览器 import barrel 时 `node:fs` 进 Vite 打包直接构建失败（`"readFile" is not exported by "__vite-browser-external"`）。typecheck/test 全绿也发现不了——只有 build 会。改为子路径 `@agent-dev/blueprint/workspace` 导出；alias 是前缀匹配，子路径规则要排在裸包名前。 |
| 18 | **生成的浏览器插件 `tsconfig` 让自己的 quality gate 必挂** | 没有 `lib: DOM`、没有 `skipLibCheck`、`types` 缺 `node`，`tsc --noEmit` 直接在 vite 自己的 `.d.ts` 上报 `Cannot find name 'Buffer'`——与缺陷 8（生成的 CI 在首个 PR 必然失败）同一类：**模板的 quality 脚本必须真跑过一次**，光有单测断言产物存在是不够的。修复：补 `lib`/`skipLibCheck`/`@types/node`，并加回归测试锁住。 |
| 19 | **manifest 引用了生成器产不出的 PNG** | 生成的 MV3 manifest 写了 `default_icon: 'icons/icon128.png'`，但产物全是文本、生成器无法产出 PNG，`vite build` 报 `Could not load manifest asset`。修复：manifest 去掉 `default_icon`，把「发布前自行补齐图标」写进交接 README（诚实边界而不是假装有图标）。 |
| 20 | **Studio 用了不存在的 i18n key，且把 catalog 的 string 当枚举** | 产品形态单选框调 `t('productType.<type>')`，而字典里在 `blueprint.productTypeXxx`，界面会渲染出原始 key；Runtime 单选框把 `agent.id: string` 直接写进 `runtimeProvider` 枚举。**两处在已提交的 HEAD 上 typecheck 就是红的**——提交前没跑全量 typecheck。改为显式 key 映射表 + 只列 `runtimeProviderSchema` 认得的 id。 |

## 2. 由缺陷沉淀的架构规则

以下规则在真实链路中反复被违反过，现为强制约束（都有测试覆盖）：

1. **生产从生产分支的独立 checkout 发布，且该分支必须已带上被验收的提交**（`962932a`）。`ReleaseComposer` 发布前先 clone/fetch/reset 记录仓库的生产分支，校验被人工验收的提交是该分支 HEAD 的祖先（不是则拒绝并提示先合 PR），再在这个 checkout 上装依赖、跑质量门禁、构建和部署；Evidence 记下 `repository/branch/commit/acceptedCommit`。没有记录仓库或没有验收时，`release/plan` 给出原因、`release/request` 返回 409。
2. **每个人工闸门都必须具名批准**（`0dbd15c`）。基线、Feature Task、交付验收、生产批准四处统一：API 强制要求 approver，Studio 收集姓名记在浏览器本地，输入为空不发请求。**生产批准始终由用户本人给出，Agent 不代按。**
3. **Evidence 记录观测值，不记录判定常量**（如 `passed`）。观测值指 HTTP 状态、content-type、实测 CORS 响应头、页面字节数、`acceptedCommit`。有一条测试断言序列化后的 observations 不含 `"passed"`。
4. **Agent 运行成功后由平台提交 Agent 的改动**（`874fd3c` 修复后）。提交前拦截 `.env` 与 workspace 外部符号链接。
5. **每个闸门/步骤必须能证明自己**：外部写操作先 Dry Run；未取得真实 Evidence 的步骤不能标记完成；自动修复最多两次。
6. **幂等性优先**：Provider 建项目、部署、发布都带幂等键；重试不能发出上一次残留的位（发布每次尝试都 reset）。

## 3. 免费模型选型（Runtime 实测结论）

> 适用：OpenCode 2.0 通过 `api` 子命令 + `opencode2-driver.mjs` 执行时的模型选择。

- **目录里挂着的免费模型 ≠ 网关实际可用**。免费模型由网关动态提供，模型目录不会实时同步可用状态。
- `ling-3.0-flash-free` / `deepseek-v4-flash-free`：实测 401/400——401 是网关拒绝凭证对该模型访问，400 是模型名已不被后端识别（可能下线/改名）。
- `big-pickle`：实测 429 限流（免费额度限制）。
- `hy3-free`：已废弃。
- **最终选定 `nemotron-3-ultra-free`**（内置 `opencode` provider 的免费模型，1M 上下文 / 128K 输出，工具调用可用）。默认模型定义见 `packages/agent-runtime/src/index.ts` 的 `opencode.buildCommand`。

## 4. OpenCode 2.0 驱动经验

OpenCode 2.0 去掉了 v1 的 `-p --print`，非交互执行走 `api` 子命令 + `opencode2-driver.mjs`（会话创建 → 轮询 `message` 端点 → 按 `finish === 'stop'` 判定完成）：

- **`history` 端点分页失效**：`limit`/`after` 参数被忽略，总是返回前 50 个事件。改用 `message` 端点。
- **完成判定**：最新 assistant 消息的 `finish === 'stop'` 才是可靠终态；`tool-calls` 表示仍在工作。基于内容启发式会误判（只读到第一条文本就"完成"）。调试日志写到 `<workspace>/.agent-dev/opencode-driver-<ts>.json`（`OPENCODE_DRIVER_LOG` 开启）。

## 5. 环境前提（会被误判成产品缺陷）

### 5.1 网络与代理

- 本机所有 `*.vercel.app` 对不走系统代理的进程都是 DNS 污染（连不存在的域名都能解析出地址），或 TLS 连接被重置。必须用系统代理，且 Node 的 `fetch` 需要 `NODE_USE_ENV_PROXY=1` 才读代理变量。
- **Daemon 必须带 `https_proxy`/`http_proxy`/`no_proxy=localhost,127.0.0.1`/`NODE_USE_ENV_PROXY=1` 启动**，否则 `verify-api-health`、`verify-joint-smoke` 会报 `fetch failed`。
- 代理链路本身有抖动，健康检查偶发 `fetch failed`，手工 curl 显示第一次 000、第二三次 200，重跑即过。

### 5.2 Cloudflare Pages 域名生效延迟

- 新建的 Cloudflare Pages 域名有几秒才生效，**第一次联合 Smoke 失败、重跑即过**（`preview/deploy` 幂等键一致，可直接重跑）。已确认是域名生效延迟，不是代码缺陷。

### 5.3 CLI 版本与 PATH

- 本机 PATH 上有多个 codex。**codex 0.147.0 与 `~/.codex/config.toml` 的 `ark-code-latest` 模型不兼容**（刷 `ERROR codex_core::util: ReasoningSummaryDelta without active item` 直到超时）。建议卸载或降级 npm global 的 codex 0.147.0。
- **Daemon 的 PATH 需同时含**：node22（运行时）、homebrew（codex 0.142.3）、fnm node20 全局 bin（`vercel`/`wrangler`），否则出现 codex 超时或 `Vercel is not authenticated`。
- shell 默认 Node 20 会让 `wrangler` 直接拒绝运行（要求 ≥22）。`.node-version` 为 `22`。
- 所有 GitHub CLI 调用注入 Agent-Dev 保存的 `GITHUB_TOKEN`；凭证保存/删除后废弃 Provider CLI 可用性缓存。

## 6. 遗留真实资源（未清理）

以下 Preview 资源仍留在账号里，清理入口 `POST .../preview/cleanup`（确认串 `CLEANUP_PREVIEW`）：

- `receipt-test-api-pr-1`（Vercel）、`receipt-test-web-pr-1`（Cloudflare）
- `workspace-verify-fresh-api-preview`（Vercel）、`workspace-verify-fresh-web-preview`（Cloudflare）
- `link-vault-api-pr-1`（Vercel）、`link-vault-web-pr-1`（Cloudflare）

生产侧项目是交付物，**不应清理**：`receipt-test-api`/`receipt-test-web`、`workspace-verify-fresh-api`/`workspace-verify-fresh-web`、`link-vault-api`/`link-vault-web`。
