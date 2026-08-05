# Agent-Dev 项目交接

> 更新时间：2026-08-06
> 当前阶段：Local Delivery Control Plane 已实现；真实 Provider Apply 与联合 Preview 仍处于技术验证阶段
> 工作目录：仓库根目录

## 1. 项目摘要

Agent-Dev 是面向 AI 产品创作者的 Agentic Product Delivery Platform。它位于 Codex、Claude Code 等 coding agent 上层，负责 Product Blueprint、Policy、平台连接、交付状态机、人工 Gate 和真实验收证据。

核心理念：

> 让人专注于产品为何存在，让 Agent 负责产品如何可靠地存在。

首版完成结果不是生成代码，而是交付一个归用户所有、可以访问、可以继续开发和维护的 Web 产品基线，并通过相同流程交付至少一个真实功能。

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
| 技术 Spike | Workflow Resume、macOS Secret Boundary 已通过；Codex 部分通过；Dual Preview 真实执行阻塞；Supabase Auth 前置阻塞 |
| Git 仓库 | 已初始化；Phase 0 提交已完成 |
| package.json / 代码骨架 | npm workspaces、Studio、Daemon、Blueprint、Policy、Provider Core、Storage、Workflow 已实现 |
| 当前本地能力 | Blueprint Revision、Dry Run、Connector Preflight/Discovery、资源归属计划、本地审批、带合法 npm 包名和 TypeScript/Vite 质量配置的固定 Web SaaS 模板、隔离工作区 Git baseline 与本地 feature branch、显式依赖安装与准备状态、Feature Task 与人工 Approval、Local Quality Gate、可恢复/可重试的 Local Apply Simulator、XState 状态推进、统一 Delivery Report、Fake Provider Adapter 计划/Apply/Verify 及 Studio 展示；真实 Codex 写入执行尚未接入 |
| 测试、构建和部署 | 本地单元测试与 Studio build 已通过；真实云端部署未运行 |

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
8. [对话决策记录](docs/decision-log.md)
9. [参考项目能力矩阵](docs/reference-project-blueprint-matrix.md)
10. [通用开发 SOP](ai-agent-development-sop.md)

市场判断和长期范围见 [市场分析](docs/market-analysis.md) 与 [路线图](docs/roadmap.md)。现有项目事实依据见 [项目组合复盘](portfolio-development-review.md)。

## 7. 阻塞性技术 Spike

下一位执行 Agent 在接入真实外部写操作前，应先完成或明确降级以下验证：

1. **Codex Runtime**：官方非交互入口、结构化输出、取消和恢复；
2. **Dual Preview**：Vercel API Preview URL 注入 Cloudflare Pages Build；
3. **Supabase Auth**：动态 CORS、Redirect URL 和 PR 关闭后的清理；
4. **Secret Boundary**：Provider CLI/OAuth、系统 Keychain、GitHub Secrets 的最小复制路径；
5. **Workflow Resume**：SQLite 持久化后从暂停 Gate 或失败 Step 恢复。

Codex Runtime 已确认本机 `codex-cli 0.145.0` 提供非交互执行、JSONL 事件、最终输出 Schema、sandbox、超时终止和 resume 命令入口。真实只读请求因本机认证无效而失败；用户恢复认证前不要运行写入、恢复和取消 Probe。详见 [Codex Runtime Spike](docs/spikes/codex-runtime.md)。

Workflow Resume 与 macOS Secret Boundary 已通过真实本地 Probe。Dual Preview 和 Supabase Auth 尚未取得云端 Evidence；当前 Vercel/GitHub CLI 已认证，Wrangler/Supabase CLI 已局部安装，其中 Supabase CLI 会尝试写入 `~/.supabase`，不符合当前文件边界。完整状态见 [Phase 0 技术 Spike](docs/spikes/README.md)。

Dual Preview 已真实验证到 Vercel 部署就绪，但公网 Preview 持续超时，所有临时项目已清理；Supabase 尚未进行平台写操作。两项降级都会改变 v0.1 验收范围，必须由用户在 [Phase 0 状态](docs/spikes/README.md) 给出的候选路径中确认后，才能进入正式工程骨架。

OpenAI 官方 Codex 手册和页面在 2026-08-02 的核对请求中返回 `403`。不得基于未核实记忆固定 Codex CLI 参数；需要重新访问官方资料或把首版降级为生成任务包后由用户手动启动 Codex。

## 8. 下一步执行顺序

1. 把 Local Quality Gate、依赖安装和 Delivery Report 合并为可审查的本地交付证据链；
2. 接入 Local Codex Runtime，在 feature branch/worktree 中执行一个真实功能任务；
3. 增加本地 feature task package、验收标准和人工 Approval 记录；
4. 完成 Dual Preview 与 Supabase Auth 的真实平台验证，或由用户确认明确降级路径；
5. 在真实授权边界下接入 GitHub、Vercel、Cloudflare、Supabase Provider Adapter；
6. 使用三个真实项目连续验证从 Blueprint 到 Preview/Production 的完整周期。

## 9. 尚待用户决策

| 决策 | 当前推荐 |
| --- | --- |
| 生产页面域名 | `app.example.com`，允许项目改为 apex |
| Supabase 环境 | dev 与 production 使用独立项目 |
| 模板最小业务能力 | 登录、基础用户资料、API health、示例受保护页面 |
| Analytics 默认 | 默认关闭，隐私确认后再接入 |
| GitHub Ruleset | 支持则自动计划；权限/套餐不足时生成 Manual Action |
| Blueprint 开源 | v0.1 稳定后再发布 v1alpha1 |

## 10. 交接完成定义

接手者在开始编码前应能明确回答：

- Agent-Dev 与 Codex 的责任边界是什么；
- 为什么首版采用 Local-first；
- 为什么 Cloudflare 和 Vercel 都是必选；
- 哪些操作必须人工批准；
- Blueprint、Markdown、Env Contract 和 Evidence 的关系；
- 哪五个 Spike 会影响架构；
- v0.1 需要用什么真实证据证明完成。
