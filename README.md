# Agent-Dev

Agent-Dev 是面向 AI 产品创作者的自主产品交付平台。它不替代 Codex、Claude Code 等 coding agent，而是在其上层管理产品规范、权限、交付状态、云平台连接、人工审批和验收证据。

核心承诺：让用户专注于产品为何存在，让 Agent 负责产品如何可靠地存在。

## 第一版定位

`v0.1` 面向已经使用 GitHub 和 Codex 的独立开发者，先提供一条固定的 Web SaaS Golden Path。Web SaaS 是验证交付控制面的第一种产品类型，不是 Agent-Dev 的最终产品边界。多产品类型的扩展原则和阶段见 [多产品类型交付方案](docs/multi-product-delivery-plan.md)。

```text
React/Vite 前端 -> Cloudflare Pages
Hono API       -> Vercel Functions
Database/Auth  -> Supabase
Source/CI      -> GitHub/GitHub Actions
Agent Runtime  -> 用户电脑中的 Codex
```

第一版的完成结果不是“生成代码”，而是：创建一个归用户所有、可访问、可继续开发和维护的产品基线，并完整交付至少一个真实功能。

## 文档索引

### 产品定义

- [产品愿景与宪法](docs/product-vision.md)：产品定位、责任边界、用户所有权和自治原则。
- [v0.1 PRD](docs/prd-v0.1.md)：目标用户、范围、核心流程、功能需求和验收指标。
- [对话决策记录](docs/decision-log.md)：本轮讨论中已经确认、尚待确认和明确排除的事项。

### 技术设计

- [v0.1 技术架构](docs/technical-architecture-v0.1.md)：Local-first 架构、状态机、双平台部署、Agent Runtime 和安全边界。
- [v0.1 实施计划](docs/implementation-plan-v0.1.md)：Agent-Dev 自身技术选型、PRD 工程拆解、完成定义和开发顺序。
- [Product Blueprint 规范](docs/blueprint-spec.md)：模块化问卷、候选项、自定义答案、继承、版本和生成物。
- [环境变量与平台连接](docs/environment-and-connectors.md)：Env Contract、Secrets、Provider Adapter 和最小人工步骤。
- [Agent Runtime Catalog](docs/agent-runtime-catalog.md)：内置 Agent 自动识别、自定义 Agent 最小配置和 Runtime 选择策略。

### 规划与依据

- [市场与竞争分析](docs/market-analysis.md)：相邻产品、竞争压力、差异化与商业判断。
- [参考项目能力矩阵](docs/reference-project-blueprint-matrix.md)：六个真实项目到 Blueprint、Adapter 和验收用例的映射。
- [产品路线图](docs/roadmap.md)：从内部闭环到托管运行时、模板生态和企业能力。
- [多产品类型交付方案](docs/multi-product-delivery-plan.md)：Web SaaS、落地页、浏览器插件、桌面端和移动端的共享层、类型层与推进门槛。
- [AI Agent 全周期开发 SOP](ai-agent-development-sop.md)：需求到生产交付的通用治理基线。
- [现有项目组合复盘](portfolio-development-review.md)：六个已有项目的流程资产、缺口和证据。

### 当前实施

- [Phase 0 技术 Spike 状态](docs/spikes/README.md)：本机实测证据、阻塞项和进入工程阶段的 Gate。
- [真实链路经验沉淀](docs/real-world-lessons.md)：三个真实项目暴露的缺陷、架构规则、模型选型与环境前提。
- [v0.2 实施计划](docs/implementation-plan-v0.2.md)：v0.2 的目标、工程拆解与完成定义。
- [Agent Profile 自定义方案](docs/custom-agent-profiles.md)：Runtime 的 Profile 化配置、校验与合并规则，已实施。
- [凭证管理](docs/credential-management.md)：本地凭证文件、连接元数据、`.env` 生成器与 Studio 引导面板。
- [对外 MCP 桥接](docs/mcp-bridge.md)：`agent-dev mcp` 的 20 工具清单、闸门边界与客户端配置。
- [Studio 双主题设计方案](docs/studio-theme-design.md)：Studio 深/浅双主题 token 化视觉方案，已实施（`90696d4`）。
- [Studio i18n 设计方案](docs/studio-i18n-design.md)：Studio 中/英双语方案，默认英文、术语保留英文，已实施（`90696d4`）。
- [外部 Pilot 招募](docs/pilot-recruiting.md)：v0.2 外部 Pilot 参与条件、流程、激励与隐私边界，申请/反馈走仓库 Issue 模板。
- [安全与质量审计 2026-08-31](docs/audit-2026-08-31.md)：全仓审计发现与整改方案（P0–P4），整改进度以此为准。
- [项目交接](handoff.md)：当前分支、硬约束、已完成工作和下一步。

## 当前状态

当前仓库处于 `v0.2` Pilot 阶段（版本 `0.2.0`）：四个真实项目已通过 BluePrint → Preview → Production 全周期交付上线，2026-08-31 完成全仓安全与质量审计并落地 P0–P4 全部整改（回环绑定 + token 鉴权、状态机事务化、清理一致性、Windows 兼容、测试补齐，当时 220 例），2026-09-01 P1-2 凭证后端化落地，同日 Studio 冷启动鉴权、Windows Agent 发现路径、以及 Runtime 列表把未验证的执行能力当成已验证展示这三个缺陷修复补测后全仓 259 例测试全绿；2026-09-02 完成 Studio 界面走查待办中不需要架构决策的全部条目（中英文案、产品类型列名、两个审批状态的区分、执行者契约），现全仓 317 例测试全绿。不是可用于生产的稳定版本。

本地可运行能力：

- 创建 Web SaaS 项目并保存结构化 Product Blueprint；
- 新手模式使用推荐答案，专业模式可配置数据敏感度、Preview、埋点和受控自定义说明；
- 每次修改生成新的 Blueprint Revision，不覆盖历史；
- 显示哪些决策会自动处理、必须获得批准，或只能由用户手动完成；
- 为任一 Blueprint Revision 生成 Product Standard、Agent 约束、交付流程、环境变量 Contract 和交接文档预览；
- 显示无外部写入的 Dry Run，以及每个 Provider 的最小人工操作和验证条件；
- 运行本机 Connector Preflight，区分命令可用性与尚未进行的账号授权；
- 使用不联网的 Fake Provider Adapter 验证 `discover -> plan -> apply -> verify -> detectDrift` 契约、审批边界和幂等键；
- Studio 展示四个平台的模拟 Plan、Verify 结果和 Provider Simulation Report；
- Verify 后可预览合并 Local Apply 步骤与 Provider 证据的统一 Delivery Report；
- 读取本机 GitHub、Vercel 与 Cloudflare CLI 的当前身份状态；Supabase 仍明确要求人工确认；
- 在专业模式保存 GitHub Owner、Supabase Organization、Vercel Team 与 Cloudflare Account，并生成不执行创建操作的资源基线计划；
- 对已完整选择归属的基线计划记录显式、本地且按 Blueprint Revision 绑定的审批；
- 在审批后运行本地 Apply Simulator，将生成物、无 Secret 的执行清单和 `DELIVERY_REPORT.md` 写入忽略的 `.agent-dev/apply/` 工作区，并保留逐步骤结果；
- Local Apply 同时生成固定 Web SaaS 工程基线：Vite/React 前端、Hono API、Cloudflare Pages、Vercel Functions 和 GitHub Actions 质量门禁；
- Local Apply 会在隔离工作区初始化 Git 并创建 baseline commit，作为后续 feature branch/PR 流程的起点；
- Local Apply 会从 baseline commit 创建 `feature/agent-dev/revision-N` 本地 feature 分支，并把分支与基线提交写入 `apply-manifest.json` 和 Delivery Report；
- Local Quality Gate 可在生成工作区执行 `npm run quality`，持久化 `quality-gate.json` 与 `QUALITY_REPORT.md`，失败时返回真实退出码和命令输出，不会伪报通过；
- Studio 会检查生成工作区的 `node_modules`、TypeScript quality binary 和 lock file 状态；依赖未安装时给出本地 `npm install` 指引，并禁用质量门禁执行；
- 依赖安装是独立的显式动作（`INSTALL_DEPENDENCIES`）：只在用户确认后运行 `npm install`，并生成 `dependency-install.json` 与 `DEPENDENCY_INSTALL_REPORT.md`；
- Local Apply 完成后可在 Studio 创建 Feature Task，提交目标、验收标准和任务边界；人工批准后生成 `TASK_APPROVAL.md` 并提交到本地 feature 分支；
- 只有已批准的 Feature Task 才能作为后续 Runtime 执行输入；默认仍先生成 dry-run 计划。
- Runtime Adapter 能生成受 sandbox、workspace 和禁止路径约束的执行计划（命令按解析出的 Agent 拼），并通过环境变量白名单启动显式批准的 `workspace-write` 执行；2026-08-11 已在隔离生成工作区完成一次产生实际源码 diff 的真实 Codex feature task、质量门和 Git evidence 验证。Human Acceptance 仍由用户明确批准。
- Runtime Run 已支持 dry-run 的 prepare/cancel 生命周期，以及显式 Execute 的 running/completed/failed 证据、Git branch/HEAD/diff evidence、attempt 历史和 `RUNTIME_RUN_REPORT.md`；失败运行可通过 `RETRY_RUNTIME_RUN` 显式重试，历史不会被覆盖。
- Studio 已展示 Runtime Run 状态、取消动作、按执行者命名的显式运行/重试按钮和 Git evidence；Execute/Retry 都需要确认字符串，不允许绕过任务批准。
- 「这个任务由谁执行」只有一个答案：Agent Profile 解到 base Agent、剥掉 `local-` 命名空间后查 `AGENT_ADAPTERS`，只有 `verified` 能承接任务；解析不通过时 daemon 直接拒（409 + `code: agent_not_executable` + `agentId`），**任何一层都不会把执行者换成另一个 Agent**，Studio 把被拒的 Agent 名字和“没换人”一起说出来。
- Daemon 已提供 `/api/runtime/catalog`，内置 Agent 来自 `agents.builtin.conf`，可登记名称 + 启动命令的 custom Agent；内置未安装项隐藏，custom 未安装项置灰并保存到 `.agent-dev/agents.conf`。
- Studio Agent Catalog 支持主动刷新和只读 Capability Probe：探测只读 CLI 的帮助输出，从不真的跑一次，所以 chip 印的是「Adapter 要用的参数在不在帮助里」，并区分「没列」与「帮助答不了」两种不是同一件事的 false；Adapter 状态仍为 `verified`、`candidate`、`unsupported`。未知能力不会被自动宣称为可执行。
- 凭证管理 Phase 1 + Phase 2 已提供本地凭证文件、连接元数据、项目资源清单、`.env` 生成器、daemon API 和 Studio 引导/验证面板；Secret 不返回 API、不写入数据库。Supabase 自动 Adapter 按决策保持 Manual。
- Acceptance Gate 已接入 Studio：提交验收总结和标准确认后，根据 Quality Gate/Git evidence 生成 `ACCEPTANCE_REPORT.md`；blocked 状态不能批准交付。
- `GET /api/projects/:projectId/delivery-report` 汇总所有本地证据，Studio 展示 Final Delivery Report；报告明确区分本地完成、人工批准和未执行的外部交付。
- 本地验收批准后，可通过显式 PR/Preview Evidence API 逐步推进到 `PR_OPEN` 和 `PREVIEW_READY`；接口会校验前置状态并把证据写入隔离 workspace，不能跳过生产审批。
- Studio 会根据当前状态显示对应的 PR 或 Dual Preview 证据表单，避免用户手工调用接口或跳过交付阶段。
- 平台自己推送并开 PR（`POST .../delivery/pull-request`），推送前校验 `origin` 与资源清单一致、HEAD 包含被验收的提交。
- 生产发布为两道人工闸门（请求 + 具名批准），从记录仓库的生产分支 checkout 后发布，并要求该分支已带上被验收的提交；没有记录仓库或未验收时发布被阻塞并给出原因。基线、Feature Task、交付验收与生产批准都必须具名，没有默认身份。
- 已记录的 PR/Preview 证据可通过只读 API 和 Studio 历史区恢复查看。
- 固定模板生成合法 npm slug 包名；首次物化使用 `npm install` 建立 `package-lock.json`，提交锁文件后再由项目切换到 `npm ci`；
- 模板基线带有根 TypeScript/Vite 配置，可执行 `npm run quality` 和 `npm run build` 作为生成工程的质量入口；
- Apply 步骤按状态持久化，支持失败后显式重试（最多 3 次）并对已完成 Run 保持幂等；
- 通过本地 SQLite 保存项目、交付状态和 Blueprint 历史。

身份发现只读取本机 CLI 已有登录状态；资源基线计划只显示阻塞项和待批准的创建意图。审批当前只是一条本地审计记录；Apply Simulator 只写入本仓库忽略的本地工作区，绝不写入 GitHub、Supabase、Vercel 或 Cloudflare。

已实现本地生成物物化、Provider 计划与真实 CLI Adapter、凭证连接、模板代码生成、受控 Codex 执行、Dual Preview 编排和交付报告。真实云端全链路已于 2026-08-23 跑通：`Receipt Test` 从 Blueprint 走到 `DELIVERED`，PR 经 GitHub Actions 质量门禁后合并，生产 API 与页面均对外可访问并在平台报告之外独立复验。这一轮暴露的两处架构缺口（生产须从记录仓库的生产分支 checkout 后发布、每个人工闸门必须具名）随后修掉并在第二个项目验证。截至目前四个真实项目全部完整交付上线：`Receipt Test`（1/4，web-saas）、`Workspace Verify Fresh`（2/4，验证具名闸门与生产分支发布修复）、`Link Vault`（3/4）、`MCP Word Tools`（4/4，首个非 web-saas 类型）。项目 2 还暴露并修掉第 7 个真实缺陷——Agent 以 workspace 外部符号链接绕过产物提交拦截（`commitAgentChanges` 新增外部 symlink 守卫，生成器 `.gitignore` 改用 `node_modules` 同时匹配目录/文件/symlink）。

已经取得本地 Evidence：

- XState + SQLite 跨进程恢复人工 Gate 和失败步骤；
- macOS Keychain、Secret 引用、Agent 环境白名单和日志脱敏；
- GitHub、Vercel、Cloudflare 本地 CLI 的结构化 Preflight；
- Dual Preview 的本地 API、精确 CORS 和 URL 注入契约。

当前阻塞：

- 本机 Codex 只读与临时 fixture 的 workspace-write Runtime Probe 已通过；首个真实功能任务曾在 180 秒上限内超时并被正确记录，随后在 2026-08-11 完成了产生源码 diff 且通过 Quality Gate 的真实功能任务；失败重试和 attempt 历史已实现，但真正的 Codex session resume 仍未接入；
- Deployment Composer 已包含 Vercel Deployment Protection 关闭、精确 CORS、Cloudflare Pages URL 证据和清理逻辑；签名验证的 GitHub `pull_request.closed` Webhook 会按 `pr-<number>` 清理对应的临时 Vercel/Cloudflare 项目。本机 Vercel CLI 和 Wrangler 均已授权，真实网络已能访问 Vercel Deployment Domain。关闭 Deployment Protection 不再需要单独的 `VERCEL_TOKEN`：无 token 时走 `vercel api -X PATCH /v9/projects/{name}` 复用 CLI 现有登录态，设置了 `VERCEL_TOKEN` 则仍走 REST API（两条路径均有单元测试）。2026-08-14 正式 Composer 已在真实云端跑通全部 7 步并取得 Evidence，PR 关闭清理链路仍只有本地测试覆盖。
- Supabase CLI 的本地状态目录与当前文件边界冲突，Auth Redirect 尚未进行真实平台验证。

事实、降级候选和下一项 Gate 见 [Phase 0 技术 Spike 状态](docs/spikes/README.md)。文档中的 `v0.1` 是计划目标，不代表对应连接器和交付能力已经实现。

## License

当前仓库尚未选择开源许可证。公开可读不等于自动获得复制、分发或商用授权；许可证将在产品边界稳定后由维护者明确选择。
