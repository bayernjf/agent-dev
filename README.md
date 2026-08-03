# Agent-Dev

Agent-Dev 是面向 AI 产品创作者的自主产品交付平台。它不替代 Codex、Claude Code 等 coding agent，而是在其上层管理产品规范、权限、交付状态、云平台连接、人工审批和验收证据。

核心承诺：让用户专注于产品为何存在，让 Agent 负责产品如何可靠地存在。

## 第一版定位

`v0.1` 面向已经使用 GitHub 和 Codex 的独立开发者，提供一条固定的 Web SaaS Golden Path：

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

### 规划与依据

- [市场与竞争分析](docs/market-analysis.md)：相邻产品、竞争压力、差异化与商业判断。
- [参考项目能力矩阵](docs/reference-project-blueprint-matrix.md)：六个真实项目到 Blueprint、Adapter 和验收用例的映射。
- [产品路线图](docs/roadmap.md)：从内部闭环到托管运行时、模板生态和企业能力。
- [AI Agent 全周期开发 SOP](ai-agent-development-sop.md)：需求到生产交付的通用治理基线。
- [现有项目组合复盘](portfolio-development-review.md)：六个已有项目的流程资产、缺口和证据。

### 当前实施

- [Phase 0 技术 Spike 状态](docs/spikes/README.md)：本机实测证据、阻塞项和进入工程阶段的 Gate。
- [项目交接](handoff.md)：当前分支、硬约束、已完成工作和下一步。

## 当前状态

当前仓库处于 `v0.1` 的本地实验阶段，不是可用于生产的稳定版本。

本地可运行能力：

- 创建 Web SaaS 项目并保存结构化 Product Blueprint；
- 新手模式使用推荐答案，专业模式可配置数据敏感度、Preview、埋点和受控自定义说明；
- 每次修改生成新的 Blueprint Revision，不覆盖历史；
- 显示哪些决策会自动处理、必须获得批准，或只能由用户手动完成；
- 为任一 Blueprint Revision 生成 Product Standard、Agent 约束、交付流程、环境变量 Contract 和交接文档预览；
- 显示无外部写入的 Dry Run，以及每个 Provider 的最小人工操作和验证条件；
- 运行本机 Connector Preflight，区分命令可用性与尚未进行的账号授权；
- 通过本地 SQLite 保存项目、交付状态和 Blueprint 历史。

尚未实现：将生成物写入目标产品仓库、Provider 资源创建、Secret 连接、模板代码生成、Codex 执行、PR/Preview 编排与交付报告。它们仍受下方 Phase 0 技术验证结论约束。

已经取得本地 Evidence：

- XState + SQLite 跨进程恢复人工 Gate 和失败步骤；
- macOS Keychain、Secret 引用、Agent 环境白名单和日志脱敏；
- GitHub、Vercel、Cloudflare 本地 CLI 的结构化 Preflight；
- Dual Preview 的本地 API、精确 CORS 和 URL 注入契约。

当前阻塞：

- 本机 Codex 认证无效，Runtime 成功路径尚未验证；
- Vercel Preview 公网访问超时，Cloudflare/Vercel 联合 Preview 尚未通过；
- Supabase CLI 的本地状态目录与当前文件边界冲突，Auth Redirect 尚未进行真实平台验证。

事实、降级候选和下一项 Gate 见 [Phase 0 技术 Spike 状态](docs/spikes/README.md)。文档中的 `v0.1` 是计划目标，不代表对应连接器和交付能力已经实现。

## License

当前仓库尚未选择开源许可证。公开可读不等于自动获得复制、分发或商用授权；许可证将在产品边界稳定后由维护者明确选择。
