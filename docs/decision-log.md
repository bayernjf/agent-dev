# Agent-Dev 对话决策记录

> 日期：2026-08-02（验证与决策状态更新至 2026-08-23）  
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

## 3. 验证状态

已验证（证据见 [Phase 0 技术 Spike](spikes/README.md)）：

- Codex 非交互运行方式与结构化输出：已在本机 `codex-cli 0.142.3` 实测通过，并完成一次真实功能任务写入；
- Cloudflare Pages Preview 与 Vercel API Preview 的 URL 编排：已通过真实云端验证，实现为 `packages/deployment-composer`；
- 动态 CORS 与 PR 关闭后的资源清理：已实现精确 CORS origin 与签名验证的清理 Webhook（CORS 已在真实云端验证，清理链路尚未真实验证）；
- Provider OAuth、官方 CLI 和受限 Token 的首版组合：已确认为官方 CLI Adapter + Manual 降级 + 系统 Keychain 引用；
- 本地 Runner 从暂停 Gate 或失败 Step 恢复：Workflow Resume 已通过真实本地 Probe；
- Deployment Composer 真实云端端到端：2026-08-14 正式代码跑通 7/7 步，Evidence 四项检查全部 passed，并在编排之外独立复验。过程修掉 5 个"单元测试全绿但真实链路必然失败"的缺陷（详见 [Dual Preview](spikes/dual-preview.md)），印证了"没有真实 Evidence 不算完成"这条原则的必要性。

- 失败 workspace 恢复：已实现为"新建干净 workspace、旧的保留待查"，并已在一个真实被 Codex 破坏的 workspace 上完成整条交付（`Receipt Test` 跑在 `revision-5-recovery-1` 上）；
- 生产发布的人工闸门：请求与具名批准由状态机和 Schema 强制，未批准的发布不会写下任何日志行（有测试覆盖）；
- **真实云端的生产发布与一次完整周期**：2026-08-23 `Receipt Test` 从 Blueprint 走到 `DELIVERED`，全程真实 Provider。PR #1（`feature/agent-dev/revision-5 → dev`）经 GitHub Actions `quality` 通过后合并，生产 API `https://receipt-test-api.vercel.app`、页面 `https://receipt-test-web.pages.dev`，批准人 `feng`。已在平台报告之外独立复验：API 返回 `200 application/json`，对合法 Origin 回精确 CORS 头、对 `https://evil.example.com` 一个 CORS 头都不返回；线上 JS bundle 含本次功能的中文串，证明上线的是功能而非脚手架。这一轮暴露并修掉 6 个"单元测试全绿但真实链路必然失败"的缺陷（最严重的两个：Agent 写的代码从未被提交，所以人工验收的功能根本不会上线；`git add -A` 会把带真实凭据的 `.env` 提交进产品仓库），细节见 [交接报告](../handoff.md) 最近进度首条。

- **生产改为从生产分支发布**：2026-08-23 修复。`ReleaseComposer` 现在 clone/fetch/reset 记录仓库的生产分支，校验人工验收的 commit 是该分支 HEAD 的祖先，再在该 checkout 上跑质量门禁、构建与部署，Evidence 记下 `repository/branch/commit/acceptedCommit`，因此线上版本可从生产分支复现；未记录仓库或未验收会以"发布被阻塞"的原因返回，而不是静默发布 workspace。目前有测试覆盖，尚未在真实云端跑过一遍；
- **每个人工闸门都要求具名**：2026-08-23 修复。基线、Feature Task 与交付验收不再回落到 `local-user`，approver 由 API 强制、由 Studio 在各闸门收集，与生产批准口径一致。

仍待验证 / 已知缺口：

- Codex 取消能力与真实会话 resume；
- PR 关闭后的临时项目清理在真实云端的链路（部署链路已验证，清理链路仍只有本地测试覆盖）；
- Supabase Auth Redirect URL 同步仍为手动步骤，未自动化；
- 本地 Runner 的安装与升级路径（崩溃恢复已由 Workflow Resume 覆盖）；
- 完整周期的三项目连续验证只完成 1/3，项目 2、3 尚未开始。

## 4. 产品决策状态

已确认（详见 [交接报告](../handoff.md) 第 9 节）：

| 决策 | 结论 | 影响 |
| --- | --- | --- |
| 生产前端域名 | `app.example.com`，保留 apex 选择 | DNS、Cookie、品牌入口。**当前实现未使用该域名**：Blueprint 没有生产域名字段，`ReleaseComposer` 因此把生产 Web origin 推导为 Cloudflare Pages 项目 apex（`https://<name>-web.pages.dev`），使 API 的 `ALLOWED_ORIGIN` 与被验证的 URL 必然相等。接入自定义域名需要先给 Blueprint 加字段 |
| dev 与 production Supabase | 独立项目 | 成本更高，但隔离和回滚更清晰 |
| v0.1 初始产品能力 | 登录、基础用户资料、健康检查 | 模板大小和验收范围 |

待确认：

| 决策 | 推荐默认 | 影响 |
| --- | --- | --- |
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

1. ✅ 完成五个技术 Spike（全部通过或已批准降级）；
2. ✅ 固定 `agent-dev.yaml` v1alpha1 Schema；
3. ✅ 定义首版 Web SaaS 模板包含的最小业务能力；
4. ✅ 确定 Provider 授权和 Supabase 环境隔离方案；
5. ✅ 创建工程骨架（`apps/` 三个应用 + `packages/` 八个包）；
6. ✅ 跑通第一个真实端到端 Delivery Run：2026-08-23 `Receipt Test` 从 Blueprint 到生产上线全部走真实 Provider（Preview 段已于 2026-08-14 通过，生产段于 2026-08-23 通过）；
7. ✅ 修掉项目 1 暴露的两处架构缺口：生产改为从生产分支发布、每个人工闸门都要求具名（2026-08-23）；
8. 完成剩余两个真实项目的完整周期验证（1/3，见 [交接报告](../handoff.md) 第 8 节第 7 项）；
9. 确认 Analytics 默认、Ruleset 自动化与 Blueprint 开源时机三项待决事项。
