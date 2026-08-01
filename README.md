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
- [产品路线图](docs/roadmap.md)：从内部闭环到托管运行时、模板生态和企业能力。
- [AI Agent 全周期开发 SOP](ai-agent-development-sop.md)：需求到生产交付的通用治理基线。
- [现有项目组合复盘](portfolio-development-review.md)：六个已有项目的流程资产、缺口和证据。
- [项目交接](handoff.md)：当前完成状态、硬约束、未决事项和下一步执行顺序。

## 当前状态

当前仓库处于产品定义阶段。本文档中的 `v0.1` 是计划中的第一版，不代表相关代码、平台连接器或部署能力已经实现。

下一项工程工作应是验证本地 Codex Runtime 的官方非交互接入方式，并完成 Blueprint、状态机和 Cloudflare/Vercel 联合 Preview 的三个技术 Spike。
