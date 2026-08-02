# 参考项目到 Agent-Dev 能力矩阵

> 日期：2026-08-02
> 范围：只读复盘 `bayjf`、`word-picker`、`word-base`、`soft-desk`、`pr-helper`、`tab-manager`。
> 目的：把真实项目经验转化为 Agent-Dev 的 Blueprint、Adapter、Policy 和验收用例，而不是复制项目源码。

## 1. 结论

六个项目共同证明：可以统一的是产品治理、Agent 边界、Git、质量、交付状态和证据；不能强行统一的是各产品类型的构建、预览、签名、打包和分发方式。

Agent-Dev 的父框架因此应为：

```text
Governance Core
+ Product Blueprint
+ Quality Contract
+ Delivery State Machine
+ Agent Runtime Adapter
+ Provider/Platform Adapter
+ Evidence Contract
```

而不是承载 Web、扩展、桌面和移动端源码的万能模板。

## 2. 项目能力总览

| 项目 | 产品类型 | 当前可复用事实 | Agent-Dev 沉淀目标 | 首版作用 |
| --- | --- | --- | --- | --- |
| `bayjf` | React/Vite Web + Hono API | Cloudflare Pages 页面、Vercel API、Supabase、双阶段 PR、双环境部署 | `web-saas` Blueprint、Dual Deployment Composer、Env Contract | v0.1 主要 Golden Path 原型 |
| `pr-helper` | GitHub App 控制台 | PR/check/deployment 状态、阶段决策、GitHub App Auth、reconciliation | GitHub Adapter、Stage Decision、Evidence、Sync Health | v0.1 控制面参考 |
| `tab-manager` | 浏览器扩展 | 强制 PR 流程、Spec Kit、滚动预览 Release、交接证据 | Spec/Policy 模块、Extension Release Contract、规则冲突检测 | v0.1 治理验证，后续扩展 Blueprint |
| `word-picker` | 多浏览器扩展 | Chrome/Edge/Safari 构建、Vitest/Playwright、打包、商店人工步骤 | Cross-browser Build Adapter、Store Manual Action | 后续扩展 Blueprint |
| `soft-desk` | Electron 桌面应用 | macOS/Windows CI、dmg/zip/exe、安装包 Artifact | Desktop Matrix、Signing/Installer Gate | 后续桌面 Blueprint |
| `word-base` | Web/Tauri/Expo/API 多端 | npm workspaces、多端质量与发布、OTA、rollback | Multi-target Blueprint、Release Matrix、Rollback Evidence | 长期多端能力边界 |

## 3. `bayjf`：首版 Web Golden Path 原型

### 已确认事实

- React/Vite 前端托管于 Cloudflare Pages；
- Hono API 托管于 Vercel；
- 数据与认证使用 Supabase；
- 浏览器公开变量、Vercel API Secret 和部署凭据已有明确分类；
- `feature -> dev -> main` 使用真实 PR；
- dev 需要等待 CI、Vercel Preview、Cloudflare Preview；
- main 需要等待 CI、Vercel Production、Cloudflare Production；
- 现有 deploy workflows 由 dev/main push 触发，不能天然证明 CI 成功后才部署；
- 现有流程以分支稳定环境为主，不等于 Agent-Dev 计划的每 PR 联合 Preview。

### 转化为 Agent-Dev 能力

| 现有事实 | Blueprint/Adapter | 需要增强 |
| --- | --- | --- |
| 页面/API 分离部署 | `deployment.web` + `deployment.api` | 从 Provider 选择升级为角色组合 |
| Vercel API URL 与 Pages 页面 | Deployment Composer | API URL 输出传递、精确 CORS、联合 Smoke |
| 浏览器/服务端/部署变量分类 | Env Contract | 来源、目标、版本和漂移检测 |
| feature/dev/main 流程 | Git Workflow Module | 临时 PR Preview、Ruleset 和 Approval 证据 |
| 双平台 Preview/Production | Evidence Contract | 两个平台都成功才可进入下一状态 |

### v0.1 验收用例

1. 从项目结构识别 Cloudflare Pages、Vercel API 和 Supabase；
2. 生成等价 Blueprint，但不读取或复制 Secret；
3. 发现 CI 与 deploy workflow 并发触发风险；
4. 部署 API Preview，获得 URL 后再构建 Pages Preview；
5. 页面调用 API，通过 CORS、Auth Redirect 和 Smoke；
6. 任一平台失败时 Delivery Run 不得显示完成。

## 4. `pr-helper`：控制面与 GitHub 状态原型

### 已确认事实

CodeGraph 当前源码显示：

- `src/lib/domain.ts` 定义 `PullState`、`CheckState` 和阶段动作；
- `summarizeGitHubChecks` 合并 Checks API 与 legacy commit status；
- `canMergeOpenPull` 同时要求 Checks、Approval、mergeable 和 clean state；
- `canCreateWorkflowStage` 支持依赖阶段和独立阶段；
- `api/_lib/github-app.ts` 实现 GitHub App 配置、JWT、签名 OAuth state 和 session；
- `api/_lib/workflows-store.ts` 定义 reconciliation trigger/run、sync health、stale threshold 和 recovery policy；
- reconciliation 可以由 cron、webhook、刷新或人工触发，并区分 success/degraded/failure。

### 转化为 Agent-Dev 能力

| `pr-helper` 概念 | Agent-Dev 目标 |
| --- | --- |
| `summarizeGitHubChecks` | GitHub Evidence Normalizer |
| `canMergeOpenPull` | Merge Readiness Policy，不直接执行合并 |
| `canCreateWorkflowStage` | Delivery State Machine 前置条件 |
| GitHub App JWT/session | Hosted Control Plane GitHub Adapter 参考 |
| ReconciliationRun | Provider 状态重读和漂移恢复 |
| SyncHealth/stale threshold | Evidence Freshness 与 UI 健康状态 |
| Recovery Policy | 有限重试、冷却和人工 Gate |

首版优先提炼契约和测试用例，不直接复制 `pr-helper` 实现；它的 Vercel API、Supabase Store 和浏览器会话假设与 Local-first v0.1 不完全相同。

### v0.1 验收用例

1. Checks 与 commit status 能被归一化为 pending/success/failure；
2. Checks 成功但缺少 Approval 时状态为 waiting，不可合并；
3. Webhook 丢失后，manual reconciliation 能恢复真实状态；
4. Evidence 超过阈值后标记 stale，不用于交付判断；
5. 部分阶段同步失败时运行是 degraded，不伪装成 success。

## 5. `tab-manager`：Spec、PR 治理与规则冲突样本

### 已确认事实

- `PULL_REQUEST_WORKFLOW.md` 明确禁止用本地合并代替真实 GitHub PR；
- feature、dev、main 每一关均要求 Checks 和合并后 Actions 成功；
- dev 使用滚动 `dev-preview` Release，main 自动创建正式版本；
- handoff 包含 PR、commit、测试数量、手工验证和已知限制；
- `.agents/.claude` 中已有 Spec Kit skills；
- `AGENTS.md` 的“提交代码并合并到 dev”仍描述本地合并授权，与最高优先级 PR 流程存在冲突；
- CodeGraph 调用当前无法打开索引数据库，因此本次回退到仓库文档和 workflow 证据。

### 转化为 Agent-Dev 能力

- `Spec Workflow Module`：constitution/spec/plan/tasks/implement；
- `Policy Conflict Detector`：检测同仓库指令互相冲突；
- `Rolling Preview Release`：适合无在线 Preview 的可下载产品；
- `Delivery Report`：自动测试与人工浏览器验证分别记录；
- `Git Ancestry Audit`：避免无文件差异的反向同步 PR。

### 验收用例

1. 发现 `AGENTS.md` 与 PR workflow 的授权冲突并阻止自动合并；
2. 识别滚动 preview tag 与正式 semver tag 的不同生命周期；
3. 生成扩展安装/手工验证步骤，而不是伪造在线 Preview；
4. 交付报告保留测试数量、跳过项和权限边界。

## 6. `word-picker`：跨浏览器扩展构建与商店 Gate

### 已确认事实

- Chrome/Edge 共用 Manifest 变体，Safari 有独立 Manifest 和 background 适配；
- 自定义构建脚本负责编译、复制、环境变量和版本注入；
- Vitest 覆盖单元/集成，Playwright 验证 Chrome 构建；
- dev 产生可覆盖安装的 snapshot，main/tag 产生正式 Release；
- Chrome Web Store 首次 listing、Safari Archive/Upload 等仍是人工步骤。

### 转化为 Agent-Dev 能力

- `browser-extension` Blueprint；
- Platform Variant 和 Manifest Merge Contract；
- Artifact Matrix：Chrome/Edge zip、Safari artifact；
- Store Account、Listing、Review 和签名 Manual Actions；
- Snapshot 与 Production Release Channel；
- Extension-specific Quality Contract。

### 验收用例

1. 同一源码生成多个平台 Artifact，版本和环境配置一致；
2. 缺少商店账号时输出最小人工步骤，不标记生产交付；
3. Release 报告分别记录 Chrome/Edge/Safari 的验证状态；
4. 公开构建变量与真实 API Secret 不混入扩展包。

## 7. `soft-desk`：桌面构建、安装包与签名

### 已确认事实

- Electron/Vite/TypeScript；
- CI 在 macOS 与 Windows runner 上执行质量和构建；
- macOS 产出 dmg/zip，Windows 产出 exe/blockmap/update metadata；
- 安装包作为 Artifact，签名、证书和不同平台行为属于发布风险；
- workflow 和安装包验证不能用 Web 健康检查替代。

### 转化为 Agent-Dev 能力

- `desktop-electron` Blueprint；
- OS Build Matrix 和 required checks；
- Code Signing/Notarization Secret Contract；
- Installer Artifact Evidence；
- macOS/Windows 人工安装和升级验证 Gate；
- 发布渠道、自动更新元数据和回滚策略。

### 验收用例

1. 只有 macOS/Windows 两端 required checks 都成功才可发布；
2. 未签名产物可以是 Preview Artifact，不得标记正式可分发；
3. 报告记录安装、启动、升级和卸载人工结果；
4. 证书和签名 Secret 永不进入 Coding Agent 上下文。

## 8. `word-base`：多端产品和发布矩阵

### 已确认事实

- npm workspaces 组织 Web、Tauri 桌面、Expo 移动和 API；
- 不同 workspace 有独立 build/test/release；
- Web deploy、桌面 release、移动 OTA 和 rollback 不是同一种交付动作；
- 版本注入、跨端共享代码和环境差异需要统一追踪；
- 多端项目的“完成”必须按目标平台声明，不能要求每次功能无条件全平台发布。

### 转化为 Agent-Dev 能力

- `multi-target-product` Blueprint；
- Target Dependency Graph 与 affected targets；
- Workspace Quality Contract；
- Release Matrix：Web、Desktop、Mobile、API；
- OTA 与 Store Release 的不同 Approval；
- Rollback Evidence 和版本对应关系。

### 验收用例

1. 只修改共享包时计算受影响目标并运行对应矩阵；
2. Web 成功不能掩盖 Desktop/Mobile 目标失败；
3. 功能明确不涉及某目标时记录 not-applicable，而不是 skipped success；
4. 能从产品版本追溯到各平台 Artifact、Deployment 和 rollback 位置。

## 9. 跨项目共同模块

| 模块 | 六项目共同证据 | v0.1 优先级 |
| --- | --- | --- |
| Product Intent | 都需要项目说明、范围和交接 | P0 |
| Agent Policy | 都有 `AGENTS.md`，内容存在差异或冲突 | P0 |
| Git Workflow | feature/dev/main、PR、修复和同步 | P0 |
| Quality Contract | 都有 CI，但命令与含义不同 | P0 |
| Environment Contract | Web、API、扩展构建均有变量分类 | P0 |
| Delivery State | PR、Checks、Preview/Artifact、Production | P0 |
| Evidence | handoff、测试、URL、Artifact、Release | P0 |
| Manual Action | 商店、签名、生产、权限、域名 | P0 |
| Platform Adapter | Web/Extension/Desktop/Mobile 构建发布差异 | v0.1 只做 Web |
| Maintenance | rollback、依赖、同步健康、已知限制 | P1 |

## 10. v0.1 参考优先级

```text
bayjf
  -> Web SaaS 模板、Cloudflare/Vercel/Supabase、双环境交付

pr-helper
  -> GitHub 状态、Stage Decision、reconciliation、Evidence freshness

tab-manager
  -> Spec/PR Policy、规则冲突、交付报告

word-picker / soft-desk / word-base
  -> 约束父框架边界，暂不实现对应 Blueprint
```

首版不得因为未来产品类型而引入过度抽象。只有 `bayjf`、`pr-helper`、`tab-manager` 中能被 v0.1 真实使用和测试的契约进入首版实现；其他能力保留为验收场景和后续 Blueprint 需求。

## 11. 证据入口

- `../bayjf/AGENTS.md`、`PULL_REQUEST_WORKFLOW.md`、`.github/workflows/`；
- `../pr-helper/src/lib/domain.ts`、`api/_lib/github-app.ts`、`api/_lib/workflows-store.ts`；
- `../tab-manager/AGENTS.md`、`PULL_REQUEST_WORKFLOW.md`、`handoff.md`、`.github/workflows/`；
- `../word-picker/AGENTS.md`、`handoff.md`、`.github/workflows/`；
- `../soft-desk/AGENTS.md`、`docs/handoff.md`、`.github/workflows/`；
- `../word-base/AGENTS.md`、`handoff.md`、`.github/workflows/`；
- [现有项目组合开发流程复盘](../portfolio-development-review.md)。

这些路径仅作为本地只读证据。Agent-Dev 不依赖同级目录结构运行，正式模板和测试 fixture 必须在当前仓库中独立创建。
