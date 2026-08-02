# Agent-Dev v0.1 产品需求文档

> 版本：0.1 Draft  
> 日期：2026-08-02  
> 工作名称：Local Web SaaS Golden Path

## 1. 背景

AI coding agent 已能高效落地代码，但从想法到真实用户可访问的产品仍包含大量重复工作：技术选型、仓库治理、数据库和认证、环境变量、CI、双环境部署、Preview/生产验收、失败返工与交接维护。

Agent-Dev v0.1 通过一条固定 Web SaaS Golden Path 验证：这些工作能否被结构化规范和 Agent 自动化显著压缩。

## 2. 目标用户

首版用户是已经使用 GitHub 和 Codex 的独立开发者或一人产品团队。他们能够判断产品体验，但不希望持续承担平台工程工作。

首版不以完全没有 GitHub、终端和云平台经验的新手为目标；新手模式属于产品架构要求，但不是 v0.1 的交付范围。

## 3. 核心承诺

用户完成不超过 5 个必要人工操作，在 60 分钟内获得一个归自己所有、具备数据库、认证、CI、联合 Preview、环境变量契约和交付规范的 Web 产品基线。

在该基线上，用户能够输入一个真实功能需求，并完成：

```text
需求 -> 决策澄清 -> 规格与验收标准 -> Codex 实现
-> 本地验证 -> PR -> Vercel API Preview
-> Cloudflare Pages Preview -> 联合冒烟测试
-> 人工验收 -> 交付报告
```

## 4. 第一版 Golden Path

| 能力 | 固定选择 |
| --- | --- |
| 前端 | React + Vite + TypeScript |
| API | Hono |
| 数据库、认证 | Supabase |
| 页面托管 | Cloudflare Pages |
| API 托管 | Vercel Functions |
| 代码与 CI | GitHub + GitHub Actions |
| Agent Runtime | 用户电脑中的 Codex |
| 包管理 | npm workspaces |

Cloudflare 和 Vercel 不是候选关系。首版规范固定为 Cloudflare Pages 托管前端、Vercel 托管 API。

## 5. 核心用户流程

### 5.1 初始化产品

1. 用户启动本地 Agent-Dev。
2. 系统检测 Git、Node、npm、GitHub 和 Codex Runtime。
3. 用户选择 Web SaaS 模板并回答产品、认证、数据、隐私和发布问题。
4. 系统生成 Blueprint、环境变量契约和 Dry Run。
5. 用户授权 GitHub、Supabase、Cloudflare 和 Vercel。
6. 系统创建代码骨架、仓库、CI、Supabase 项目和两个部署项目。
7. 系统按 API 在前、页面在后的顺序完成部署与联合验证。
8. 系统生成产品基线交付报告。

### 5.2 交付一个功能

1. 用户用自然语言描述目标、范围和体验。
2. Agent-Dev 只对真实不确定决策提问，并给出候选与推荐。
3. 规格确认后，系统创建隔离 Git worktree 和 feature 分支。
4. Codex 实现功能并执行质量契约。
5. 系统创建 PR，部署 Vercel API Preview，再构建并部署 Cloudflare Pages Preview。
6. 系统同步 CORS、Supabase Auth Redirect URL 和环境变量。
7. 联合冒烟测试成功后进入人工 Preview 验收。
8. 验收结论和所有证据写入交付报告。

## 6. 功能需求

| 编号 | 功能 | v0.1 验收标准 |
| --- | --- | --- |
| F01 | Blueprint 问卷 | 生成可验证、可版本化的 `agent-dev.yaml` |
| F02 | 规范生成 | 生成 Product Standard、Agent 指令和 Delivery Workflow Markdown |
| F03 | 环境检查 | 检测依赖、版本、登录状态并给出最小修复步骤 |
| F04 | Dry Run | 外部写操作前显示资源、权限、费用和影响 |
| F05 | 项目脚手架 | 创建固定技术栈、测试、CI 和环境契约 |
| F06 | Provider 连接 | 接入 GitHub、Supabase、Cloudflare Pages 和 Vercel |
| F07 | 联合部署 | API 先部署，前端获得 API URL 后部署，两个环境均可访问 |
| F08 | Agent 执行 | Codex 在隔离 worktree 中完成已批准任务 |
| F09 | 质量门禁 | lint、typecheck、unit、build 与必要冒烟测试可追溯 |
| F10 | PR 与 Preview | PR 中展示页面/API URL、Checks 和联合测试结果 |
| F11 | 人工 Gate | 账号、费用、隐私、Preview 和生产操作可暂停/恢复 |
| F12 | 失败恢复 | 从失败步骤继续；自动修复最多两次 |
| F13 | 交付报告 | 验收标准逐项映射真实证据、风险和未验证项 |

## 7. 核心页面

- 项目概览：产品状态、环境、仓库、Preview、风险和待办；
- Blueprint Studio：模块化问题、默认答案、影响和生成结果；
- 执行计划：资源 Diff、权限、费用、人工 Gate 和 Apply；
- Delivery Run：时间线、日志、状态、失败原因和恢复入口；
- Environment Matrix：变量分类、来源、环境、目标和同步状态；
- Manual Actions：深链、最小步骤和自动验证；
- Delivery Report：需求、验收、PR、测试、部署和残余风险。

## 8. 自动与询问

### 自动执行

- 生成规范、代码骨架、测试和 CI；
- 创建 feature 分支和 worktree；
- 调用 Codex 实现已批准范围；
- 运行本地检查、创建或更新 PR；
- 部署 Preview、读取 Checks、执行冒烟测试；
- 对明确的低风险失败进行最多两次修复；
- 生成交付报告。

### 必须询问

- 产品需求存在多种合理解释；
- 新增付费资源或改变费用等级；
- 权限、Secret、隐私、埋点和用户数据策略；
- 数据迁移、删除和架构替换；
- 自定义域名或 DNS 变更；
- 合并受保护分支、生产发布和回滚。

## 9. 非功能要求

- Local-first：源代码和 Agent 登录凭据默认留在本机；
- 幂等：重复执行不得无意创建重复云资源；
- 可恢复：每一步持久化，失败后从失败步骤继续；
- 最小权限：每个 Provider 只申请当前能力所需权限；
- 可审计：记录计划、批准人、外部请求标识、结果和证据；
- Secret 安全：不写入日志、Markdown、Agent 上下文或前端构建；
- 可退出：用户不使用 Agent-Dev 后，项目仍能独立构建和部署；
- 真实性：未执行的验证不得标记为通过。

## 10. 非目标

- 完全托管的模型和云端 Sandbox；
- 多 Agent 并行调度；
- Claude Code、TRAE 和自定义 Runtime；
- 浏览器扩展、桌面端和移动端 Blueprint；
- 任意数据库和任意部署供应商；
- 模块市场、团队 RBAC、计费和企业合规；
- 自动生产合并和无限自动修复；
- Cloudflare/Vercel 双活或流量调度。

## 11. 成功指标

| 指标 | v0.1 目标 |
| --- | --- |
| 产品基线完成时间 | 中位数不超过 60 分钟 |
| 必要人工操作 | 不超过 5 个主要步骤，不含体验验收 |
| 可预防配置返工 | 相比现有流程减少 70% |
| 交付证据完整率 | 100% 的完成状态可追溯 |
| 自动修复边界 | 最多两次，超出后可靠暂停 |
| 内部验证 | 连续 3 个真实项目完成基线和至少 1 个功能交付 |

## 12. 发布条件

以下条件全部满足才可称为 v0.1：

- 三个真实项目完成相同 Golden Path；
- Cloudflare Pages 与 Vercel API Preview 均可访问；
- CORS、Supabase Auth 回调和环境变量通过自动验证；
- 至少一次 CI 或部署失败能从失败步骤恢复；
- 人工 Preview Gate 和交付报告完整工作；
- 不存在明文 Secret 泄漏或绕过 GitHub 门禁的路径。
