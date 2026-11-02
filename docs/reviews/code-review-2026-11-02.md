# 代码深度审查报告 — 2026-11-02

> 审查范围：`/Users/jiangfeng/000mycodes/agent-dev` 全仓（apps/、packages/、tools/、spikes/），只读审查，未改动任何源码。
> 基线：HEAD `10ae9f9 fix(studio): darken text on accent buttons for AA`（工作区干净）。
> 方法：逐文件精读 daemon / storage / agent-runtime / provider-cli / deployment-composer / cli 全部服务端源码（约 9.3k 行），实跑 lint / typecheck / test / build / npm audit / tools/check-migrations.sh，并与 `docs/audit-2026-08-31.md`、`handoff.md`、README、AGENTS.md 交叉核对。

## 一、仓库定位与规模概览

Agent-Dev 是面向 AI 产品创作者的自主产品交付平台（Agentic Product Delivery Framework）：在 Codex / Claude Code 等 coding agent 之上管理 Product Blueprint、策略门、云厂商连接、交付状态机与人工审批。npm workspaces 单体仓库，本地优先架构：

- `apps/daemon`：Hono API，绑定 127.0.0.1:3737，bearer token 鉴权（`apps/daemon/src/app.ts` 1502 行）
- `apps/studio`：React 19 + Vite 7 控制台（`App.tsx` 2315 行单文件）
- `apps/cli`：`agent-dev <doctor|start|mcp>`，含 MCP stdio 桥（20+ 工具）
- `packages/`：agent-runtime、blueprint、storage（sql.js + drizzle-orm）、provider-cli、deployment-composer、policy、workflow 等 9 个包
- 数据存储：sql.js 内存库 + 整库导出持久化到 `~/.agent-dev/agent-dev.sqlite`，迁移内联在 `packages/storage/src/migrations.ts`（0001–0006）

规模（`find` 实测，排除 node_modules/.git/dist）：734 个文件，其中 TypeScript 165 个 `.ts` + 20 个 `.tsx`（apps+packages 生产代码约 14,017 行），Markdown 198 个，测试文件 47 个。spikes/ 6 个探针目录，tools/ 仅 `check-migrations.sh`。

## 二、结论摘要

- **P0：0 条**（2026-08-31 审计的 P0 网络边界问题已整改到位：loopback 绑定 + 每用户 bearer token + webhook HMAC + 密钥明文路由移除，均已核实代码）。
- **P1：2 条**（凭证写入 Agent 工作区的边界遗留；凭证文件损坏→静默清空）。
- **P2：4 条**（整库非原子持久化；10 个依赖漏洞含 1 critical；Windows 下自定义 Agent launchCommand 经 shell 执行；同步 spawnSync 探测阻塞事件循环）。
- **P3：8 条**（SSE 元数据暴露、Studio 无 fetch 超时、单页巨石组件与单 chunk、空 workspace、迁移约定文档与实现不符、README 产品类型名称漂移、fetchWithRetry 重试策略、Profile 存储损坏即 500）。

**最关键三条**：

1. `packages/provider-cli/src/env-generator.ts:12` 用 4 键黑名单过滤，用户存入的任意其他凭证（含 `GITHUB_WEBHOOK_SECRET`、`SUPABASE_SERVICE_ROLE_KEY`）都会被写进 Agent 工作区 `.env`，而 Agent 以 `--dangerously-skip-permissions` / `--yolo` 运行，防线只剩提示词一句话（审计 S11 遗留，风险评级被低估）。
2. `packages/provider-cli/src/secret-backend/local-file.ts:178-180` 凭证文件 JSON 损坏时被静默读成空库，下一次 `set()` 直接覆盖原文件——全部已存凭证静默丢失且无可恢复副本。
3. `npm audit --omit=dev` 实测 10 个漏洞（1 critical：proxy-addr IPv4-mapped IPv6 信任子网欺骗；5 high：drizzle-orm 标识符注入、zod 内存耗尽、@modelcontextprotocol/sdk 六项、body-parser、fast-uri），全部有修复版本但未跟进。

## 三、逐条发现

### P0（可利用的安全/数据丢失/停服）

无。已核实的关键防线：

- daemon 仅绑 `127.0.0.1`（`apps/daemon/src/index.ts:53`），`/api/*` 全部要求 `Authorization: Bearer`（`auth.ts:42-50`，token 0600 存于 `~/.agent-dev/daemon-token`，timingSafeEqual 比较）。
- GitHub webhook 走独立 HMAC-SHA256 校验（`app.ts:213-219, 293-298`），豁免路径仅 `/api/health` 与 `/api/github/webhooks`（`auth.ts:40`）。
- 所有子进程调用均为参数数组形式，无 shell 字符串拼接（POSIX 下）；URL 输入统一经 `httpUrlSchema` 限制 http(s)（`app.ts:60-72`）。
- 凭证明文路由（GET /:key）已按审计 S4 移除，现存 `/api/credentials/backend` 只返回后端类型与可用性（`app.ts:463-468`）。

### P1（严重缺陷）

**P1-1 凭证黑名单过滤把任意已存密钥写进 Agent 工作区**
- 位置：`packages/provider-cli/src/env-generator.ts:12`；放大面：`packages/agent-runtime/src/index.ts:122,147,152`（claude-code `--dangerously-skip-permissions`、hermes `--yolo`、codebuddy `--permission-mode bypassPermissions`）。
- 证据：第 12 行仅排除 `GITHUB_TOKEN / VERCEL_TOKEN / CLOUDFLARE_API_TOKEN / SUPABASE_ACCESS_TOKEN` 四个键，其余键（如 `GITHUB_WEBHOOK_SECRET`、`SUPABASE_SERVICE_ROLE_KEY`、用户自加的任意 `^[A-Z][A-Z0-9_]*$` 凭证，`app.ts:177` 的 schema 允许）全部以明文写入工作区 `.env`。`generateEnvFile` 由 `POST /api/projects/:id/env/regenerate`（`app.ts:1132-1139`）触发。工作区 `.gitignore` 覆盖 `.env` 且 `commitAgentChanges` 会拒绝提交 `.env`（`storage/src/index.ts:1353-1357`），防住了"进 Git"，但防不住"被 Agent 读取/外发"——Agent 的 forbiddenPaths 只是 plan 里的说明文字（`agent-runtime/src/index.ts:178`）。`docs/audit-2026-08-31.md` S11 已记录此项并评"风险有限"，但 S11 只点名 webhook secret，未覆盖用户自定义凭证与 service-role key 这一更大面。
- 影响：本机凭证经 Agent 进程外泄（模型上下文、日志、或被写入产物）。
- 修复建议：第 12 行改为白名单（仅写入 Env Contract 中 classification≠secret 的键），或默认排除全部、按 Blueprint 变量契约逐个放行；在 `docs/credential-management.md` 同步口径。

**P1-2 凭证文件损坏被静默读空，下一次写操作永久清空全部凭证**
- 位置：`packages/provider-cli/src/secret-backend/local-file.ts:178-180`。
- 证据：`readStore()` 的 `catch` 对任何 JSON 解析失败都返回 `{ version: 1, secrets: {} }`；`set()`（43-74 行）随后 `writeStore()` 覆盖 `credentials.json`。一次磁盘损坏/截断写 → 下次保存任意一个键 → 其余凭证全部丢失，且旧文件无备份（legacy 迁移有 `.bak`，正常路径没有）。
- 影响：本地全部平台凭证静默丢失；对 Pilot 用户是交付中断级事故。
- 修复建议：解析失败时抛错并拒绝写；写前做 `credentials.json.bak` 滚动备份；写入走临时文件 + rename 原子替换（与 P2-1 同一修法）。

### P2（质量/可维护性/性能）

**P2-1 SQLite 整库导出持久化非原子，崩溃即损坏主库**
- 位置：`packages/storage/src/index.ts:1856-1859`（`persist()` 直接 `writeFile(this.databasePath, this.sqlite.export())`）。
- 影响：daemon 常驻且单次 Agent 运行最长 15 分钟（`agent-runtime/src/index.ts:336`），期间被 kill/断电时写文件截断 → `agent-dev.sqlite` 损坏 → `AgentDevStore.open()` 在 `new SQL.Database(data)` 处抛错，daemon 无法启动，交付状态全丢。另外每次变更整库重写，库增大后每次写都是 O(全库)。
- 修复建议：写 `*.tmp` 后 `rename()` 原子替换；保留一份上次已知良好副本；中长期考虑 WAL 的真实 SQLite 绑定替换 sql.js。

**P2-2 生产依赖 10 个已知漏洞（实测 `npm audit --omit=dev`）**
- 证据（2026-11-02 实跑）：critical 1 — `proxy-addr` GHSA-jqcg-44mw-7w3h（IPv4-mapped IPv6 信任子网 IP 欺骗）；high 5 — `drizzle-orm <0.45.2` GHSA-gpj5-g38j-94v9（SQL 标识符注入）、`zod <4.6.6` GHSA-mrhx-c7xc-m3w5（受限集合内存耗尽）、`@modelcontextprotocol/sdk <=1.31.0` 六项（含跨会话任务、重定向重发凭据）、`body-parser` DoS、`fast-uri` 七项；moderate 4 — hono、`@hono/node-server`、qs、ip-address。
- 影响评估：daemon 是 loopback + token，drizzle 只用固定标识符建表/查询，直接可利用性低；但 zod 内存耗尽在 HTTP 边界（token 持有者可触发），MCP SDK 洞在 `apps/cli` stdio 桥上，均值得跟进。`npm audit fix` 可修大部分；drizzle/zod 修复是 breaking，需要回归。
- 修复建议：先跑 `npm audit fix`，再单独评估 drizzle-orm 0.45 与 zod 4 的升级；把 `npm audit --omit=dev` 加进 CI quality 门禁（当前 `.github/workflows/quality.yml` 只有 lint/typecheck/test/build）。

**P2-3 Windows 下自定义 Agent 的 launchCommand 经 cmd.exe 解释**
- 位置：`packages/agent-runtime/src/catalog.ts:89,104,146`。
- 证据：`probeSpawnOptions` 在 win32 为 `{ shell: true }`，`detect(command)` / `probeHelp(command)` 把完整 `launchCommand` 字符串作为 command 传给 `spawnSync`。`launchCommand` 来自 `POST /api/runtime/catalog`（`app.ts:705-713`，schema 只限制长度 1-200），注释声称"the shell carries no user input"——这只对参数成立，command 字符串本身是用户输入，cmd.exe 会解释 `&` `|` `%VAR%` 等元字符。POSIX 下无 shell，同样输入只会 ENOENT。
- 影响：Windows 上持 token 的调用方可在 discovery/probe 路径执行任意命令。token 门内、仅 Windows，故定 P2 而非 P1。
- 修复建议：spawn 前把 launchCommand 拆成 executable + 固定参数（`resolveExecutablePath` 已按首词解析，直接 spawn 解析后的可执行路径）；或在 win32 分支对 launchCommand 拒绝 shell 元字符。

**P2-4 Agent 探测用同步 spawnSync，首次发现可阻塞 daemon 事件循环数十秒**
- 位置：`packages/agent-runtime/src/catalog.ts:104,146`（spawnSync，单命令 5s 超时）；触发点：`GET /api/runtime/catalog` 等路由（`app.ts:701`）。
- 影响：8 个内置 Agent 顺序探测，每个最坏 5s，全部同步阻塞 Node 事件循环——首次调用期间 daemon 对所有其他请求（含 webhook）无响应。注释（`app.ts:194-196`）自述"discovery walks all eight built-in commands in sequence"。有 detect 缓存，属冷启动一次性，但 webhook 签名窗口可能被拖过。
- 修复建议：启动时预热一次并缓存；或改异步 `spawn` + 并发探测。

### P3（体验/约定）

1. **SSE `/events` 无鉴权属既定设计但暴露面应复核**（`app.ts:1491-1499`、`auth.ts:38-39`）：任意本地进程或浏览器网页可连 `http://127.0.0.1:3737/events` 读取项目名/交付事件元数据。注释声明"never credentials"，但事件含 projectName，建议至少在文档（SECURITY.md）显式记录该威胁模型。
2. **Studio 所有 fetch 无超时/中止**（`apps/studio/src/App.tsx:173,187,215,227,241` 等；全文件 `AbortController` 命中 0 次）：daemon 挂起时 UI 请求永久悬挂。建议封装带 `AbortSignal.timeout` 的 api client。
3. **Studio 单文件巨石与单 chunk**：`App.tsx` 2315 行，vite 产物单 JS `461.93 kB`（gzip 133 kB，实测 build 输出），无 lazy/manualChunks。影响可维护性与首屏。建议按视图拆分 + `React.lazy`。
4. **空 workspace `packages/connectors`**：目录存在（空 src/、空 test/、无 package.json），`workspaces` glob 会扫到它。建议删除或移入 spikes/。
5. **迁移约定文档与实现不符**：`MIGRATION_CONVENTION.md` 规定 `supabase/migrations/` 或 `db/migrations/` 文件式迁移，本仓实际为 `packages/storage/src/migrations.ts` 内联迁移（0001–0006，编号连续无缺）；`tools/check-migrations.sh` 在本仓实测退出 1（"No migration directory found"）。要么约定文件注明本仓例外，要么脚本识别内联迁移。
6. **README/AGENTS.md 产品类型名称漂移**：README「第一版定位」与 AGENTS.md 仍写 "Web SaaS Golden Path"，代码与迁移 0006 已把 `web-saas` 改名为 `web-app`（`migrations.ts:93-105`），handoff 亦记录改名。建议同步文档措辞。
7. **`fetchWithRetry` 对 4xx 也重试且最后一次仍 sleep**（`packages/deployment-composer/src/http.ts:1-17`）：12 次 ×（15s 超时 + 10s 等待），永久性错误（401/404）最坏拖 ~5 分钟，且第 12 次失败后仍白等 10s。建议对 4xx 快速失败、末次不 sleep。
8. **Profile 存储损坏即全路由 500**：`packages/storage/src/profiles-store.ts:187-190` 只豁免 ENOENT，`agent-profiles.json` JSON 损坏时 `loadFromDisk` 抛错，`/api/runtime/profiles*` 全部 500。建议与 P1-2 同策略：损坏时拒绝写但读降级为空 + 告警。

### 正面确认（抽样）

- 状态机修订约束严格：`reviseProjectBlueprint` 强制 revision 连续 +1（`storage/src/index.ts:425-427`）；重试上限 3 次（`app.ts:605, 1441`）。
- `commitAgentChanges` 提交前扫描 `.env` 与逃逸符号链接并拒绝提交（`storage/src/index.ts:1353-1374`），防线真实存在。
- MCP 桥把确认字面量固定在桥内、审批类操作不暴露给 MCP（`apps/cli/src/mcp.ts:31-34, 325-330`），提示注入无法伪造人工门。
- 生产发布必须先过 preview 门（`app.ts:1344-1348`），release 从生产分支 checkout 而非本地工作区（`release.ts:56-65`）。
- 迁移编号 0001–0006 连续，`schema.ts` 与迁移产物（attempts、recovery_index、release_runs）一致，无漂移。
- handoff.md 声称的"36 files / 535 例全绿"与本次实测 36 files / 548 例全绿一致（数量随迭代增长，无夸大）。

## 四、验证门实际执行结果（2026-11-02 本机实测）

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npx eslint .`（`ESLINT_CACHE_LOCATION=/tmp/...`） | ✅ 退出 0 | 无任何告警/错误输出 |
| `npm run typecheck` | ✅ 退出 0 | 10 个 workspace 全部 `tsc -p` 通过 |
| `npm test`（vitest run） | ✅ 退出 0 | **Test Files 36 passed (36)，Tests 548 passed (548)**，Duration 181.79s |
| `npm run build` | ✅ 退出 0 | typecheck 全过后 studio `vite build` 成功：index.html 1.14 kB、CSS 42.88 kB、JS 461.93 kB（gzip 133.13 kB），12.30s |
| `npm audit --omit=dev` | ⚠️ 10 漏洞 | 1 critical（proxy-addr）、5 high（drizzle-orm、zod、@modelcontextprotocol/sdk、body-parser、fast-uri）、4 moderate |
| `bash tools/check-migrations.sh` | ❌ 退出 1 | "No migration directory found (supabase/migrations or db/migrations)."（本仓迁移为内联 TS，见 P3-5） |
| Node 版本核对 | ⚠️ 环境 | 仓库要求 `engines: node>=22` 且 `.node-version=22`；本机实测 `v20.20.2`。上述门禁在 Node 20 下仍全部通过，CI 使用 22，但本地与声明不一致，建议按 `.node-version` 切换 |

说明：沙箱内 `npm` 命令产生的 `~/.npm/_logs` 与 `_cacache` 临时文件被系统移入回收站（可再生的 npm 缓存/日志，非仓库文件），未影响仓库与测试结果。

## 五、修复优先级建议

1. **本周内**：P1-2（凭证损坏静默清空，改原子写 + 损坏即报错，改动 <30 行）；P2-2 中 `npm audit fix` 可覆盖的部分（proxy-addr、hono、fast-uri、qs、ip-address、MCP SDK）。
2. **下个迭代**：P1-1（env-generator 改白名单，与 Env Contract 对齐）；P2-1（persist 原子化）；zod 4 / drizzle-orm 0.45 升级评估。
3. **择机**：P2-3（Windows launchCommand 拆分）、P2-4（异步探测预热）、P3-2/3/5/6（Studio fetch 封装与拆分、迁移约定对齐、README 改名同步）。
4. **流程**：把 `npm audit --omit=dev` 加入 `.github/workflows/quality.yml`，防止依赖漏洞再次堆积到两位数。
