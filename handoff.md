# Agent-Dev 项目交接

> 更新时间：2026-10-26（Preview 残留 dry-run 复验：Vercel/Cloudflare 两控制台均零符合删除条件；Vercel CLI 本机登录态失效；PR 关闭 webhook 真云端验证仍待下一个真实项目）
> 当前阶段：四个真实项目全部完整交付上线（`Receipt Test` 1/3、`Workspace Verify Fresh` 2/3、`Link Vault` 3/3、`MCP Word Tools` 4/4 首个非 web-saas 类型）——BluePrint → Preview → Production 全周期在真实云端跑通，4/4 验证目标达成；v0.2 P0-2/P0-3/P1-1/P1-3/P2-4 已完成（P2-4 无托管部署类型交付闭环于 2026-08-28 落地），P0-1（Claude Runtime 验证）已于 2026-08-29 由用户决策推迟（不阻塞 Pilot，恢复触发条件见 [v0.2 计划](docs/implementation-plan-v0.2.md) §3）；2026-08-28 新增 agent-dev MCP 桥、web-saas→web-app 类型重命名与 Studio 主题收尾，2026-08-29 MCP 桥完成化并扩至 21 工具（2026-08-31 随自更新端点移除减至 20），2026-08-31 完成全仓安全与质量审计（4 条高危，核心是 daemon 无鉴权监听所有网卡），审计整改 **P0 网络边界 §6.1 全部 4 项**、**P1 状态机 §6.2 全部 3 项**、**P2 §6.3 清理全部 6 项**与 **P3 §6.4 Windows 兼容全部 3 项**已于同日完成，**P4 §6.5 测试补齐全部 4 项已于同日完成**（storage pipeline resume/isStepApproved 4 例并修复 resume 未落盘缺陷、MCP 桥 20 工具全覆盖 +2 例、Studio 渲染冒烟 3 例 + vitest include/子路径 alias 收敛），**审计整改全部完成，当时全仓 220 例测试全绿**，方案与验收见 [审计文档](docs/audit-2026-08-31.md)；2026-09-01~02 的 Studio 界面走查与待办清理已连发 21 刀（第二轮 `e75a1ba`→`a072c55` 另清掉只读探测顺带改选择、能力探测语义与中英文标签大小写三项，`2e1440e` 再清掉 Runtime 路由的第二种拒绝与响应里那份 Codex 探测章，之后测试证据读取收敛为单一模块 `test/source-evidence.ts`），同日再关掉两项：`64c2a72` 把那条「未归因的间歇失败」归因为 **2 条**超时用例（根因是发现要顺序探测 8 个内置 Agent、每个版本探测预算 5 s，而 vitest 单用例默认预算也是 5 s），`ebe7ec4` 修掉「决策卡不看 productType」这条内容错误（两张卡与界面上那句基线注记改读 per-type 表），2026-10-07 复验全仓 530 例全绿
> 工作目录：仓库根目录

## 最近进度

- **Tier0 M2 · TF-06 模板清单登记（2026-10-28，feature/20260802）**：新增 `docs/storefront-template-checklist.md`，沿用 agent-world `template-checklist.md` 登记惯例。对账：已实现 storefront 站点模板 3 个（retail/cross-border/subscription），本表登记 3 条，一一对应；agent-world `tpl-*` 工作流模板 35 个属另一域，未改动。GATE-L1 真实部署状态如实标注于 TF-05。

- **Tier0 M2 · TF-05 GATE-L1 真实上线（2026-10-28，feature/20260802）——本地物化门通过，真实公网部署受阻**：
  - **已验证（本地，可复跑）**：用 `createBlueprint(storefront, profile=retail/cross-border/subscription)` 物化到 `/tmp/sf-*`，三套剖面均 `node scripts/build.mjs && node scripts/smoke.mjs` 全绿（23 产物/套）。物化还暴露并修掉生成门两个真实缺陷（`9788c27`：子页面目录未建、smoke 标记口径不一致）。
  - **真实公网部署未发生、不伪造**：缺 ① 本次会话无写生产云资源的授权（Vercel token 仍只读、CLI 登录态失效；Cloudflare token 未在本会话注入）；② storefront SSR 需实时 commerce-os storefront 后端（`COMMERCE_API_BASE_URL`）才能渲染目录，当前无运行中的线上后端；③ agent-dev v0.3 方向（产品族整合 D2）已拍板 B 降级 runbook（手动上线）；④ 生成骨架的 `build` 当前是装配门，真实 `astro build`+SSR 部署需先 `npm install` astro/react 再上线。
  - **所需输入（解封 GATE-L1）**：owner 明确授权用 Vercel/Cloudflare 生产资源开站 + 注入可用凭据；提供一个可访问的 commerce-os storefront API URL；v0.3 方向已拍板 B（降级 runbook）；由手动流程把物化站 `npm install && astro build` 部署并回取线上 URL 作为验收证据。

- **Tier0 M2 · TF-04 管道吃模板：模板→Blueprint 契约（2026-10-28，feature/20260802）**：storefront 模板接入为 Blueprint 级输入。
  - 新增 `storefrontConfigSchema`（themeColor / tagline / seedProducts，带 read-migration default），落到 `spec.storefrontConfig`；结构（productType=storefront + profile）+ 配置化商品/主题/文案一并作为管道输入。
  - `buildStorefront` 输出 `config/storefront.config.json`（profile/brand/tagline/theme/seedProducts），首页 hero 注入配置化 tagline。
  - 契约测试「Cafe Noir」：Blueprint 经 persisted schema 往返、生成站反映 themeColor/tagline/seedProducts、首页含配置文案、每个声明 quality 检查都有真实脚本。
  - 门数字：`tsc` 0 错；`vitest run packages/blueprint` 37 例全绿（新增契约断言 1 例）。未 push。

- **Tier0 M2 · TF-03 订阅周期订单模板（2026-10-28，feature/20260802）**：`storefrontProfile=subscription` 落地周期订单占位。
  - 首页注入订阅方案卡（月度/季度）+ 「周期订单占位」语义（结算标记 `recurring=true`，真实续费/退订/扣款待计费通道）。
  - `src/lib/api.ts` 追加 `SUBSCRIPTION_PLANS` / `isRecurringOrder` 占位；retail 与 cross-border 不携带订阅语义。
  - 门数字：`tsc` 0 错；`vitest run packages/blueprint` 36 例全绿（新增订阅占位断言 1 例）。未 push。

- **Tier0 M2 · TF-02 跨境多币种模板（2026-10-28，feature/20260802）**：`storefrontProfile=cross-border` 落地多币种展示。
  - 首页注入币种切换器 `<div class="currency-switcher" data-currencies="CNY,USD,EUR">` + 「价格货币化占位」显式说明（真实汇率换算与多币种收款待支付通道，当前只做展示层，不静默当真换算）。
  - `src/lib/api.ts` 按 profile 追加 `SUPPORTED_CURRENCIES` 与 `convertPrice()`（占位汇率表，仅展示）；retail 剖面不携带该机制。
  - 门数字：`tsc` 0 错；`vitest run packages/blueprint` 35 例全绿（新增跨境展示断言 1 例）。未 push。

- **Tier0 M2 · TF-01 品牌零售 storefront 模板骨架（2026-10-28，feature/20260802）**：`@agent-dev/blueprint` 新增第 7 种 product type `storefront`，把 commerce-os 的 storefront 前台（Astro SSR + React 岛）固化为模板骨架。
  - 结构：`productTypeSchema` 加 `storefront`；新增 `storefrontProfileSchema = retail|cross-border|subscription`（默认 `retail`，带 read-migration default，旧 blueprint 不 brick）；`spec.product.storefrontProfile` 落盘。
  - 生成器：`PRODUCT_TYPE_DESCRIPTORS['storefront']`（Astro SSR node standalone；后端=外部 commerce-os，不生成 Supabase；providers=`github+vercel`，SSR 站部署 Vercel Functions）；`QUALITY_CHECKS['storefront']=['build','smoke']`；新增 `buildStorefront()` 产出与 commerce-os `front/src` 同构的页面集（`index/catalog/catalog/[id]/orders/[cartId]` + `lib/api.ts` + `CartIsland/OrderIsland`）+ `config/storefront.profile.json` + `config/env.example`（`COMMERCE_API_BASE_URL` SSR-only）。
  - 行业剖面钩子：`storefrontProfileBits(profile)` 当前 retail 完整；cross-border/subscription 先落 HTML 占位注释（TF-02/03 填充）。
  - 门数字：`tsc -p packages/blueprint` 0 错；`vitest run packages/blueprint` 34 例全绿（新增 storefront 同构站 + quality-script 两例）。未 push、未建 PR。

- **废弃裸名项目删除（2026-10-26，owner 拍板「这个也搞」）**：两平台遗留的 4 个废弃裸名项目已全部删除，生产 `-web`/`-api` 未触碰，本条闭环并取代下方 2026-10-26 dry-run 记录中「裸名待 owner 拍板」的挂账状态。
  - **Cloudflare Pages（wrangler 4.120.0 OAuth）**：`wrangler pages project delete link-vault` / `receipt-test` 均返回 Successfully deleted；与三个交付项目相关的现存项目只剩 `link-vault-web`、`workspace-verify-fresh-web`、`receipt-test-web` 三个生产 `-web`。
  - **Vercel（team `bayernjfs-projects`，bayjf 仓 `.env.local` 的 `VERCEL_TOKEN`）**：删除前核实两个裸名仅绑定随机 `.vercel.app` 裸域（`link-vault`→`link-vault-two-zeta.vercel.app`、`receipt-test`→`receipt-test.vercel.app`），均无自定义业务域名；`DELETE /v9/projects/{name}` 返回 204。现存只剩 `link-vault-api`、`workspace-verify-fresh-api`、`receipt-test-api` 三个生产 `-api`。
  - 纯云端资源删除，无代码/测试/部署改动；`workspace-verify-fresh` 本就无裸名。

- **Preview 残留资源 dry-run 复验：两控制台均零符合删除条件（2026-10-26）**：按 §8-11.4 与 §8-7 遗留做只读 dry-run，不删除任何资源。
  - **Cloudflare Pages（wrangler 4.120.0 OAuth 仍有效，`pages (write)` scope）**：`wrangler pages project list` 全量 37 个项目中，与三个交付项目相关的只剩 `link-vault-web` / `workspace-verify-fresh-web` / `receipt-test-web`（生产 `-web` 对，按设计不动）和裸名 `link-vault` / `receipt-test`（废弃裸名，待 owner 拍板，不动）。**没有** `*-web-pr-1` 或 `workspace-verify-fresh-web-preview` 这类临时项目——2026-10-08 记录的 4 对 CF 临时项目已在控制台清零。
  - **Vercel（本机 CLI 56 无登录态：`vercel whoami` 报 `No existing credentials found`，`~/Library/Application Support/com.vercel.cli/auth.json` 不存在）**：改用 bayjf 仓 `.env.local` 中的 `VERCEL_TOKEN`（仅只读 `vercel project ls --token=…`，未输出密钥值）列出 `bayernjfs-projects` team 下 16 个项目。与三个交付项目相关的只剩 `link-vault-api` / `workspace-verify-fresh-api` / `receipt-test-api`（生产 `-api` 对）和裸名 `link-vault` / `receipt-test`（废弃裸名，待 owner 拍板）。**没有** `*-api-pr-1` 或 `workspace-verify-fresh-api-preview`——2026-10-08 记录的 4 对 Vercel 临时项目同样已清零。
  - **结论**：2026-10-08 的「8 个 Preview 遗留清理完成」记录与真实控制台一致；§8-7 与 §8-11.4 中「receipt-test-*-pr-1、workspace-verify-fresh-*、link-vault-*-pr-1 仍在账号里」是 2026-09-10 的旧文字，已被 10-08 清理事实超越，本次 dry-run 不再有可删对象，因此**未触发任何 `POST .../preview/cleanup`，未做任何写操作**。
  - **外部阻塞（仍挂账）**：① Vercel CLI 本机登录态已失效（token 仍能只读，但 owner 下次要跑真实部署/清理前应 `vercel login` 续上；或把 `VERCEL_TOKEN` 注入 daemon 环境）；② 4 个废弃裸名项目（Vercel `link-vault`、`receipt-test`；CF Pages `link-vault`、`receipt-test`）仍待 owner 拍板删除，本轮不擅动；③ PR 关闭 webhook 的真实云端端到端验证仍需一个真实 GitHub `pull_request.closed` 事件打过来——本地 HMAC/事件/payload 路由测试已覆盖（`apps/daemon/test/app.test.ts` 的「cleans a PR preview only after verifying a signed GitHub close event」等 3 例），但从未在真云端跑过一次；下一个真实项目交付时自然触发，本轮不伪造。
  - **门数字**：`npx vitest run` 36 files / 535 例全绿；`npm run typecheck` 0 错；`npm run build`（含 studio `vite build` 460.88 kB / gzip 132.77 kB）干净。本次仅改 handoff 文档，无代码/测试变更。

- **更早批次已归档**：2026-10-23 及更早的「最近进度」记录（自 2026-08-09 首次真实云端尝试起的全部历史批次）已原文移入 [handoff-archive.md](handoff-archive.md)（2026-10-31 归档，内容未改写）。

## 1. 项目摘要

Agent-Dev 是面向 AI 产品创作者的 Agentic Product Delivery Platform。它位于 Codex、Claude Code 等 coding agent 上层，负责 Product Blueprint、Policy、平台连接、交付状态机、人工 Gate 和真实验收证据。

核心理念：

> 让人专注于产品为何存在，让 Agent 负责产品如何可靠地存在。

首版完成结果不是生成代码，而是交付一个归用户所有、可以访问、可以继续开发和维护的 Web 产品基线，并通过相同流程交付至少一个真实功能。Web SaaS 是当前验证类型，落地页与浏览器插件已生成真实模板（MV3 脚手架），桌面端、移动端与 API 工具属于后续独立 Product Type（暂为引导式交接）。详见 [多产品类型交付方案](docs/multi-product-delivery-plan.md)。

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
| 凭证管理方案 | Phase 1 + Phase 2 已实现（详见 [凭证管理方案](docs/credential-management.md)）。凭证/元数据写入 Agent-Dev `.agent-dev` 目录，项目资源清单写入 workspace `.agent-dev`，自动生成 `.env`；Studio 凭证面板（引导模式 + 验证 + Supabase 手动配置 + 自定义 Key + Secret 后端状态展示）已完成；**Secret Backend 后端化已实现**（2026-09-01）：`AGENT_DEV_SECRET_BACKEND=infisical` 切换 Infisical 后端，默认 `local-file` 不变，真实 Infisical 云端验证待办 |
| Dual Preview 部署编排 | `packages/deployment-composer` 已实现：7 步幂等编排（含 Vercel SSO Protection 关闭）、精确 CORS origin、临时项目清理、Daemon Preview API 和 Studio 部署区块；证据会区分 Wrangler 实测 URL 与推导兜底 URL；真实云端 7/7 步已于 2026-08-14 跑通并独立复验，剩余未验证项是 PR 关闭后的清理链路 |
| 当前本地能力 | Blueprint Revision、Dry Run、Connector Preflight/Discovery、资源归属计划、本地审批、六类产品模板（Web SaaS / 落地页 / 浏览器插件 MV3 / 桌面端 Tauri v2 与 Electron / 移动端 Expo / API 工具）、隔离工作区 Git baseline、Feature Task 与人工 Approval、Codex Runtime dry-run/Execute/Retry、运行结果和 Git evidence、Acceptance Gate、Final Delivery Report、Local Quality Gate、Local Apply Simulator、XState 状态推进（含 `LOCAL_ACCEPTED`）、PR/Preview 证据推进 API、Fake Provider Adapter、真实 Provider Adapter（GitHub/Vercel/Cloudflare）及 Studio 展示、凭证管理 UI（含验证和引导）、Dual Preview 部署编排；Agent Catalog 已支持 Key-Value 内置目录、Studio 选择、Custom Agent 弹窗和 `.agent-dev/agents.conf` 持久化、刷新检测和只读 Capability Probe 展示；内置未安装项隐藏、custom 未安装项置灰；多 Agent 真实执行 Adapter、Supabase 真实自动接入尚未实现；签名/公证/商店提交按设计仍是人工步骤，每类模板内附 `generated/DISTRIBUTION.md` 清单 |
| 生产交付路径 | 已实现并**已在真实云端跑通**（2026-08-23 `Receipt Test` → `DELIVERED`，批准人 `feng`；2026-08-24 项目 3 `Link Vault` 同样从 `main` checkout 独立发布验证）：`ReleaseComposer` 9 步编排 + `release_runs` 日志 + Daemon `release/plan\|request\|approve\|retry` + Studio 发布区块。两道人工闸门（请求、具名批准）由状态机与 Schema 强制，Evidence 记录观测值而非判定常量，生产批准始终由用户本人给出。从记录仓库的生产分支 checkout 后发布，并要求该分支已带上被验收的提交（`962932a`），此前的"从本地 workspace 发布"缺口已修、并已真实跑过 |
| 失败步骤恢复（v0.1 验收） | ✅ 已闭环。**两类恢复均在真实链路验证**：(1) workspace 恢复 `POST .../apply/recover` 新建干净 workspace、保留旧的并报告其 Git 状态，`apply_runs.recovery_index` 保证顺序确定——`Receipt Test` 交付就跑在 `revision-5-recovery-1` 这个被 Codex 破坏后恢复出来的 workspace 上；(2) 发布失败恢复 `POST .../release/retry`——项目 3（`Link Vault`）缺陷 9 被验收提交不在 `main` 上导致发布被拒，补开 dev→main PR 后 `release/retry` 恢复成功。自动化侧：`apps/daemon/test/app.test.ts` 的 `release/retry` 端到端断言失败发布经 retry 回到 `RELEASING` 并最终 `DELIVERED`，且恢复不重开人工批准闸门；`packages/workflow` 状态机测试覆盖 `FAILED → RETRY → 原步骤 → 继续完成` 闭环 |
| 完整周期真实验证 | 3/3。`Receipt Test`（1/3）、`Workspace Verify Fresh`（2/3）、`Link Vault`（3/3）均已完成 Blueprint → Preview → Production 全周期；详见第 1 节项目条目 |
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
13. [真实链路经验沉淀](docs/real-world-lessons.md)：四个真实项目、界面走查与模板引擎暴露的 31 个缺陷、11 条架构规则、免费模型选型、环境前提与遗留资源
14. [安全与质量审计（2026-08-31）](docs/audit-2026-08-31.md)：全仓审计发现（含 4 条高危安全缺口）与五批整改方案

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
4. ✅ ~~为 Catalog 增加只读 Capability Probe~~：Daemon API 已提供探测结果，Studio 选择 Agent 后显示的是探测读到的东西——Adapter 要用的参数在不在该 CLI 的帮助输出里（列出 / 没列 / 帮助答不了三种分开印）以及 Adapter 状态；2026-09-02 去掉了原先那枚 `workspace-write` chip，它抄的是目录自己的声明而不是测量结果（详见 [Agent Runtime Catalog](docs/agent-runtime-catalog.md) §3.3）；仍需在各 Agent 实际安装环境逐个验证 Adapter；
5. ✅ ~~用一次必然产生 Git diff 的真实功能任务验证 Runtime 写入和 Quality Gate~~：已于 2026-08-11 完成；Human Acceptance 仍需由用户明确确认；
6. ✅ ~~将 Acceptance Gate 与正式 Delivery State 的实现/验证阶段关联~~：已于 2026-08-10 完成；本地批准进入 `LOCAL_ACCEPTED`，不代表生产交付；
7. ✅ ~~使用三个真实项目连续验证从 Blueprint 到 Preview/Production 的完整周期~~：**3/3 已完成**——`Receipt Test`（2026-08-23）、`Workspace Verify Fresh`（2026-08-23）、`Link Vault`（2026-08-24）都走完 Blueprint → Preview → Production 并上线，证据与三轮共修掉的缺陷见「最近进度」。遗留动作：
   - ~~三个项目的 Preview 资源仍在账号里（`receipt-test-*-pr-1`、`workspace-verify-fresh-*`、`link-vault-*-pr-1`），清理入口 `POST .../preview/cleanup`（`CLEANUP_PREVIEW`）；生产项目是交付物，不要清理。~~ **已于 2026-10-08 全部经 `POST .../preview/cleanup` 删除，2026-10-26 dry-run 两控制台复验清零。**
   - `release/approve` 只校验「被验收提交是生产分支祖先」，不会自动把 `dev` 提升到 `main`；若 PR 目标是 `dev`，发布前需显式补开 dev→main PR。
   - 生产发布必须由用户本人批准，不能由 Agent 代按；Daemon 必须带代理变量与 `NODE_USE_ENV_PROXY=1` 启动，否则云端验证会假失败。
   - Daemon 的 PATH 需同时含 node22 运行时、homebrew（2026-09-02 实测解析到 codex `0.151.0`，此前记为 0.142.3；要点是 homebrew 排在前面，避免默认解析到 fnm node20 全局 bin 那版有兼容 bug 的 `0.147.0`）和 fnm node20 全局 bin（`vercel`/`wrangler`）。同一台机器的 ambient node 是 `v20.20.2`，它让 `openclaw` 与 `pi` 连 `--version` 都答不出，所以这两个 Agent 的探测与执行在本机推不动（逐 Agent 对账见 [Agent Runtime Catalog](docs/agent-runtime-catalog.md) §3.5）。
8. 多产品形态六种类型全部生成真实模板（web-saas / landing-page / browser-extension / desktop 双 shell / mobile / api-tool），每一类的生成物都在本地真跑过自己的 quality gate，desktop-tauri 还真产出了未签名的 .app/.dmg。签名、公证与商店提交按设计仍是人工步骤，模板内附 `generated/DISTRIBUTION.md`。七种生成物的 quality gate 已按工作流声明的步骤在真实 Linux 容器里复现全绿（六类于 linux/amd64，与 `ubuntu-latest` 同架构；desktop-tauri 于 linux/arm64，`cargo check` 冷编译 10m30s），tauri 工作流的 apt 依赖清单也在 `ubuntu:24.04` 上验证过仍可安装。生成的工作流也已在**真实 GitHub Actions** 上执行：`bayernjf/receipt-test` 的 PR #2–#7 分别推入六类生成物，`quality` 全绿（landing-page 13s / browser-extension 23s / api-tool 42s / desktop-electron 46s / mobile 1m8s / desktop-tauri 3m45s）；web-saas 早在 2026-08-23 的 PR #1 就已绿。未做：Electron 窗口/Expo 模拟器/EAS Build 未真跑、部署平台可组合（M2）。tauri 工作流已加 `Swatinem/rust-cache@v2`（`workspaces: src-tauri`），同分支两次真跑量出 `quality` 96s → 6s、整个 job 3m12s → 1m23s。
9. **非 web-saas 类型的端到端真实交付（已完成，2026-08-27）**。选 `api-tool`（项目 `397d8de0-06f6-4773-bf7b-9c26c13ff009`「MCP Word Tools」）因为它只需要 GitHub、不碰云端供给。两个阻塞缺陷（24 / 25）已修掉。全流程已跑通：Blueprint → 基线审批 → GitHub 仓库创建（`bayernjf/mcp-word-tools`）→ Apply → Feature Task（Add count_tokens tool）→ Runtime 执行 → Quality Gate（5/5 测试通过）→ Acceptance（approved by feng）→ PR #2 合并到 dev → dev 合并到 main → **DELIVERED**。
   - **已知设计缺口（已于 2026-08-28 闭环）**：对于 api-tool / landing-page 等无托管部署类型的项目，状态机曾无法通过正常 API 推进到 DELIVERED（当时通过直接调用 store 的 `advanceDelivery` 手动推进）。现在状态机保持类型无关、`PR_OPEN` 接受 `REQUEST_RELEASE`，daemon 只允许无托管部署目标的产品走该捷径（托管产品在 PR_OPEN 仍被 preview gate 拒绝），此类产品的发布审批记录 "manual distribution" 证据，人工双闸门不变。
10. **审计整改（2026-08-31 审计产出，发现与验收标准以 [审计文档](docs/audit-2026-08-31.md) 为准）**。按五批执行，**P0 是外部 Pilot 阻断项——完成前不分发安装脚本**：
    - **P0 网络边界**：`serve()` 绑回 `127.0.0.1`（`apps/daemon/src/index.ts:45`）；全部 `/api/*` 加本机随机 token 鉴权（daemon 启动生成、写入仅当前用户可读文件，Studio 与 MCP 桥携带）；`importRepositoryUrl` 与证据 URL 限制 `http(s)`（封 `ext::`/`file://`/`javascript:`）；移除或门控 `POST /api/update` 与 `GET /api/update/check`。
    - **P1 状态机与校验**：`advanceDelivery` 事务化 + 非法事件显式抛错（`packages/storage/src/index.ts:1555-1573`，即「最近进度」生产交付路径条目记录的未验证边界）；4 条 runtime 门禁路由补 zod（`app.ts:819/850/863/876`）。
    - **P2 清理与一致性（已完成，见「最近进度」§6.3 条目）**：secret-backend 移除路由保留库（用户拍板）；根目录遗留 `install.sh` 已删除；确认字面量已收敛到 `@agent-dev/policy` 的 `CONFIRMATIONS` 单一事实源；ReleaseComposer 步数表述已修正（9 步）、`/api/health` 版本号已改为从 package.json 读取；死代码已清理、`rm -rf` 已改 fs/promises；版本号已升 `0.2.0`（用户拍板）。
    - **P3 Windows 兼容**：`npm`/`npx` 调用处理 `.cmd`（`storage/src/index.ts:777`、`:844`、`agent-runtime/src/doctor.ts`）；信号与符号链接用例按平台适配。
    - **P4 测试补齐（已完成，见「最近进度」§6.5 条目）**：storage pipeline 执行（含 resume 未落盘缺陷修复）、MCP 20 工具全覆盖、`advanceDelivery` 回归、Studio 渲染冒烟。
    - 用户决策均已落定：secret-backend「移除路由、保留库」（2026-08-31）；版本号升 `0.2.0`（2026-08-31）。
11. **v0.2 收尾**。P1-2 代码已落地（2026-09-01），仅剩**真实云端验证待办**——在 Infisical 控制台建 scratch 项目，按 [spikes/infisical-backend/README](spikes/infisical-backend/README.md) 配置后跑 `npm run probe:online`，回环 `complete: true` 后把 P1-2 状态升级为已验证（同步 `docs/implementation-plan-v0.2.md` 与 [凭证管理方案 §3.5](docs/credential-management.md)）。

    **不要把本条读成“v0.2 只剩 P1-2”**——上面 §8-3/§8-4/§8-7 各自还挂着未闭环子项，按对 Pilot 的影响排序：

    1. ~~**Studio 界面链路（§8-3 遗留，2026-08-14 起挂账，已于 2026-09-01 走完两阶段）**~~：历次端到端验证都是直接调 Daemon API，而外部用户只会点界面。现已用界面从「新建 Blueprint」走到 Apply 前（见「最近进度」2026-09-01 条目），冷启动鉴权缺陷正是走查时暴露的。走查查出的缺陷已全部修掉：「决策卡内容与产品类型矛盾」已于 2026-09-02 修掉（`ebe7ec4`）；「后端生成文案无 i18n 边界」已于 2026-09-02 五批全部落地（`4019905`~`b22ec08`，见决策依据文档）。
    2. ~~**各 Agent 在实际安装环境的 Adapter 验证**（§8-4 遗留）~~：**已于 2026-09-02 完成**（`ecde9eb`）——八个内置 Agent 全量只读对账，六个能答且 Adapter flag 全部在帮助里有据；openclaw/pi 因 ambient node v20.20.2（启动器要求 ≥22）答不出，属环境而非产品缺陷。逐 Agent 明细见 [Agent Runtime Catalog](docs/agent-runtime-catalog.md) §3.5。
    3. ~~**资源清单外部 ID/URL 与 Provider 控制台一致性逐项核对**~~（§8-3 遗留）：**已于 2026-09-10 完成**（`977139c`）——4 个项目的真实交付资源三家控制台全部存在，详见 [核对记录](docs/resource-reconciliation-2026-09-10.md)；带出两个新待办：清单 `projectName` 字段语义（apply 裸名 vs 生产名）待修正、4 个废弃裸名项目是否删除待用户拍板。
    4. ~~**Preview 遗留资源清理 + PR 关闭清理链路真实验证**（§8-7 与§7 段遗留；生产项目是交付物，不清理）~~：**2026-10-26 dry-run 复验两控制台均零符合删除条件**（详见「最近进度」首条）——2026-10-08 的清理事实成立，§8-7 旧文字「receipt-test-*-pr-1、workspace-verify-fresh-*、link-vault-*-pr-1 仍在账号里」已被事实超越。仅剩 **PR 关闭 webhook 的真实云端端到端验证**待下一个真实项目交付时自然触发（本地 HMAC/payload/路由测试已覆盖）；Vercel CLI 本机登录态已失效、4 个废弃裸名项目仍待 owner 拍板。
    5. **Windows 上 agent 执行路径不通（探测部分已于 2026-09-01 修复）**：`agent-runtime` 的版本探测与 PATH 发现已修（见「最近进度」同日条目，本机 6/6 agent 可探）；**尚余执行路径**：`runCodexProcess` 仍以无 shell 方式 spawn，npm shim 类 CLI（codex / claude / opencode / openclaw / codebuddy）一律 ENOENT，Windows 用户走 Apply → Feature Task 时 agent 起不来。修法待决策表「Windows agent 启动方式」拍板（`install-macos.sh` 表明 Pilot 目标为 macOS，因此推荐先显式降级而非引入注入面）。**当前开发环境为 macOS（2026-09-02 确认），Windows 相关无法真实验证，先搁置；待出现真实 Windows Pilot 用户再推进方案④（显式报错 + 可操作提示）。**

    走查进度：§8-11.1 已完成两个阶段——第一阶段（首屏 / 凭证面板 / Activity / zh 切换，只读）、第二阶段（界面建 Blueprint → 四个项目详情标签页中英各一遍 → Apply 前停手，无远端副作用）；冷启动鉴权缺陷已修复并验证；Windows 探测与发现路径已修。走查发现的具体缺陷与待办见「最近进度」2026-09-01 条目的「走查待办」子列。

    P1-2 的 Infisical 验证不改变外部用户的默认 `local-file` 路径，按 `docs/implementation-plan-v0.2.md` §1 的降权原则可后置。

## 9. 用户决策

| 决策 | 状态 | 值 |
| --- | --- | --- |
| 生产页面域名 | 已确认 | `app.example.com`，允许项目改为 apex |
| Supabase 环境 | 已确认 | dev 与 production 使用独立项目 |
| 模板最小业务能力 | 已确认 | 登录、基础用户资料、API health、示例受保护页面 |
| Analytics 默认 | 待确认 | 默认关闭，隐私确认后再接入 |
| GitHub Ruleset | 待确认 | 支持则自动计划；权限/套餐不足时生成 Manual Action |
| Blueprint 开源 | 待确认 | v0.1 稳定后再发布 v1alpha1 |
| Local Claude Runtime 验证 | 已推迟（2026-08-29） | v0.2 P0-1 暂缓；`claude-code` adapter 保持 `candidate`，不进 verified 列表。当前 Runtime 主力为 OpenCode 2.0 + `nemotron-3-ultra-free`。恢复触发条件：出现主力用 Claude 的 Pilot 用户 / 外部用户明确要求 / 免费模型额度或可用性出问题 |
| secret-backend 去留 | 已确认（2026-08-31） | 移除 daemon 9 条管理路由（消除 S4 明文出口）；`packages/provider-cli/src/secret-backend/` 库保留作 P1-2 Infisical Adapter 地基 |
| 版本号升级 | 已确认（2026-08-31） | 全部 13 个 package.json 从 `0.1.0-alpha.0` 升到 `0.2.0`，与 v0.2 Pilot 定位对齐 |
| P1-2 Infisical 集成方式 | 已确认（2026-09-01） | 凭证系统后端化（`credentials.ts` 经 `SecretBackend` 抽象切换，默认 `local-file` 字节级不变），不恢复独立 secret-backend 路由 |
| P1-2 真实验证时机 | 已确认（2026-09-01） | 延后：本轮交付代码 + 单元测试 + 探测脚本与配置指南；P1-2 标记「代码完成，真实验证待办」，不满足 ✅ |
| Windows agent 启动方式 | 待确认（2026-09-01） | **探测与 PATH 发现已修（同日，无争议部分先落地）**；待定的只剩**执行路径** `runCodexProcess`。候选：① 引入 cross-spawn（社区维护的 shim 解析 + cmd 参数转义）；② 自实现同等逻辑（无新依赖，但转义正确性要自己扛测试）；③ 从 npm `.cmd` shim 解析出 `node <entry.js>` 后无 shell 启动（无注入面，依赖 shim 格式，非 npm 安装需回退）；④ **推荐**：Windows 上检测到 shim 就显式报错 + 给可操作提示（改用原生 exe / 指到真实可执行 / 走 WSL），因为 `scripts/install-macos.sh` 说明 Pilot 目标是 macOS，目前没有 Windows Pilot；待出现真实 Windows 用户再升级到 ①/② |
| 领域文案的 i18n 边界 | ✅ 方案②五批全部落地（2026-09-02，4019905/ff5f664/caa3b07/6e1ee52/b22ec08） | 决策卡、dry-run 计划、manual actions、baseline plan、artifact titles 的英文文案**已全部并行发稳定 key+params**，Studio 用 key 查 locale、miss 回退英文，MCP 桥零改动。五批覆盖：dryRun(4)、decisions(37)、baselinePlan(15)、manualActions(37)、artifact titles(80 key，76 固定 + 2 可变×2 类型)。全量 530 测试绿。完整数据、字段形状、分批与风险见 [领域文案 i18n 边界决策依据](docs/i18n-domain-prose-decision.md)。 |

## 10. 交接完成定义

接手者在开始编码前应能明确回答：

- Agent-Dev 与 Codex 的责任边界是什么；
- 为什么首版采用 Local-first；
- 为什么 Cloudflare 和 Vercel 都是必选；
- 哪些操作必须人工批准；
- Blueprint、Markdown、Env Contract 和 Evidence 的关系；
- 哪五个 Spike 会影响架构；
- v0.1 需要用什么真实证据证明完成。
