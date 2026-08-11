# Phase 0 技术 Spike 状态

> 更新时间：2026-08-09
> 原则：未取得真实平台 Evidence 的项目不能标记通过。

| Spike | 当前状态 | 已取得证据 | 下一动作 |
| --- | --- | --- | --- |
| [Codex Runtime](codex-runtime.md) | 真实功能任务已通过 | 当前用户配置下真实功能任务在隔离 workspace 中退出码为 0，产生 `apps/web/src/main.tsx` 的 Git diff，Quality Gate 通过，状态停在 `VERIFYING`；未执行人工验收 | 失败工作区恢复、Codex resume/cancel 和可控的真实功能重跑 |
| [Workflow Resume](workflow-resume.md) | 已通过 | XState 5.32.5 快照跨四个独立进程恢复，SQLite 历史连续 | Phase A 改用 Drizzle/正式驱动并补 lease、幂等和 crash 测试 |
| [Secret Boundary](secret-boundary.md) | 已通过（macOS） | 临时 Keychain、引用存储、Provider 单次注入、Agent allowlist、日志脱敏均实测 | 提取共享库，补 Windows/Linux Adapter |
| [Dual Preview](dual-preview.md) | 历史 Spike 通过 / 当前 Composer 重跑受网络阻塞 | 历史 Evidence 覆盖 Vercel API、Cloudflare Pages、跨域通信和 API URL 注入；部署编排已实现为 `packages/deployment-composer`（含 Vercel SSO Protection 关闭、精确 CORS、临时项目清理和签名验证的 PR 关闭 Webhook）。2026-08-09 的三次重跑均在 Vercel Deployment Domain 公网访问阶段超时，临时项目已清理 | 在可访问新建 `*.vercel.app` Deployment Domain 的网络重新跑 Composer 和 PR 关闭清理 |
| [Supabase Auth](supabase-auth.md) | 已确认降级 | CLI 写入项目边界外状态，已确认采用 Manual 降级路径（路径 C）；RealProviderRegistry 已实现自动降级 | 后续实现 Management API 自动基础设施 + 人工敏感配置审批的分阶段方案 |

## 当前本机前置状态

```text
Codex CLI      installed, read-only, fixture workspace-write, and diff-producing feature execution verified
GitHub CLI     installed
Vercel CLI     installed and authenticated
Wrangler       project-local 4.120.0 installed and OAuth authenticated
Supabase CLI   not installed
```

> 注：2026-08-09 已补齐并授权本机 `wrangler`，且确认 `vercel` 已登录。端到端 Composer 目前受当前网络无法访问新建 Vercel Deployment Domain 阻塞，不是 CLI 安装或认证问题。

可重复检查：

```bash
node spikes/platform-preflight/probe.mjs
node spikes/platform-preflight/probe.mjs --online
```

在线检查不输出用户名、组织、项目列表或 Token。真实部署实验属于外部写操作，必须先展示 Plan，并由用户批准专用测试资源。

## 进入 Phase A 的 Gate

首版有两种可接受路径：

1. 五个 Spike 全部取得真实成功证据；
2. 用户明确批准阻塞 Spike 的降级，并把限制写入 v0.1 验收范围。

不得以“脚本已写”替代真实云端验证，也不得为了完成 Spike 要求用户把 Secret 粘贴到聊天或仓库。
