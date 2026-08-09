# Agent-Dev v0.1 实施计划

> 状态：Ready for Technical Spikes  
> 日期：2026-08-02  
> 上游文档：[v0.1 PRD](prd-v0.1.md)、[技术架构](technical-architecture-v0.1.md)

## 1. 实施目标

把 PRD 落地为一个 Local-first Web App，并完成唯一首版 Golden Path：

```text
用户选择 Web SaaS 模板并确认产品决策
-> Agent-Dev 创建工程和平台资源
-> React/Vite 页面部署到 Cloudflare Pages
-> Hono API 部署到 Vercel Functions
-> Supabase 提供 Database/Auth
-> 用户提交一个功能需求
-> 本地 Codex 在隔离 worktree 实现
-> GitHub PR、联合 Preview、人工验收和交付报告
```

第一版不是托管 SaaS，不服务完全小白，不覆盖其他产品类型和供应商。

## 2. Agent-Dev 自身技术选型

| 层 | 选型 | 首版理由 |
| --- | --- | --- |
| 语言 | TypeScript | 与现有项目资产一致，前后端和 CLI 共享类型 |
| Monorepo | npm workspaces | 足够支撑首版，不引入 Nx/Turborepo 额外复杂度 |
| Studio | React + Vite | 快速、本地加载轻量、适合 Schema-driven UI |
| Local API | Node.js + Hono | 统一承载 API、任务协调和本地平台操作 |
| CLI | TypeScript Node CLI | 启动、安装检查、诊断、Runner 生命周期 |
| 本地状态 | SQLite + Drizzle | 单用户持久化、迁移明确、未来可抽象到 Postgres |
| 工作流 | XState + SQLite persistence | 显式表达 Gate、失败、暂停、恢复和重试 |
| 问卷 | JSON Schema + RJSF | 从模块 Schema 生成新手/专业表单 |
| 数据校验 | Zod | 校验 Blueprint、Plan、Provider 输出和 Evidence |
| 实时传输 | Server-Sent Events | 首版以服务端向 UI 推送状态为主，无需 WebSocket |
| Agent | Local Codex Runtime Adapter | 复用用户本地运行时，降低托管成本与凭据风险 |
| Git | 系统 Git + worktree | 复用用户配置，隔离 Agent 修改 |
| Provider | 官方 API/CLI + Adapter | 统一 plan/apply/verify，避免 SDK 侵入核心 |
| Secret | 目标平台 + 系统 Keychain | SQLite 只保存引用，生产 Secret 不进入 Agent 上下文 |
| 单元测试 | Vitest | TypeScript 内核、Schema、状态机和 Adapter 契约 |
| E2E | Playwright | Studio 和真实联合 Preview 的关键流程验证 |
| 日志 | 结构化 JSON | 支持脱敏、失败分类、Evidence 和后续分析 |

## 3. 生成产品的固定技术栈

```text
React + Vite + TypeScript -> Cloudflare Pages
Hono API                  -> Vercel Functions
Supabase                  -> Database + Auth
GitHub                    -> Repository + PR + Actions + Environments
Local Codex               -> Feature implementation
```

Cloudflare 与 Vercel 不是候选关系：Cloudflare Pages 负责页面，Vercel Functions 负责 API。

## 4. 工程结构

```text
agent-dev/
├── apps/
│   ├── studio/                  # React/Vite 可视化控制台
│   ├── daemon/                  # Hono 本地 API 与任务执行
│   └── cli/                     # 启动、doctor、环境检测
├── packages/
│   ├── blueprint/               # Schema、解析、覆盖、Diff、生成
│   ├── workflow/                # Delivery State Machine
│   ├── policy/                  # 自动/询问/禁止的确定性判断
│   ├── agent-runtime/           # Runtime 接口与 Local Codex
│   ├── provider-core/           # Provider 共享契约
│   ├── provider-github/
│   ├── provider-supabase/
│   ├── provider-vercel/
│   ├── provider-cloudflare/
│   ├── deployment-composer/     # 双平台部署顺序与 URL 传递
│   ├── env-contract/            # 变量契约、同步与验证
│   └── evidence/                # 外部证据与交付报告
├── schemas/
│   ├── blueprint/
│   └── modules/
└── templates/
    └── web-saas/
```

首版所有 package 同进程运行，包边界用于契约和测试，不拆微服务。

## 5. PRD 到工程模块映射

| PRD 功能 | 工程实现 | 主要验收 |
| --- | --- | --- |
| Blueprint 问卷 | `blueprint` + Studio RJSF | 生成并验证 `agent-dev.yaml` |
| 规范生成 | `blueprint/generators` | Markdown、Env Contract 带 revision/hash |
| 环境检查 | CLI `doctor` | 检测 Git、Node、npm、GitHub、Codex |
| Dry Run | Provider `discover/plan` | 无外部副作用，展示 Diff/权限/费用 |
| 项目脚手架 | `templates/web-saas` | 本地可测试并具备 CI |
| 平台连接 | 四个 Provider Adapter | 创建后重新读取真实状态验证 |
| 联合部署 | `deployment-composer` | API/页面 URL 均可访问并联合 smoke；Composer 已实现（7 步幂等编排含 Vercel SSO Protection 关闭、精确 CORS、临时项目清理），10 个单元测试通过，真实云端端到端待验证（需安装 Vercel/Wrangler CLI） |
| Agent 执行 | `LocalCodexRuntime` + Runtime Catalog API | 隔离 worktree、范围受控、可取消；内置 Agent 探测、custom 名称/命令登记、Studio 选择和只读 Capability Probe 已完成 |
| 质量门禁 | Quality Contract + GitHub Actions | 本地/CI 命令语义一致 |
| 人工 Gate | `workflow` + `approvals` | 暂停、重启进程、恢复后继续 |
| 失败恢复 | Apply retry policy + Runtime attempt history | Apply 最多两次；Runtime 失败可显式 Retry，所有 attempt 保留在 JSON/Markdown evidence |
| 交付报告 | `evidence` | 每个验收标准映射真实证据 |

## 6. 开发阶段

### 阶段 A：工程基础

实现：

- npm workspaces 和统一 TypeScript 配置；
- Studio、Daemon、CLI 最小应用；
- SQLite Migration 和 Drizzle Repository；
- SSE 事件模型；
- 结构化日志与 Secret 脱敏。

完成定义：

- CLI 启动本地服务并打开 Studio；
- Studio 创建项目记录；
- 重启后项目和运行状态仍存在；
- 日志中不会输出已标记 Secret。

### 阶段 B：Blueprint Studio

实现：

- `ProductBlueprint v1alpha1` Schema；
- 模块、候选项、默认值和结构化自定义；
- 新手问卷与专业 YAML 编辑；
- Revision、来源、Diff 和 Lockfile；
- Product Standard、AGENTS、Delivery Workflow、Env Contract 生成器。

完成定义：

- 同一 Blueprint 可由 UI 和 YAML 表达；
- 修改答案产生新 Revision 而非覆盖历史；
- 不兼容组合无法进入 Apply；
- 生成物可重复生成且内容稳定。

### 阶段 C：Provider 与项目基线

实现：

- GitHub、Supabase、Vercel、Cloudflare Adapter；
- `discover -> plan -> apply -> verify` 契约；
- Web SaaS 模板；
- Provider 授权与 Manual Action；
- Env Contract 初次同步。

完成定义：

- Dry Run 不创建资源；
- Apply 使用稳定幂等键；
- 中断后重新执行不会重复创建项目；
- Verify 从平台重新读取事实；
- 产品基线可以在本地启动和测试。

### 阶段 D：联合 Preview

固定执行顺序：

```text
quality
-> deploy Vercel API Preview
-> verify API health
-> derive VITE_API_BASE_URL
-> build React/Vite frontend
-> deploy Cloudflare Pages Preview
-> update exact CORS origin
-> update Supabase Auth Redirect URL
-> browser/API smoke test
-> write PR evidence
```

完成定义：

- PR 同时获得页面和 API Preview URL；
- 页面真实调用该 PR 的 API；
- CORS 不是 `*`；
- Auth Redirect 成功且 PR 关闭后可清理；
- 任意一步失败时运行状态真实，不显示交付完成。

### 阶段 E：Codex 功能交付

实现：

- Runtime 能力检测；
- Feature Task Contract；
- Git worktree 和分支生命周期；
- 官方支持的 Codex 非交互调用；
- 本地 quality、PR 创建和 Checks 读取；
- 最多两次自动修复。

完成定义：

- Agent 不能访问生产 Secret；
- Agent 修改仅存在于隔离 worktree；
- 用户取消后不继续外部写操作；
- CI 失败修复更新原 PR；
- 超出尝试次数后产生结构化人工 Gate。

### 阶段 F：Evidence 与交付

实现：

- Checks、Deployments、测试、URL 和人工验收 Evidence；
- Delivery Run 时间线；
- Preview、生产和高风险 Gate；
- 交付报告；
- Drift 检测入口。

完成定义：

- 每个完成的验收标准都有 Evidence；
- 未执行验证不能写成通过；
- 进程关闭后等待中的 Gate 可以恢复；
- 最终报告包含残余风险、未验证项和回滚方式。

## 7. 核心状态机

```text
DRAFT
-> NEEDS_INPUT
-> PLAN_READY
-> PROVISIONING
-> BASELINE_READY
-> IMPLEMENTING
-> VERIFYING
-> PR_OPEN
-> PREVIEW_READY
-> AWAITING_APPROVAL
-> RELEASING
-> DELIVERED
```

`PAUSED` 和 `FAILED` 是可恢复状态，不是另起一个新的 Delivery Run。每个 Step 持久化输入版本、幂等键、输出摘要、Evidence、重试次数和错误分类。

## 8. 正式编码前的技术 Spike

| Spike | 要回答的问题 | 失败时降级 |
| --- | --- | --- |
| Codex Runtime | 官方非交互、结构化输出、取消、恢复 | 首版生成任务包，由用户在 Codex 手动启动 |
| Dual Preview | Vercel URL 如何稳定传入 Pages Build | 使用稳定 dev API，PR API 变更暂时人工验证 |
| Supabase Auth | 动态 Redirect、CORS 和清理 | 首版使用稳定 dev 域名而非每 PR Auth |
| Secret Boundary | CLI/OAuth/Keychain/CI 的最小复制 | 生成 Manual Action，不扩大权限 |
| Workflow Resume | 进程中断后 Gate/Step 恢复 | 阻止进入功能开发，先修状态一致性 |

OpenAI 官方 Codex 文档核对在 2026-08-02 返回 `403`；实现阶段不能凭记忆固定 CLI 参数，必须重新核对官方能力或采用明确降级。

## 9. 建议开发顺序

1. 完成五个 Spike 并记录结论；
2. 初始化 Git 和 npm workspaces；
3. 建立 SQLite、XState 和 SSE 最小闭环；
4. 实现 Blueprint v1alpha1 与生成器；
5. 实现 GitHub Adapter 和 Web SaaS 本地模板；
6. 实现 Vercel API 与 Cloudflare Pages 联合 Preview；
7. 接入 Supabase 和 Env Contract；
8. 接入 Local Codex Runtime；
9. 完成功能 PR、人工 Gate 和 Delivery Report；
10. 用三个真实产品连续试运行。

不要先制作复杂 Dashboard、托管账号系统、模块市场或多个 Runtime。

## 10. v0.1 完成标准

- 三个真实 Web 产品使用同一 Blueprint 完成初始化；
- 每个产品至少交付一个真实功能；
- Cloudflare Pages 页面与 Vercel API 联合 Preview 可用；
- Supabase Auth、CORS 和环境变量通过验证；
- 至少一次真实失败从失败步骤恢复；
- production 始终保留人工批准；
- 所有完成结论有 Evidence；
- 不提交、记录或暴露生产 Secret；
- 用户停止使用 Agent-Dev 后，项目仍可独立构建和部署。
