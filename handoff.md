# Agent-Dev 项目交接

> 更新时间：2026-08-24
> 当前阶段：三个真实项目——`Receipt Test`（1/3）与 `Workspace Verify Fresh`（2/3）均已完整交付上线；项目 3 `Link Vault`（3/3）实现已由 OpenCode 完成、Quality Gate 通过、验收记录就绪，停在交付批准门前；Local Delivery Control Plane 已实现；真实 Provider Adapter 已验证通过（GitHub/Vercel/Cloudflare 真实接入，Supabase Manual 降级）；凭证管理 Phase 2 已实现
> 工作目录：仓库根目录

## 最近进度

- **项目 3（`Link Vault`）实现已完成，停在交付验收批准前**（本节写于 2026-08-24）。功能是「API 保存并返回链接 + 页面表单与列表」：
  - **Runtime 切到 OpenCode 2.0 驱动**：Codex 因火山方舟套餐额度耗尽持续 429（`exceeded retry limit, last status: 429`），改为 OpenCode 2.0 会话式执行。OpenCode 2.0 去掉了 v1 的 `-p --print`，非交互执行走 `api` 子命令 + `opencode2-driver.mjs`（会话创建 → 轮询 `message` 端点 → 按 `finish === 'stop'` 判定完成）。驱动在 `576b701` 提交（`fix(runtime): complete opencode runs on finish=stop and switch to nemotron-3-ultra-free`）。
  - **免费模型选型（实测结论）**：目录里挂着的免费模型 ≠ 网关实际可用。`ling-3.0-flash-free`/`deepseek-v4-flash-free` 实测 401/400（网关不认模型名或凭证无权）；`big-pickle` 实测 429 限流；`hy3-free` 已废弃。最终锁定 `nemotron-3-ultra-free`（内置 `opencode` provider 的免费模型，1M 上下文 / 128K 输出，工具调用可用），设为 OpenCode 默认模型。默认模型定义见 `packages/agent-runtime/src/index.ts` 的 `opencode.buildCommand`。
  - **运行结果**：attempt 4 `completed`（exit 0）。工作区提交链：`121deab`(feat: Add link saving with a title and URL) → `9ac2290`(runtime: completed) → `ab6fe73`(fix(web): resolve API base URL from api-base-url meta tag) → `640cee1`(chore: record quality gate passed) → `204f709`(acceptance: ready)。Quality Gate `passed`（lint/typecheck/5 单测/build/smoke），验收记录 `status=ready`、`criteriaConfirmed=true`。
  - **当前卡点**：验收批准（`POST .../acceptance/approve`，确认串 `APPROVE_DELIVERY`，需具名批准人）——人工门，等用户确认。批准后走真实 GitHub Provider（开 PR → Preview → 生产发布），项目 2 的生产发布路径尚未在项目 3 复用前跑真实云端发布。
  - **项目 3 待办**：用户批准验收 → `delivery/pull-request`（真实 GitHub 仓库 `bayernjf/link-vault`）→ PR CI → Preview → `release/request` + `release/approve`（人工）→ 生产上线。

- **项目 2（`Workspace Verify Fresh`）已完整交付上线（2/3，2026-08-23 生产批准后完成）**。此前状态是 PR + Preview、生产停在人工批准前；用户批准后走 `release/request` + `release/approve`，生产从 `main` 独立 checkout 发布（修复路径 `962932a` 的第一次真实云端验证）。详情见下节（写于 2026-08-23）：
  - **归属修订**：旧 Blueprint 里四个归属字段全是 `test` 占位。发新 revision 3，把 `githubOwner`/`vercelTeam` 换成 `bayernjf`、`cloudflareAccount` 换成 `Jiangfengkxi@outlook.com's Account`、`supabaseOrganization` 换成 `jiangfengkx@163.com's Org`（前三个用 `gh api user`/`vercel whoami`/`wrangler whoami` 现场核实，与 `Receipt Test` 一致）。基线、Feature Task、交付验收三处闸门都按新规则具名 `feng` 通过——这是 Studio 新闸门输入框之外，通过 API 第一次验证「每个闸门都要求具名」。
  - **真实 Provider 接入**：`providers/apply` 创建私有仓库 `bayernjf/workspace-verify-fresh`；Vercel/Cloudflare 同名 Preview 项目已存在（上一轮 `workspace-verify-fresh-*` 按用户要求保留），noop 记录归属；Supabase 走 Manual noop。
  - **Feature Task + Codex 执行**：功能是「API 新增 `GET /api/version` 返回版本号，页面渲染 `API v1.0.0`」。Codex 改了 3 个文件 23 行（`apps/api/src/index.ts`、`apps/web/src/main.tsx`、`apps/api/src/health.test.ts`），本地 Quality Gate `passed`，人工验收批准后平台开 PR #1、状态 `PR_OPEN`。
  - **本轮修掉第 7 个真实缺陷（Codex 创建外部 symlink 绕过产物提交拦截）**：Codex 为了跑测试，把 `/private/tmp/scaffold-check3/node_modules` 以**绝对路径符号链接**挂进 workspace。生成器模板的 `.gitignore` 写的是 `node_modules/`（目录模式），而目录模式不匹配符号链接，于是平台把这个死链提交进了产品仓库——推上 GitHub 后任何 clone 都得到指向 `/private/tmp` 的无效链接。修复分两处：`commitAgentChanges` 新增「workspace 外部符号链接」拦截（`lstat` 识别 symlink，`readlink`+`resolve` 判断是否逃出 workspace，命中则 `git reset` 并把该次运行判 `failed`，与 `.env` 拦截同一套哲学）；生成器模板 `.gitignore` 从 `node_modules/` 改为 `node_modules`（同时匹配目录、文件和符号链接）。新增回归测试，`npm test` 110/110 全绿。当前 workspace 已同步 `.gitignore` 并把死链移出索引（提交 `1179738`），`.agent-dev/apply/.../revision-3` 干净。
  - **Codex 版本不兼容（环境问题，非产品缺陷）**：本机 PATH 上有三个 codex——`/opt/homebrew/bin`（0.142.3，handoff 验证过的版本）、fnm node20 全局（0.147.0）、`/usr/local/bin`（0.139.0）。原 Daemon 进程因 PATH 顺序解析到 0.147.0，该版本与 `~/.codex/config.toml` 的 `ark-code-latest` 模型不兼容：输出刷 `ERROR codex_core::util: ReasoningSummaryDelta without active item` 直到 15 分钟超时被 SIGKILL。重启 Daemon（homebrew 0.142.3 优先）后 retry 一次通过，功能提交 `24a5972`。**建议卸载或降级 npm global 的 codex 0.147.0**，否则任何依赖 PATH 顺序的工具都可能再踩。同时 Daemon 的 PATH 需同时含 node22（运行时）、homebrew（codex 0.142.3）和 fnm node20 全局 bin（`vercel`/`wrangler`），否则 Vercel 认证会报 `Vercel is not authenticated`。
  - **Preview 部署卡在联合 Smoke，是 Cloudflare 证书延迟，不是代码缺陷（已恢复并补跑通过）**：`preview/deploy` 前 6 步成功，仅最后联合 Smoke 需要 HTTPS 访问刚建的 preview 域名，被未就绪的证书挡住。诊断结论：全局两层 `*.pages.dev` 证书正常（生产 `receipt-test-web.pages.dev` → 200），但**项目级三层 `*.project.pages.dev` 证书走代理时返回 TLS `handshake failure`（alert 40）**——连 4 小时前 7/7 通过的 `pr-1.receipt-test-web-pr-1.pages.dev` 当时也 TLS 握手失败，说明是网络环境在此期间变化，而非部署代码问题。证书恢复后补跑，**7/7 步全部 `completed`**：`pagesUrlSource: cli-output`、精确 CORS `corsOrigin` 严格等于 `ALLOWED_ORIGIN`（`https://pr-1.workspace-verify-fresh-web-pr-1.pages.dev`），Evidence 写入 `.agent-dev/previews/workspace-verify-fresh-pr-1.json`。独立复验：页面 HTML 正确注入 API 域名、`GET /api/version` 真实返回 `{"version":"1.0.0"}` + 200。
  - **本轮修掉第 8 个真实缺陷（生成的 CI 在首个 PR 必然失败）**：脚手架模板 README 明说「首次 `npm install` 才生成 `package-lock.json`、之后由用户提交」，但生成的 `quality.yml` 用的 `actions/setup-node@v5` 默认开启依赖缓存，在仓库根搜不到 lock 文件就硬报 `Dependencies lock file is not found` 并失败——**第一个 PR 的 CI 永远跑不过，除非用户手动补 lock 文件**。项目 2 的 PR #1 `quality` 就因此 `FAILURE`。修复：模板 `quality.yml` 给 `setup-node` 加 `cache: ''`（禁用缓存探测），让 `npm install` 自己生成 lock 文件；同时对项目 2 workspace 真实 `npm install` 生成 `package-lock.json` 并提交推送（去掉此前 Codex 挂的 `/private/tmp` symlink）。重推后 PR #1 `quality` 转 `SUCCESS`、`MERGEABLE`。新增 blueprint 回归测试断言模板含 `cache: ''`。
  - **项目 2 待办**：生产发布（`release/request` 后由用户本人 `release/approve`）——这将是「生产从生产分支 checkout 发布 + 要求被验收提交是该分支祖先」这条修复路径（`962932a`）的第一次真实云端验证。当前 PR #1 `quality` 已绿、`MERGEABLE`，待合并 PR 进 `dev` 后即可发起发布。

- **第一个真实项目已完整交付上线（`Receipt Test`，第 8 节第 7 项的 1/3）**。从 Blueprint 到生产全部走真实 Provider，状态机终点 `DELIVERED`，功能是「显示 API 连接状态的收据页面」。
  - **真实资源与证据**：仓库 `bayernjf/receipt-test`（PR #1 `feature/agent-dev/revision-5 → dev`，GitHub Actions `quality` 通过后合并，合并提交 `21d0e75`，`dev` 携带被验收的 `553a8e0`）；生产 API `https://receipt-test-api.vercel.app`，生产页面 `https://receipt-test-web.pages.dev`；批准人 `feng`。已在平台报告之外独立复验：API 返回 `200 application/json`，带正确 Origin 时回精确 `access-control-allow-origin`、带 `https://evil.example.com` 时**一个 CORS 头都不返回**；线上 JS bundle 里能找到本次功能的中文串（`管理个人收据`、`连接状态`、`已连接`、`连接失败`），证明上线的是功能而非脚手架。
  - **这一轮修掉 6 个真实缺陷，没有一个是单元测试自己能发现的**（全部由真实链路暴露）：
    1. **Agent 写的代码从来没被提交**（`874fd3c`）。流水线里每次 commit 都只 `git add` 自己刚写的报告文件，Agent 自己不提交，于是被推送、被评审的分支上只有脚手架——人工验收的那个功能根本不会上线。现在 Runtime 运行成功后由平台提交 Agent 的改动。
    2. **`git add -A` 会把密钥和 Provider 状态提交进产品仓库**（`7d3b6b0`）。生成脚手架此前不带 `.gitignore`，而 workspace 里有真实凭据的 `.env`、`.vercel/`、`.wrangler/`、`.agent-dev/`。补全生成的 `.gitignore`，并加一道拦截：暂存区出现 `.env` 时**不提交**，把该次运行降级为 `failed` 并说明原因（提交密钥不可事后修复；此处不能用 `throw`，运行状态已写成 `running`，抛错会把运行卡死且无法重试）。
    3. **新仓库没有 PR 的基线分支**（`5e38f69`）。`gh repo create --push` 只发布 feature 分支，架构第 10 节要求的 `feature/* -> dev -> main` 因此第一个 PR 就开不出来。改为在基线（root）提交上创建声明的 `dev`/`main` 并把 `main` 设为默认分支——用基线而不是当前 HEAD，是为了不让待评审的功能已经躺在生产分支上。
    4. **已存在的仓库永远补不到这两个分支**（`89b3585`）。上一条只在"新建仓库"分支里执行，而 `Receipt Test` 的仓库是修复前建的，重跑 `providers/apply` 也不会补。改为 apply 每次都确保声明的分支存在（容忍 `Reference already exists`）。这条就是被真实仓库逼出来的。
    5. **PR 只能靠人手抄 URL**（`a39be2b`）。新增 `POST /api/projects/:id/delivery/pull-request`（确认串 `OPEN_PULL_REQUEST`）：平台自己推送并开 PR，再回填证据。五道前置校验：Blueprint revision 一致、Feature Task 已批准、交付已验收、Apply 运行已完成、工作区干净；推送前校验 `origin` 必须等于资源清单里记录的仓库（否则会把产品发到没人记录的地方），并要求 HEAD **包含**被验收的提交（不是相等——验收之后平台还会提交自己的报告）。`POST .../delivery/pr-evidence` 保留为人工兜底。
    6. **生产发布用的是被保护的部署 URL**（`8afb9bd`）。`vercel deploy --prod` 回传的是不可变部署地址，它被 Deployment Protection 挡着（302 到 `vercel.com/sso-api`），于是健康检查把一个健康的 API 判成坏的；更严重的是下一步会把这个用户访问不到的地址写进 `VITE_API_BASE_URL`，**发出一个连不上自己 API 的生产前端**。改为 `vercel inspect --format=json` 取别名并使用最短的那个（长的带团队作用域，同样受保护）。这次失败恰好挡住了一次坏发布。
  - **本轮暴露的两处架构缺口已于 2026-08-23 修掉**（在项目 2 之前，`962932a`、`0dbd15c`）：
    1. **生产是从本地 workspace 发布的，不是从生产分支**（`962932a`）。`ReleaseComposer` 从不 checkout `main`，也不检查被验收的提交是否已合并，与架构第 10 节「生产从 `main` 出」矛盾——生产上跑的代码可能从未落到 `main`，无法从生产分支复现线上版本。现在发布前先 clone/fetch/reset 记录仓库的生产分支（每次尝试都 reset，避免重试发出上一次残留的位），校验被人工验收的提交是该分支 HEAD 的祖先（不是则拒绝并提示先合 PR），再在这个 checkout 上装依赖、跑质量门禁、构建和部署；Evidence 记下 `repository/branch/commit/acceptedCommit`。没有记录仓库或没有验收时，`release/plan` 直接给出原因、`release/request` 返回 409，Studio 把原因显示出来并禁用按钮，而不是静默发布 workspace。
    2. **人工闸门的身份口径不一致**（`0dbd15c`）。基线、Feature Task、交付验收三处的 `approvedBy` 会回落到字面量 `local-user`（revision 5 的验收报告就带这个占位名），而生产批准要求具名（`feng`）。现在四处统一：API 强制要求 approver，Studio 在每个闸门收集姓名并记在浏览器本地，输入为空时不发请求。
    - 两处都有测试覆盖（`npm test` 109 项全绿），但**尚未在真实云端跑过一遍**——真实验证要靠项目 2。Studio 的三个新输入框只做了类型与构建校验，尚未在浏览器里渲染过：现存项目都已越过这三个闸门，等项目 2 的新 revision 重新打开基线闸门时再看。已在浏览器里确认的只有发布区块的阻塞文案（现存项目没有记录仓库，显示"没有记录仓库…先 apply 真实 GitHub Provider"并禁用按钮）。
    - **规则本身也补进了文档**（`96fd261`）：架构第 9 节「dev 与 production」原先只说 `main` 即生产、没说发布来源，实现才得以偏离，现在明确写下「生产从生产分支的独立 checkout 发布，且该分支必须已带上被验收的提交」；`docs/implementation-plan-v0.1.md` 与 `README.md` 的生产链路状态同步为"真实云端跑通一次，但走的是修复前的路径"。
  - **遗留真实资源（未清理）**：Preview 侧 Vercel `receipt-test-api-pr-1`、Cloudflare Pages `receipt-test-web-pr-1`（清理入口 `POST .../preview/cleanup`，确认串 `CLEANUP_PREVIEW`）；生产侧 `receipt-test-api`、`receipt-test-web` 是交付物，不应清理。另有前一轮的 `workspace-verify-fresh-*` 两个 Preview 项目仍在账号里。
  - **环境前提（会被误判成产品缺陷）**：本机所有 `*.vercel.app` 对不走系统代理的进程都是 DNS 污染（连不存在的域名都能解析出地址），必须用系统代理，且 Node 的 `fetch` 需要 `NODE_USE_ENV_PROXY=1` 才读代理变量。Daemon 必须带 `https_proxy`/`http_proxy`/`no_proxy=localhost,127.0.0.1`/`NODE_USE_ENV_PROXY=1` 启动，否则 `verify-api-health`、`verify-joint-smoke` 会报 `fetch failed`。另外新建的 Cloudflare Pages 域名有几秒才生效，第一次联合 Smoke 失败、重跑即过（已确认是域名生效延迟，未误记为缺陷）。

- **生产交付路径与失败 workspace 恢复已实现**（本节写于 2026-08-21，当时真实云端未跑；真实云端已于 2026-08-23 跑通，见上一条）。此前 Daemon 只覆盖到 Preview，`handoff.md` 第 8 节第 7 项因此被阻塞；现在两条前置路径都在：
  - **生产发布**：新增 `ReleaseComposer`（`packages/deployment-composer/src/release.ts`），按架构第 10 节顺序编排 7 步：`release-quality → deploy-api-production → verify-api-production → build-web-production → deploy-web-production → verify-production-smoke → write-release-evidence`。它**故意不关闭 Vercel Deployment Protection**——那对一次性 Preview 站得住，对生产是错的，因此写成了一条负向断言测试防止将来被悄悄改回来。生产项目名不带分支后缀（一个产品只有一对生产项目），生产 Web origin 由 Cloudflare Pages 项目 apex 推导（Blueprint 里没有生产域名字段），这让 API 的 `ALLOWED_ORIGIN` 与被验证的 URL 在构造上必然相等。
  - **两道人工闸门**：新增 `release_runs` 表（migration 0005）与 `POST .../release/request`、`.../release/approve`、`.../release/retry`。`approve` 必须带 `approvedBy` 与 `summary`，空值被拒（错误信息要求说明"谁批准的"）；没有批准就调用 `approveRelease` 会被状态机拒在 `AWAITING_APPROVAL`，且不写任何日志行。Evidence 记录的是**观测值**（HTTP 状态、content-type、实测 CORS 响应头、页面字节数），不是 `passed` 这类判定常量——有一条测试断言序列化后的 observations 不含 `"passed"`。
  - **失败/过期 workspace 恢复**：`POST .../apply/recover` 不在原地修复，而是新建 `revision-N-recovery-M` 的干净 workspace，把旧的留在磁盘上并先报告它的 Git 状态（分支、HEAD、`status --short`、`diff --stat`）。workspace 可用时该接口返回 409，避免退化成常规重新 Apply。`apply_runs` 新增 `recovery_index` 让同一 revision 的多次运行有确定顺序（`created_at` 在同毫秒插入时做不到）。
  - **同时修掉四个真实缺陷**：Provider 项目名未 slug 化；`FAILED.RETRY` 固定回到 `VERIFYING`（失败的发布会被送错状态，现按失败处回到 `RELEASING`）；生成产品的 CI 钉在已废弃的 actions 版本；Preview Evidence 的判定字段是硬编码常量。**注意**：第三项让所有已存在的 workspace 立即变成 `staleConfig`——这正好是恢复路径的第一个真实用例，Daemon 测试就是这么验的。
  - **未验证边界**：`advanceDelivery` 的两次写入仍不在同一事务里（既有问题，本轮不扩大也不修复）。真实云端生产发布已于 2026-08-23 在 `Receipt Test` 上跑通（由用户本人按下批准，我不会代按），并暴露了「发布用被保护的部署 URL」这个缺陷。
- **CI 首次真实运行暴露一个环境依赖测试**：`quality` 在 PR #3 上失败，原因是 `apps/daemon/test/app.test.ts` 断言 runtime catalog 含 `id: 'codex'` 的内置 Agent，而 catalog 的设计是只返回 PATH 上真实存在的内置 Agent，runner 上没装 Codex CLI 因此返回空数组。这个测试只在装了 Codex 的机器上能通过，是测试依赖本机环境而非产品缺陷；已改为断言路由真正拥有的契约（200、数组、每项 detected 且有 launchCommand、内置项 source 正确）。修复方式经过 CI 条件复现验证：用剥掉 codex 的最小 PATH 跑，先确认 `which codex` 返回 1，再确认全部 74 个测试通过，排除同类环境依赖测试潜伏。同时把 `actions/checkout` 与 `setup-node` 升到 v5（v4 target 已废弃的 Node 20，被强制跑在 Node 24 上并告警）。PR #3 → `dev`、PR #4 → `main` 均已合并，`main` 上 `quality` 为绿。随后本节文档变更经 PR #5 → `dev`、PR #6 → `main` 合并，`main` 当前为 `23d4e6c`，`quality` 仍为绿。
- **Studio 启用产品 logo**：此前 Studio 完全没有 favicon，侧边栏用的是 lucide 通用 `Boxes` 图标，与 landing 站没有任何视觉一致性。logo 从 landing 站 `public/favicon.svg` 原样复制（保持两边字节一致），挂为 favicon 并替换侧边栏品牌位。注意：**未做浏览器肉眼验证**（本机无可用预览浏览器），仅验证了 dev server 下两个资源均 200、构建产物包含它们且 `index.html` 引用正确。
- **市场分析补入实证注记**（`docs/market-analysis.md` 6.1）：壁垒清单此前全部是判断，真实云端首跑为其中"真实 Gate 和证据链"一项提供了数据支撑，同时说明为何结论不是移除模板生成器——模板不构成壁垒但承载新手模式，该修的是它的冻结形态。
- **Dual Preview 真实云端端到端已跑通（7/7 步），过程中修掉 5 个真实缺陷**。最终 Evidence：`.agent-dev/previews/workspace-verify-fresh-preview.json`，`pagesUrlSource: cli-output`，`apiHealth` / `exactCors` / `pageContainsApiUrl` / `jointSmoke` 全部 passed。已在编排之外独立复验：分支别名与每次部署的哈希域名两个 Pages URL 都返回 200 且 HTML 中带正确的 API 域名，API 对别名 Origin 回精确 `access-control-allow-origin`。修掉的缺陷：
  1. **生成的 API 模板在 Vercel 上永久挂起**。`export default handle(app)` 返回 Web fetch 风格的 `Response`，但 Vercel 按传统 `(req, res) => void` 签名处理默认导出并丢弃返回值，请求永远拿不到响应（Vercel 运行时日志：`WARN: default export returned a Response`）。根路径能瞬间 404 而 `/api/health` 挂满 40 秒，正好排除了网络因素。改为按 HTTP 方法导出 fetch-style handler（`export const GET/POST/OPTIONS = handle(app)`）；本地 dev 的 `serve()` 守卫从宽泛的 `NODE_ENV !== 'production'` 改为精确的 `!process.env.VERCEL`，避免删掉 `serve()` 破坏 `npm run dev`。
  2. **生成的 API 模板没有 CORS 中间件**。Composer 一直注入 `ALLOWED_ORIGIN`，但模板从不读它，响应完全没有 `access-control-allow-origin`，而健康检查要求它精确等于 CORS origin。补上 `hono/cors`，`origin: process.env.ALLOWED_ORIGIN ?? '*'`。
  3. **生成的前端从不消费 `VITE_API_BASE_URL`**。Composer 注入了变量、写了 `.env.preview`，但模板里没有任何引用，构建产物里自然找不到该 URL，联合 Smoke 的"页面包含 API 地址"必然失败（该检查只读页面 HTML，即使 bundle 里有引用也不够）。`index.html` 增加 `<meta name="api-base-url" content="%VITE_API_BASE_URL%">` 走 Vite 的 HTML 变量替换，`main.tsx` 改为真的去 `fetch(${apiBaseUrl}/api/health)` 并渲染状态——这让 Golden Path 的"前端跨域调用 API"变成真实行为而非文档描述。
  4. **`WRANGLER_LOG: 'none'` 同时破坏了幂等性和 URL 解析**。Cloudflare 建项目那步的幂等判断依赖 stderr 里的 `already exists` 文本，而该环境变量把这句话压掉了（手工复现：带该变量时 wrangler 退出码 1 且无任何输出，不带时 stderr 明确给出 `A project with this name already exists ... [code: 8000002]`），导致第一次能建、之后每次重跑必挂；部署那步同样被压掉了 Wrangler 回传的真实 Pages URL，使 `pagesUrlSource` 永远退化成 `derived-fallback`。两处都移除该变量，并加了断言 create 调用 env 不含 `WRANGLER_LOG` 的回归测试——原有那条"已存在项目"测试直接 mock 出 `already exists` stderr，因此永远发现不了这个问题。
  5. **联合 Smoke 的 CORS 校验对象错了**。API 的 CORS 锁在**分支别名** `preview.<project>.pages.dev`，但 Smoke 拿 Wrangler 回传的**每次部署哈希域名**去校验，必然 mismatch。改为统一用别名校验：别名才是 Reviewer 打开的稳定链接，哈希域名每次部署都变。此前该检查只是因为 URL 解析失败退化成别名才"碰巧"通过——缺陷 4 修好、真实哈希域名第一次被解析出来后，这个矛盾才暴露。
  - **环境前提（非代码问题，但会阻塞复现）**：本机直连访问不了任何 `*.vercel.app`（TLS 连接被重置），必须走本机代理；Node 的 `fetch` 默认不读代理环境变量，Node 22.23 需要 `NODE_USE_ENV_PROXY=1` 才生效。另外 shell 默认 Node 20 会让 `wrangler` 直接拒绝运行（要求 ≥22）。代理链路本身有抖动，健康检查偶发 `fetch failed`，手工 curl 显示第一次 000、第二三次 200，重跑即过（未误记为代码缺陷）。
  - **免长期凭据路径已在真实环境确认**：真实 Vercel 项目在 `vercel api -X PATCH --input <file>` 后 `ssoProtection` 与 `passwordProtection` 均为 `null`，不再只是单元测试断言。
  - **现存真实资源**：Vercel 项目 `workspace-verify-fresh-api-preview`、Cloudflare Pages 项目 `workspace-verify-fresh-web-preview` 仍在账号里，未清理（清理入口 `POST .../preview/cleanup`，`confirmation: CLEANUP_PREVIEW`）。
- **Preview 部署前新增 workspace 产物校验，并修复状态库路径二义性**：
  - 新增 `verifyWorkspaceArtifacts()`（`packages/blueprint/src/workspace.ts`），在创建任何外部资源之前校验 Apply workspace。存在性检查覆盖全部生成产物；内容比对只覆盖部署配置产物（`vercel.json`、`wrangler.toml`、产品 CI），因为应用源码本就会被 Agent 的功能任务修改，全量比对会把正常改动误判为漂移。Daemon 的 `GET .../preview/plan` 与 `POST .../preview/deploy` 均已接入，不可用时返回 409。这挡住了一类真实故障：workspace 被冻结在生成它的那版 generator 上，后续 generator 修复不会回填，旧 workspace 会带着无效配置直接进入部署（且 `apply/retry` 只接受 `failed`，已完成的 Apply 没有受支持的重生成路径）。
  - 用真实数据验证有效：对 `Receipt Test` revision-2 workspace 返回 409、`staleConfig: ['apps/api/vercel.json']`、`missing: ['apps/web/src/main.tsx']`。追查后发现该 workspace 已被两次失败的 Codex 运行破坏（workspace git log 有两组 `runtime: start Codex execution` / `runtime: failed`，`git status` 显示 `D apps/web/src/main.tsx` 而 `index.html` 仍引用它）——这正是 `codex-runtime.md` 列为未验证的"失败 workspace 恢复"场景的真实实例，缺失的是产品源码而非配置，重生成配置无法修复。
  - 因此另建 project `Workspace Verify Fresh` 走一次本地 Apply（纯本地模拟器，`noExternalChanges: true`），得到当前模板的干净 workspace，`preview/plan` 返回 200、`usable: true`。上述真实云端端到端就是在这个 workspace 上跑通的。
  - 修复 Daemon 状态库路径二义性：`databasePath` 原先基于 `process.cwd()`，而 `npm run -w @agent-dev/daemon dev` 会把 cwd 设为包目录，导致 `apps/daemon/.agent-dev/` 与仓库根 `.agent-dev/` 两个数据库并存、项目状态被静默拆分（我自己就因此查错了库）。新增 `resolveWorkspaceRoot()` 向上寻找声明了 `workspaces` 的 `package.json` 作为锚点，并在启动日志打印实际使用的数据库路径。遗留数据已迁移到仓库根 `.agent-dev/`（88M，含两个 Apply workspace），`apply_runs.workspace_path` 里的两条绝对路径同步重写并验证目录存在；迁移前的空库保留为 `.agent-dev/agent-dev.sqlite.empty-pre-migration`，迁移前备份在 `/tmp/agent-dev.sqlite.premigration`。
  - 收尾时 `npm run build` 暴露一个由本次改动引入的真实回归：`workspace.ts` 用 `node:fs/promises` 读产物，而它被 blueprint 的 barrel 再导出，Studio 在浏览器里 import barrel，于是 `node:fs` 被拖进 Vite 打包并直接构建失败（`"readFile" is not exported by "__vite-browser-external"`）。typecheck 和 test 全绿也发现不了——只有 build 会。改为通过 `@agent-dev/blueprint/workspace` 子路径导出，barrel 不再引用它；Daemon 与其测试改走子路径，根 `vitest.config.ts` 的 alias 改为数组并把子路径规则排在前面（alias 是前缀匹配，裸包名规则会把子路径重写成不存在的目录）。这也正是上一条新增的 `quality.yml` 会拦住的那类问题。
- **`VERCEL_TOKEN` 硬依赖已移除，Composer 端到端阻塞解除**：`vercel api` 子命令能复用 CLI 现有登录态发认证请求（已用只读 `vercel api /v9/projects` 取得真实数据验证）。`disableVercelDeploymentProtection()` 现在分两条路径：设置了 `VERCEL_TOKEN` 走原 REST API `fetch`，未设置则走 `vercel api -X PATCH /v9/projects/{name} --input <body.json>`。请求体必须经 `--input` 文件传入，因为 `--field` 会把 `null` 强制成 `""`（已用 `--generate=curl` 干跑确认）。`deployVercelPreview` 的前置检查从"必须有 token"改为 `ensureVercelAuth()`：有 token 或 `vercel whoami` 成功即可。这也消除了原先的实现不一致——同文件其他步骤（`project add`、`deploy`、`project rm`）本就走 CLI 会话，只有这一步降级到裸 `fetch` 而需要长期凭据。两条路径均有单元测试，Composer 现有 13 个用例全部通过。注意 `vercel api` 标注为 beta；若将来要在 GitHub Actions 等无交互登录环境运行 Composer，仍需 token（v0.1 为 local-first，Daemon 跑在本机）。真实云端端到端已重跑通过（见本节首条）。
- **Agent-Dev 自身质量门禁已建立**：新增 `.github/workflows/quality.yml`（`npm ci` → `typecheck` → `test` → `build`，带 `concurrency` 取消旧运行）。此前项目为其生成的产品生成 CI，自己却没有任何 CI。同时修复了一个真实缺陷：`npm ci` 在 Node 20 下必然失败（`wrangler@4.120.0 → @cloudflare/kv-asset-handler@0.5.0` 要求 node ≥22，`.npmrc` 的 `engine-strict=true` 使其成为硬错误），而 `package.json` 仍声明 `>=20.20.0`。已新增 `.node-version`（`22`）作为本地 fnm 与 CI `actions/setup-node` 的唯一来源，并把 `engines.node` 提升为 `>=22.0.0`。
- **Dual Preview 部署编排已实现为正式产品代码**：新增 `packages/deployment-composer` 包，`DeploymentComposer` 按 7 步幂等编排 Vercel API Preview → 关闭 Vercel SSO/Password Protection → API 健康验证 → VITE_API_BASE_URL 注入 → 前端构建 → Cloudflare Pages Preview → 联合 Smoke → Evidence 写入。精确 CORS origin（`https://<branch>.<project>-web-<branch>.pages.dev`，替换 Spike 中的 `*`），临时项目清理 API 支持 PR 关闭后删除 Vercel/Cloudflare 项目。Daemon 新增 `POST /api/projects/:projectId/preview/deploy`、`GET .../preview/plan`、`POST .../preview/cleanup` 三个路由；Studio 在 Quality Gate 通过后显示 Dual Preview 部署区块。
- **PR 关闭自动清理已实现**：Daemon 的 `POST /api/github/webhooks` 仅接受 HMAC SHA-256 验证通过的 GitHub `pull_request.closed` 事件。部署请求传入 `pullRequestNumber` 时，Preview 分支固定为 `pr-<number>`；Webhook 使用该编号推导 Vercel/Cloudflare 临时项目名并执行清理。无效签名、非 PR 事件和未匹配本地项目不会触发删除。本地 API 测试覆盖成功清理、签名拒绝和事件忽略；真实云端清理仍需与 Composer 一起复验。
- **Deployment Composer 端到端阻塞已修复**：补上了 Spike 验证过但正式代码遗漏的 Vercel SSO Protection 关闭步骤——在 `deployVercelPreview` 成功后通过 Vercel REST API `PATCH /v9/projects/{name}` 将 `ssoProtection` 和 `passwordProtection` 设为 `null`，否则 `*.vercel.app` URL 被 Deployment Protection 挡住导致健康检查超时。`VERCEL_TOKEN` 获取路径改为 `providerCredentialEnv() ?? process.env.VERCEL_TOKEN` 双路获取。新增根级 `vitest.config.ts` 用 `resolve.alias` 解析 workspace 内部包依赖，修复了 vitest 无法解析 `file:` 协议 workspace link 的问题（此前 3 个测试文件因模块解析失败无法加载）。
- **Deployment Composer 端到端配置修复**：补上了 Spike 验证过但正式代码遗漏的 Vercel SSO Protection 关闭步骤，并修复生成模板的 Vercel runtime 配置；生成 API 现在使用 `@vercel/node` builder 和 Hono `hono/vercel` adapter。
- **Provider 与验证可靠性修复**：根级 `npm test` 现在直接执行一次 `vitest run`，与根级测试配置一致；所有 GitHub CLI 的发现和创建调用都注入 Agent-Dev 保存的 `GITHUB_TOKEN`；凭证保存或删除后会废弃 Provider CLI 可用性缓存。资源清单改为写入资源级事实（外部 ID、URL、非敏感元数据）而非原始通用状态。Cloudflare Preview 证据会优先记录 Wrangler CLI 回传的实际 Pages URL，并标识 `cli-output` 或 `derived-fallback` 来源。
- **凭证管理 Phase 2 已实现**：`verifyCredentials()` 通过 CLI（gh/vercel/wrangler/supabase）验证各 Provider Token 有效性；Studio 凭证面板新增首次引导模式（无凭证时自动进入分步引导）、Supabase 手动配置区块（遵循用户决策：Supabase 不做自动化，仅引导用户手动创建项目后填入 URL/Key）、自定义第三方 API Key 管理和凭证验证 UI。
- Dual Preview Spike 已通过真实云端验证：Vercel API 部署（`/api/health` 公网可访问）、Cloudflare Pages 部署、跨域通信和 API URL 注入均取得真实 Evidence。解决了 Vercel SSO Protection 阻塞公网访问、`vercel.json` 配置、API Handler 兼容性、部署目录和 Cloudflare 构建注入等问题。详见 [Dual Preview Spike](docs/spikes/dual-preview.md)。
- Supabase Auth Spike 已确认采用 Manual 降级路径（路径 C）：由用户手动完成 Supabase 项目创建和凭证管理，Agent-Dev 负责展示最小人工步骤和凭证注入，RealProviderRegistry 已实现自动降级为 ManualProviderAdapter。详见 [Supabase Auth Spike](docs/spikes/supabase-auth.md)。
- 真实 Provider Adapter 端到端验证通过：GitHub 仓库创建、Vercel 部署、Cloudflare Pages 部署、Supabase 自动降级。验证项目 `e2e-test-real`，GitHub 仓库 `bayernjf/e2e-test-real`，Vercel URL `e2e-test-real-bayernjfs-projects.vercel.app`。
- `fix: resolve Vercel CLI non-TTY hanging and stderr output in adapter`：修复 Vercel CLI 在非交互环境挂起（添加 `--no-wait` + `CI=true`）和 stdout 为空（discover 改为 `stdout || stderr`）的问题。
- `feat: add real CLI-based Provider Adapters with auto-degradation`：新增基于 CLI 的 GitHub/Vercel/Cloudflare Provider Adapter，通过 RealProviderRegistry 统一编排，支持 CLI 可用性自动检测和 Manual 降级。
- 凭证与环境变量管理方案设计完成，详见 [凭证管理方案](docs/credential-management.md)。
- `823affa feat: add runtime retry history`：Runtime 失败运行现在保留 attempt 历史，提供显式 Retry API/UI，报告不会覆盖之前的失败证据。
- `35f7eaf feat: add local agent runtime catalog`：Daemon 已能探测内置 Agent，并接受名称 + 启动命令的 custom Agent 配置。
- 当前 Agent Catalog 已迁移为 Key-Value 配置：内置目录为 `packages/agent-runtime/agents.builtin.conf`，Custom 配置为 `.agent-dev/agents.conf`；内置未安装项隐藏，Custom 未安装项置灰。
- Agent 检测采用打开 Studio 时一次检测 + 用户点击刷新按钮主动检测，不做实时监控、文件监听或后台轮询。
- 当前本机 CLI 状态：`gh`、`vercel`、`codex`、项目本地 `wrangler@4.120.0` 已安装；`supabase` 未安装。Wrangler OAuth 已授权。
- 2026-08-09 真实双 Preview 尝试：Cloudflare OAuth 已授权；Vercel 临时项目可创建且部署状态为 `READY`，项目级 `ssoProtection/passwordProtection` 均已置空，但 `*.vercel.app` 公网域名在当前网络连续返回超时/ECONNREFUSED；每次 Vercel 临时项目均已自动清理，Cloudflare 项目未创建。需要在可访问 Vercel Deployment Domain 的网络重新验证。
- 2026-08-11 真实 Composer 重跑：网络和 Vercel/Cloudflare CLI 认证均可用；修复后的新 workspace 已通过 `npm run quality`，Vercel API 项目成功创建并开始部署；Composer 随后因未配置 `VERCEL_TOKEN` 无法关闭 Deployment Protection，临时 Vercel 项目已删除，Cloudflare 项目未创建。该 token 依赖已于 2026-08-13 移除（改用 `vercel api` 复用 CLI 登录态），可直接重跑。
- 2026-08-11 真实 Feature Task 验证：在新的隔离 workspace 中执行了一个要求修改 `apps/web/src/main.tsx` 的小功能，Codex 退出码为 0，Runtime 状态为 `completed`，Git evidence 记录 `1 insertion, 1 deletion`，Quality Gate `npm run quality` 通过，交付状态停在 `VERIFYING`。未代替用户执行 Human Acceptance，也未产生任何远程 Provider 写入。
- 2026-08-10 Acceptance Gate 与 Delivery State 已对齐：本地人工验收批准会使状态机从 `IMPLEMENTING` 经 `VERIFYING` 进入 `LOCAL_ACCEPTED`。该状态明确不代表 PR、Preview 或生产发布；这些仍需 Provider Evidence 和独立人工批准。
- 2026-08-10 Agent Capability Probe 已明确 Adapter 状态：`verified`、`candidate`、`unsupported`。当前仅 Codex 为 `verified`；其他已发现 Agent 只能生成 dry-run，不能执行。
- 2026-08-10 已增加交付证据推进 API：`POST /api/projects/:projectId/delivery/pr-evidence` 将 `LOCAL_ACCEPTED` 推进到 `PR_OPEN`；`POST .../delivery/preview-evidence` 将 `PR_OPEN` 推进到 `PREVIEW_READY`。两者都会在隔离 workspace 写入 JSON/Markdown 证据并提交本地 Git，不能代表生产发布。
- Studio 已接入上述两个证据阶段：仅在对应状态显示表单，提交后自动刷新项目状态、证据包和 Final Delivery Report。
- Studio 重新打开项目时会通过 `GET .../delivery/pr-evidence` 与 `GET .../delivery/preview-evidence` 恢复已记录证据，避免状态与展示脱节。
- 最近验证：`npm test`、`npm run typecheck`、`npm run build` 均已通过；`npm test` 最近一次为 13 个测试文件、61 个用例全通过。Vitest 文件级测试已串行执行，因为 Agent Catalog 会探测本机 CLI，并发探测会造成同步子进程超时假失败。本轮还覆盖 GitHub token 注入、Provider cache invalidation、Cloudflare CLI URL evidence、未验证 Agent 执行阻断和 Adapter 状态展示；真实云端尝试的完整边界见上一条。
- 当前工作分支：`feature/20260802`。2026-08-23 记录：本地 HEAD 为 `96fd261`，`origin/feature/20260802` 为 `c097d89`（本地领先 4 个提交，未推送），`origin/dev` 为 `c109792`，`origin/main` 为 `c696b74`。分支状态随时会变，提交前应重新 `git fetch` 确认，不要沿用本行记录。

## 1. 项目摘要

Agent-Dev 是面向 AI 产品创作者的 Agentic Product Delivery Platform。它位于 Codex、Claude Code 等 coding agent 上层，负责 Product Blueprint、Policy、平台连接、交付状态机、人工 Gate 和真实验收证据。

核心理念：

> 让人专注于产品为何存在，让 Agent 负责产品如何可靠地存在。

首版完成结果不是生成代码，而是交付一个归用户所有、可以访问、可以继续开发和维护的 Web 产品基线，并通过相同流程交付至少一个真实功能。Web SaaS 是当前验证类型；落地页、浏览器插件、桌面端和移动端属于后续独立 Product Type，不应被当前固定模板误认为已实现。详见 [多产品类型交付方案](docs/multi-product-delivery-plan.md)。

## 2. 当前真实状态

| 项目 | 状态 |
| --- | --- |
| 产品愿景和宪法 | 已完成 |
| 市场与竞争分析 | 已完成 |
| v0.1 PRD | 已完成 |
| 技术架构 | 已完成 |
| Blueprint 规范 | 已完成 |
| 环境变量与平台连接方案 | 已完成 |
| 实施计划和路线图 | 已完成 |
| 现有项目流程复盘/SOP | 已完成 |
| 六项目能力矩阵 | 已完成 |
| 技术 Spike | Workflow Resume、macOS Secret Boundary、Dual Preview 已通过；Codex 部分通过；Supabase Auth 已确认 Manual 降级路径 |
| Git 仓库 | 已初始化；Phase 0 提交已完成 |
| package.json / 代码骨架 | npm workspaces、Studio、Daemon、Blueprint、Policy、Provider Core、Provider CLI、Storage、Workflow 已实现 |
| 真实 Provider Adapter | GitHub/Vercel/Cloudflare 真实 CLI 接入已验证；Supabase Manual 降级已验证；RealProviderRegistry 统一编排，支持 CLI 可用性自动检测和 Manual 降级；Promise.allSettled 部分失败处理 |
| 凭证管理方案 | Phase 1 + Phase 2 已实现（详见 [凭证管理方案](docs/credential-management.md)）。凭证/元数据写入 Agent-Dev `.agent-dev` 目录，项目资源清单写入 workspace `.agent-dev`，自动生成 `.env`；Studio 凭证面板（引导模式 + 验证 + Supabase 手动配置 + 自定义 Key）已完成 |
| Dual Preview 部署编排 | `packages/deployment-composer` 已实现：7 步幂等编排（含 Vercel SSO Protection 关闭）、精确 CORS origin、临时项目清理、Daemon Preview API 和 Studio 部署区块；证据会区分 Wrangler 实测 URL 与推导兜底 URL；真实云端 7/7 步已于 2026-08-14 跑通并独立复验，剩余未验证项是 PR 关闭后的清理链路 |
| 当前本地能力 | Blueprint Revision、Dry Run、Connector Preflight/Discovery、资源归属计划、本地审批、固定 Web SaaS 模板、隔离工作区 Git baseline、Feature Task 与人工 Approval、Codex Runtime dry-run/Execute/Retry、运行结果和 Git evidence、Acceptance Gate、Final Delivery Report、Local Quality Gate、Local Apply Simulator、XState 状态推进（含 `LOCAL_ACCEPTED`）、PR/Preview 证据推进 API、Fake Provider Adapter、真实 Provider Adapter（GitHub/Vercel/Cloudflare）及 Studio 展示、凭证管理 UI（含验证和引导）、Dual Preview 部署编排；Agent Catalog 已支持 Key-Value 内置目录、Studio 选择、Custom Agent 弹窗和 `.agent-dev/agents.conf` 持久化、刷新检测和只读 Capability Probe 展示；内置未安装项隐藏、custom 未安装项置灰；多 Agent 真实执行 Adapter、Supabase 真实自动接入尚未实现 |
| 生产交付路径 | 已实现并**已在真实云端跑通一次**（2026-08-23，`Receipt Test` → `DELIVERED`，API `https://receipt-test-api.vercel.app`、页面 `https://receipt-test-web.pages.dev`，批准人 `feng`）：`ReleaseComposer` 9 步编排 + `release_runs` 日志 + Daemon `release/plan\|request\|approve\|retry` + Studio 发布区块。两道人工闸门（请求、具名批准）由状态机与 Schema 强制，Evidence 记录观测值而非判定常量，生产批准始终由用户本人给出。2026-08-23 起从记录仓库的生产分支 checkout 后发布，并要求该分支已带上被验收的提交（`962932a`），此前的"从本地 workspace 发布"缺口已修，但修复本身尚未在真实云端跑过 |
| 失败 workspace 恢复 | 已实现：`POST .../apply/recover` 新建干净 workspace、保留旧的并报告其 Git 状态；`apply_runs.recovery_index` 保证顺序确定。已在真实被 Codex 破坏的 workspace 上用过——`Receipt Test` 的交付就跑在 `revision-5-recovery-1` 这个恢复出来的 workspace 上 |
| 完整周期真实验证 | 1/3。`Receipt Test` 已完成 Blueprint → PR → Preview → Production 全周期；项目 2 计划用 `Workspace Verify Fresh`（其 Blueprint 里是 `test` 占位账号，需新 revision 换成真实归属）；项目 3 尚未创建 |
| 测试、构建和部署 | 本地单元测试与 Studio build 已通过；真实云端部署已通过 GitHub 仓库创建 + Vercel 部署 + Cloudflare Pages 部署验证 |

不要把文档中的设计描述为已实现能力。

## 3. 首版硬约束

### 目标用户

- 已经使用 GitHub 和 Codex 的独立开发者或一人产品团队；
- v0.1 不承担完全小白的零安装体验；
- 新手托管模式属于后续规划。

### 固定 Golden Path

```text
React/Vite + TypeScript -> Cloudflare Pages
Hono API                -> Vercel Functions
Supabase                -> Database/Auth
GitHub                  -> Repository/PR/Actions/Environments
Local Codex             -> Feature implementation
```

Cloudflare 和 Vercel 必须同时存在，分别承担页面与 API 托管，不得改回二选一。

### 自动化边界

- production 始终人工批准；
- 自动修复最多两次；
- 外部写操作先 Dry Run；
- Agent 不能访问生产 Secret；
- Agent 不能绕过 GitHub Rulesets 和 Environment Approval；
- 未取得真实 Evidence 的步骤不能标记完成。

### 文件边界

所有 Agent-Dev 产物只写入当前 `agent-dev`。同级的 `bayjf`、`word-picker`、`word-base`、`soft-desk`、`pr-helper`、`tab-manager`、`agent-dev-landing` 仅可只读参考，除非用户明确授权具体修改。

## 4. 关键架构决定

- v0.1 是 Local-first Web App，而非托管 SaaS；
- Studio 使用 React/Vite，本地服务使用 Node/Hono；
- SQLite/Drizzle 保存事实，XState 表达可恢复工作流；
- JSON Schema/RJSF 生成模块化问卷，Zod 校验运行数据；
- SSE 将执行状态推送到 UI；
- 系统 Git worktree 隔离 Agent 修改；
- Provider 统一实现 `discover/plan/apply/verify/detectDrift`；
- 环境变量统一管理契约和同步，生产 Secret 默认留在目标平台或系统 Keychain；
- Markdown 是 Blueprint 生成物，不是唯一事实源。

## 5. 联合 Preview 顺序

```text
quality
-> deploy Vercel API Preview
-> verify API
-> derive VITE_API_BASE_URL
-> build React/Vite
-> deploy Cloudflare Pages Preview
-> update exact CORS origin
-> update Supabase Auth Redirect URL
-> browser/API smoke test
-> write Evidence to PR
```

API 与页面不能无约束并发部署。两个部署和联合验证都成功后，才进入人工 Preview 验收。

## 6. 接手前必读

1. [README](README.md)
2. [产品愿景与宪法](docs/product-vision.md)
3. [v0.1 PRD](docs/prd-v0.1.md)
4. [技术架构](docs/technical-architecture-v0.1.md)
5. [v0.1 实施计划](docs/implementation-plan-v0.1.md)
6. [Blueprint 规范](docs/blueprint-spec.md)
7. [环境与连接方案](docs/environment-and-connectors.md)
8. [凭证与环境变量管理方案](docs/credential-management.md)
9. [对话决策记录](docs/decision-log.md)
10. [参考项目能力矩阵](docs/reference-project-blueprint-matrix.md)
11. [通用开发 SOP](ai-agent-development-sop.md)
12. [Agent Runtime Catalog](docs/agent-runtime-catalog.md)

市场判断和长期范围见 [市场分析](docs/market-analysis.md) 与 [路线图](docs/roadmap.md)。现有项目事实依据见 [项目组合复盘](portfolio-development-review.md)。

## 7. 阻塞性技术 Spike

五个阻塞性 Spike 已全部通过或明确降级（详见 [Phase 0 技术 Spike](docs/spikes/README.md)）：

1. **Codex Runtime**：✅ 已通过（非交互入口、结构化输出、真实功能任务写入）；
2. **Dual Preview**：✅ 已通过（Vercel API Preview URL 注入 Cloudflare Pages Build）；
3. **Supabase Auth**：✅ 已明确降级为 Manual 路径 C（动态 CORS、Redirect URL 与 PR 关闭清理）；
4. **Secret Boundary**：✅ 已通过（Provider CLI/OAuth、系统 Keychain、GitHub Secrets 最小复制路径，macOS）；
5. **Workflow Resume**：✅ 已通过（SQLite 持久化后从暂停 Gate 或失败 Step 恢复）。

Codex Runtime 已确认本机 `codex-cli 0.142.3` 提供非交互执行、JSONL 事件、最终输出 Schema、sandbox、超时终止和 resume 命令入口。2026-08-07 的只读探测已通过（exit 0，完整 `thread.started` → `turn.completed` 事件链），2026-08-11 已用一次真实功能任务验证写入与 Quality Gate。注意：早期 2026-08-06 的尝试曾因受限环境禁止 Codex 写入 `~/.codex/state_5.sqlite` 而在模型调用前停止，该记录已被后续验证取代；仍不要通过 Agent-Dev 绕过该状态目录边界。失败 workspace 恢复已实现为 `POST .../apply/recover`（新建干净 workspace，旧的保留待查），并已在一个真实被 Codex 破坏的 workspace 上跑过——`Receipt Test` 的完整交付就跑在恢复出来的 `revision-5-recovery-1` 上。剩余未验证项为真实 Codex 会话 resume 和可控取消。详见 [Codex Runtime Spike](docs/spikes/codex-runtime.md)。

Workflow Resume 与 macOS Secret Boundary 已通过真实本地 Probe。Dual Preview 已通过真实云端验证：Vercel API 部署、Cloudflare Pages 部署、跨域通信和 API URL 注入均取得真实 Evidence。Supabase Auth 已确认采用 Manual 降级路径（路径 C），由用户手动完成项目创建和凭证管理，RealProviderRegistry 已实现自动降级为 ManualProviderAdapter。完整状态见 [Phase 0 技术 Spike](docs/spikes/README.md)。

Dual Preview 的部署编排已实现为 `packages/deployment-composer`（精确 CORS origin、临时项目清理、Vercel SSO Protection 关闭和签名验证的 PR 关闭清理已包含）。下一动作是真实验证 PR 关闭后的清理链路（Composer 主链路已于 2026-08-14 在真实云端 7/7 通过，清理仍只有本地签名与事件测试覆盖）。Supabase 遵循用户决策保持 Manual 降级（不做自动化，仅引导用户手动操作）；Supabase Auth Redirect URL 更新仍为手动步骤。

OpenAI 官方 Codex 手册和页面在 2026-08-02 的核对请求中返回 `403`，此后仍未能访问。当前使用的 CLI 参数集来自本机 `codex-cli 0.142.3` 的实测（见 Codex Runtime Spike），不得基于未核实记忆扩展或修改；升级 CLI 版本后需重新实测。

## 8. 下一步执行顺序

1. ✅ ~~实现凭证管理 Phase 2~~：已于 2026-08-08 完成（Studio 凭证面板 + 引导模式 + 凭证验证 + Supabase 手动配置）；
2. ✅ ~~将 Dual Preview 部署编排实现为幂等 Step~~：已于 2026-08-09 完成（`packages/deployment-composer`，精确 CORS + 临时项目清理）；
3. ✅ ~~重跑 Deployment Composer 端到端~~：已于 2026-08-14 完成，真实云端 7/7 步通过并独立复验（Evidence 见 [Dual Preview](docs/spikes/dual-preview.md)）；**Studio 部署区块 → Daemon 这一段仍未走过界面**，本轮是直接调 Daemon API 触发的，资源清单外部 ID/URL 与 Provider 控制台的一致性也尚未逐项核对；
4. ✅ ~~为 Catalog 增加只读 Capability Probe~~：Daemon API 已提供探测结果，Studio 选择 Agent 后显示非交互、workspace-write 和 Adapter 状态；仍需在各 Agent 实际安装环境逐个验证 Adapter；
5. ✅ ~~用一次必然产生 Git diff 的真实功能任务验证 Runtime 写入和 Quality Gate~~：已于 2026-08-11 完成；Human Acceptance 仍需由用户明确确认；
6. ✅ ~~将 Acceptance Gate 与正式 Delivery State 的实现/验证阶段关联~~：已于 2026-08-10 完成；本地批准进入 `LOCAL_ACCEPTED`，不代表生产交付；
7. 使用三个真实项目连续验证从 Blueprint 到 Preview/Production 的完整周期。**进度 1/3**：`Receipt Test` 已于 2026-08-23 走完全周期并交付上线（`DELIVERED`，证据与本轮修掉的 6 个缺陷见「最近进度」首条）。剩余动作：
   - **项目 2**：`Workspace Verify Fresh` 已推进到 PR + Preview（详见「最近进度」项目 2 条目）。归属已换真实值（revision 3），仓库 `bayernjf/workspace-verify-fresh` 已建，PR #1 已开，功能（`/api/version`）已实现并通过本地 Quality Gate 与人工验收。剩余：等 Cloudflare 三层证书恢复后补跑 Preview 联合 Smoke；生产发布（`release/request` 后由用户本人批准）——这是「从生产分支发布 + 要求被验收提交是该分支祖先」路径的第一次真实云端验证。它的 Preview 资源按用户要求保留，不要清理。
   - **项目 3**：尚未创建，需要新建一个 Blueprint。
   - 每个旧项目开始前仍要先走一次 workspace 恢复（CI actions 版本升级让所有既存 workspace 变成 `staleConfig`）；项目 2 是全新 revision 3，直接 Apply 即得干净 workspace，未走 recover。
   - 生产发布必须由用户本人批准，不能由 Agent 代按；Daemon 必须带代理变量与 `NODE_USE_ENV_PROXY=1` 启动，否则云端验证会假失败。
   - 项目 1 暴露的两处缺口已在项目 2 之前修完（生产改为从生产分支发布；每个闸门都要求具名）。项目 2 已通过 API 验证「每个闸门都要求具名」（基线/Feature Task/交付验收三处 `feng` 通过）；「从生产分支发布」的生产阶段验证仍在待办（见上）。
   - **新增环境注意**：Daemon 的 PATH 需同时含 node22 运行时、homebrew（codex 0.142.3，避免解析到有兼容 bug 的 0.147.0）和 fnm node20 全局 bin（`vercel`/`wrangler`），否则会出现 codex 超时或 Vercel 未认证。

## 9. 用户决策

| 决策 | 状态 | 值 |
| --- | --- | --- |
| 生产页面域名 | 已确认 | `app.example.com`，允许项目改为 apex |
| Supabase 环境 | 已确认 | dev 与 production 使用独立项目 |
| 模板最小业务能力 | 已确认 | 登录、基础用户资料、API health、示例受保护页面 |
| Analytics 默认 | 待确认 | 默认关闭，隐私确认后再接入 |
| GitHub Ruleset | 待确认 | 支持则自动计划；权限/套餐不足时生成 Manual Action |
| Blueprint 开源 | 待确认 | v0.1 稳定后再发布 v1alpha1 |

## 10. 交接完成定义

接手者在开始编码前应能明确回答：

- Agent-Dev 与 Codex 的责任边界是什么；
- 为什么首版采用 Local-first；
- 为什么 Cloudflare 和 Vercel 都是必选；
- 哪些操作必须人工批准；
- Blueprint、Markdown、Env Contract 和 Evidence 的关系；
- 哪五个 Spike 会影响架构；
- v0.1 需要用什么真实证据证明完成。
