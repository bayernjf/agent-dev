# Agent-Dev 项目交接

> 更新时间：2026-08-08
> 当前阶段：Local Delivery Control Plane 已实现；真实 Provider Adapter 已验证通过（GitHub/Vercel/Cloudflare 真实接入，Supabase Manual 降级）；Dual Preview Spike 已通过真实云端验证；Supabase Auth 已确认 Manual 降级路径；凭证管理 Phase 1 已实现，Studio 凭证面板和真实 Supabase Adapter 待完成
> 工作目录：仓库根目录

## 最近进度

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
- 凭证管理 Phase 1 已实现本地凭证/元数据文件、项目资源清单、`.env` 生成器和 daemon API；Studio 凭证面板、真实 Supabase Adapter 仍待完成。
- 最近验证：全 workspace typecheck、Agent Runtime 6 tests、Daemon API 2 tests、Storage 5 tests 均通过。
- 当前工作分支：`feature/20260802`，领先 origin 6 个 commit（未推送；工作区还有未提交文档和本次 Agent Catalog 改动）。

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
| 凭证管理方案 | Phase 1 已实现（详见 [凭证管理方案](docs/credential-management.md)）。当前凭证和元数据写入 Agent-Dev `.agent-dev` 目录，项目资源清单写入 workspace `.agent-dev`，自动生成 `.env`；Studio 面板和真实 Supabase Adapter 待完成 |
| 当前本地能力 | Blueprint Revision、Dry Run、Connector Preflight/Discovery、资源归属计划、本地审批、固定 Web SaaS 模板、隔离工作区 Git baseline、Feature Task 与人工 Approval、Codex Runtime dry-run/Execute/Retry、运行结果和 Git evidence、Acceptance Gate、Final Delivery Report、Local Quality Gate、Local Apply Simulator、XState 状态推进、Fake Provider Adapter、真实 Provider Adapter（GitHub/Vercel/Cloudflare）及 Studio 展示；Agent Catalog 已支持 Key-Value 内置目录、Studio 选择、Custom Agent 弹窗和 `.agent-dev/agents.conf` 持久化；内置未安装项隐藏、custom 未安装项置灰；多 Agent 真实执行 Adapter、凭证管理 UI、Supabase 真实接入尚未实现 |
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

所有 Agent-Dev 产物只写入当前 `agent-dev`。同级的 `bayjf`、`word-picker`、`word-base`、`soft-desk`、`pr-helper`、`tab-manager` 仅可只读参考，除非用户明确授权具体修改。

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

下一位执行 Agent 在接入真实外部写操作前，应先完成或明确降级以下验证：

1. **Codex Runtime**：官方非交互入口、结构化输出、取消和恢复；
2. **Dual Preview**：Vercel API Preview URL 注入 Cloudflare Pages Build；
3. **Supabase Auth**：动态 CORS、Redirect URL 和 PR 关闭后的清理；
4. **Secret Boundary**：Provider CLI/OAuth、系统 Keychain、GitHub Secrets 的最小复制路径；
5. **Workflow Resume**：SQLite 持久化后从暂停 Gate 或失败 Step 恢复。

Codex Runtime 已确认本机 `codex-cli 0.142.3` 提供非交互执行、JSONL 事件、最终输出 Schema、sandbox、超时终止和 resume 命令入口。2026-08-06 的只读请求在模型调用前因当前受限环境禁止 Codex 写入 `~/.codex/state_5.sqlite` 而停止，未能验证认证；不要通过 Agent-Dev 绕过该状态目录边界。详见 [Codex Runtime Spike](docs/spikes/codex-runtime.md)。

Workflow Resume 与 macOS Secret Boundary 已通过真实本地 Probe。Dual Preview 已通过真实云端验证：Vercel API 部署、Cloudflare Pages 部署、跨域通信和 API URL 注入均取得真实 Evidence。Supabase Auth 已确认采用 Manual 降级路径（路径 C），由用户手动完成项目创建和凭证管理，RealProviderRegistry 已实现自动降级为 ManualProviderAdapter。完整状态见 [Phase 0 技术 Spike](docs/spikes/README.md)。

Dual Preview 的下一动作是将部署编排实现为 Provider Adapter 幂等 Step，包括精确 CORS origin（替换当前的 `*`）和临时项目自动清理。Supabase Auth 的后续优化目标是实现 Management API 自动基础设施 + 人工敏感配置审批的分阶段方案。

OpenAI 官方 Codex 手册和页面在 2026-08-02 的核对请求中返回 `403`。不得基于未核实记忆固定 Codex CLI 参数；需要重新访问官方资料或把首版降级为生成任务包后由用户手动启动 Codex。

## 8. 下一步执行顺序

1. **实现凭证管理 Phase 2**：Studio 凭证管理面板 + 新手引导流程 UI；
2. 为 Catalog 增加只读 Capability Probe，并为 Claude Code、Aider、OpenCode、CodeBuddy、Pi、Hermes、OpenClaw 逐个验证 Adapter；
3. 用一次真实功能任务验证 Runtime 写入、Git diff、Quality Gate 和 Acceptance Gate 的成功路径；
4. 将 Acceptance Gate 与正式 Delivery State 的实现/验证阶段关联，但不把本地批准误标记为生产交付；
5. 将 Dual Preview 部署编排实现为 Provider Adapter 幂等 Step，并优化 Supabase Auth 为 Management API 自动基础设施 + 人工敏感配置审批的分阶段方案；
6. 使用三个真实项目连续验证从 Blueprint 到 Preview/Production 的完整周期。

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
