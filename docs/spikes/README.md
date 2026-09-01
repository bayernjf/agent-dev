# Phase 0 技术 Spike 状态

> 更新时间：2026-09-01
> 原则：未取得真实平台 Evidence 的项目不能标记通过。

| Spike | 当前状态 | 已取得证据 | 下一动作 |
| --- | --- | --- | --- |
| [Codex Runtime](codex-runtime.md) | 真实功能任务已通过 | 当前用户配置下真实功能任务在隔离 workspace 中退出码为 0，产生 `apps/web/src/main.tsx` 的 Git diff，Quality Gate 通过，状态停在 `VERIFYING`；未执行人工验收 | 失败工作区恢复、Codex resume/cancel 和可控的真实功能重跑 |
| [Workflow Resume](workflow-resume.md) | 已通过 | XState 5.32.5 快照跨四个独立进程恢复，SQLite 历史连续 | Phase A 改用 Drizzle/正式驱动并补 lease、幂等和 crash 测试 |
| [Secret Boundary](secret-boundary.md) | 已通过（macOS） | 临时 Keychain、引用存储、Provider 单次注入、Agent allowlist、日志脱敏均实测 | 提取共享库，补 Windows/Linux Adapter |
| [Dual Preview](dual-preview.md) | 正式 Composer 真实端到端已通过 | 2026-08-14 正式 `packages/deployment-composer` 在真实云端跑通 7/7 步：`pagesUrlSource: cli-output`，`apiHealth` / `exactCors` / `pageContainsApiUrl` / `jointSmoke` 全部 passed，并在编排之外独立复验（两个 Pages URL 均 200 且 HTML 含正确 API 域名，API 对别名 Origin 回精确 CORS 头）。免 token 路径也在真实项目确认 `ssoProtection`/`passwordProtection` 为 `null`。这一轮修掉 5 个"单元测试全绿但真实链路必然失败"的缺陷：Vercel 默认导出丢弃 `Response`、API 模板缺 CORS 中间件、前端从不消费 `VITE_API_BASE_URL`、`WRANGLER_LOG: 'none'` 同时破坏幂等判断与 Pages URL 解析、联合 Smoke 拿哈希域名而非分支别名校验 CORS | 在真实云端验证 PR 关闭清理；清理本轮遗留的 `workspace-verify-fresh-*` 两个真实项目 |
| [Supabase Auth](supabase-auth.md) | 已确认降级 | CLI 写入项目边界外状态，已确认采用 Manual 降级路径（路径 C）；RealProviderRegistry 已实现自动降级 | 后续实现 Management API 自动基础设施 + 人工敏感配置审批的分阶段方案 |

上表仍是 Phase 0 的**五个**架构级 Spike，计数不变。v0.2 开发中新增的探测入口单独列在「后续版本探测」。

## 当前本机前置状态

```text
Codex CLI      installed, read-only, fixture workspace-write, and diff-producing feature execution verified
GitHub CLI     installed
Vercel CLI     installed and authenticated
Wrangler       project-local 4.120.0 installed and OAuth authenticated
Supabase CLI   not installed
Infisical CLI  not installed（API 路径不依赖它）
```

> 注：`wrangler` 已授权、`vercel` 已登录。2026-08-09 记录的「当前网络无法访问新建 Vercel Deployment Domain」阻塞已于 2026-08-14 解除（走本机代理 + `NODE_USE_ENV_PROXY=1`），正式 Composer 已在真实云端 7/7 步跑通（见上表）。

可重复检查：

```bash
node spikes/platform-preflight/probe.mjs
node spikes/platform-preflight/probe.mjs --online
node spikes/infisical-backend/probe.mjs
node spikes/infisical-backend/probe.mjs --online
```

在线检查不输出用户名、组织、项目列表或 Token。真实部署实验属于外部写操作，必须先展示 Plan，并由用户批准专用测试资源。

## 后续版本探测（非 Phase 0 Spike）

### [Infisical Secret Backend](../../spikes/infisical-backend/README.md)

对应 v0.2 计划 P1-2，状态：**代码完成，真实云端验证待办（不标记通过）**。

- **已完成**：适配器按官方 OpenAPI 实现 v4 端点（2026-09-01 确认请求形状）；凭证系统后端化集成；19 例适配器单测（mock runner + stub fetch）+ 5 例凭证后端路由测试（含「禁止静默回退」磁盘哨兵证据）+ 1 例 daemon 契约测试 + 4 例 Studio 后端状态渲染测试，全仓 249 例全绿（2026-09-01 补上 Studio dev proxy 回归 5 例后为 254 例）。
- **本机探测**：离线部分已跑（`cliInstalled: false`、未配置项目）。
- **未取得**：任何真实 Infisical Evidence。CLI 路径的 `secrets` 子命令 JSON 输出形状与 `whoami` 均按文档实现、未实测；API 端点未对真实项目发过请求。
- **下一动作**：配 scratch 项目后跑 `node spikes/infisical-backend/probe.mjs --online`，回环 `complete: true` 才升级为已验证，并同步 `docs/implementation-plan-v0.2.md` 与 `docs/credential-management.md` §3.5。

## 进入 Phase A 的 Gate

首版有两种可接受路径：

1. 五个 Spike 全部取得真实成功证据；
2. 用户明确批准阻塞 Spike 的降级，并把限制写入 v0.1 验收范围。

不得以“脚本已写”替代真实云端验证，也不得为了完成 Spike 要求用户把 Secret 粘贴到聊天或仓库。
