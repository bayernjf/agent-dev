# Agent-Dev 对话决策记录

> 日期：2026-08-02  
> 用途：记录本轮产品讨论中已经确认的方向、假设和待决事项。它不是 PRD 或架构的替代品。

## 1. 已确认方向

### 产品目标

- Agent-Dev 是 AI 时代的产品开发与交付框架；
- 用户专注产品功能、体验和品味，框架负责工程基线、交付和维护；
- 完成定义是产品可被真实用户使用并有完整证据，不是代码或 PR 已生成；
- Agent-Dev 位于 Codex、Claude Code、TRAE 等执行 Agent 上层，不与其比较代码生成能力。

### 产品形态

- 产品长期采用 Web 控制面 + 本地/托管 Runner；
- 新手模式和专业模式共享同一个 Blueprint、Policy 和状态机；
- 新手使用产品模板和默认 SOP，专业用户可以覆盖、自定义和导入仓库；
- 规范通过可视化问卷形成，允许候选项和结构化自定义答案；
- Markdown 是规范输出，结构化 Blueprint 才是事实源。

### 第一版

- 首版面向已使用 GitHub 和 Codex 的独立开发者，不承担完全小白的零配置体验；
- 首版采用 Local-first Web App 和本地 Codex Runtime；
- 首版只有 Web SaaS Golden Path；
- React/Vite 前端部署到 Cloudflare Pages；
- Hono API 部署到 Vercel Functions；
- 数据库和认证使用 Supabase；
- Cloudflare 与 Vercel 必须同时使用，按页面/API 角色组合；
- Preview 必须先部署 API，再把 URL 注入前端并部署 Pages；
- production 始终人工批准；
- 自动修复最多两次。

### 权限与所有权

- 用户拥有代码、仓库、数据、域名、云资源和 Blueprint；
- 不读取或上传 Codex/Claude 登录 Token；
- Secret 默认保存在目标平台或系统 Keychain，Agent-Dev 保存引用；
- AI 提出方案，Policy 与外部平台控制权限；
- 所有外部写操作先 Dry Run，并可审计、验证和恢复。

### 项目边界

- 所有 Agent-Dev 新产物只写入当前 `agent-dev` 目录；
- `bayjf`、`word-picker`、`word-base`、`soft-desk`、`pr-helper`、`tab-manager` 仅作为只读参考，除非用户另行授权具体修改。

## 2. 已采用的核心表述

产品类别：

> Agentic Product Delivery Platform

产品理念：

> 让人专注于产品为何存在，让 Agent 负责产品如何可靠地存在。

首版承诺：

> 在不接管用户产品所有权的前提下，把一次真实 Web 产品交付从大量人工协调压缩成少数产品决策和最终验收。

## 3. 尚待验证

- Codex 官方非交互运行方式、结构化输出、取消和恢复能力；
- Cloudflare Pages Preview 与 Vercel API Preview 的稳定 URL 编排；
- 动态 CORS 与 Supabase Auth Redirect URL 的精确同步和清理；
- GitHub Rulesets 是否由 App 自动配置，还是首版生成 Manual Action；
- Supabase dev/production 是否使用独立项目；
- Provider OAuth、官方 CLI 和受限 Token 的首版组合；
- 本地 Runner 的安装、升级和崩溃恢复；
- v0.1 是否包含 GA4/Clarity 的代码接入，当前只确认其不阻塞核心交付。

## 4. 尚待产品决策

| 决策 | 推荐默认 | 影响 |
| --- | --- | --- |
| 生产前端域名 | `app.example.com`，保留 apex 选择 | DNS、Cookie、品牌入口 |
| dev 与 production Supabase | 独立项目 | 成本更高，但隔离和回滚更清晰 |
| v0.1 初始产品能力 | 登录、基础用户资料、健康检查 | 模板大小和验收范围 |
| Analytics 默认 | 默认关闭，明确同意后接入 | 隐私与新手步骤 |
| Ruleset 自动化 | 能力不足时生成验证过的 Manual Action | GitHub 套餐、权限和安全 |
| Blueprint 开源时机 | v0.1 验证后发布 | 接口稳定性与社区策略 |

## 5. 明确不在第一版

- 完全托管模型和远程 Sandbox；
- 完全小白的零安装体验；
- 多 Agent 并行；
- 任意技术栈、任意云平台；
- 浏览器扩展、桌面和移动端；
- 模块市场、团队 RBAC、计费和企业能力；
- Cloudflare/Vercel 双活流量；
- 数据库跨供应商自动迁移；
- 无人工审批的生产发布。

## 6. 下一步决策顺序

1. 完成五个技术 Spike；
2. 固定 `agent-dev.yaml` v1alpha1 Schema；
3. 定义首版 Web SaaS 模板包含的最小业务能力；
4. 确定 Provider 授权和 Supabase 环境隔离方案；
5. 再创建工程骨架和第一个端到端 Delivery Run。
