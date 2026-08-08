# Phase 0 技术 Spike 状态

> 更新时间：2026-08-09
> 原则：未取得真实平台 Evidence 的项目不能标记通过。

| Spike | 当前状态 | 已取得证据 | 下一动作 |
| --- | --- | --- | --- |
| [Codex Runtime](codex-runtime.md) | Probe 通过/真实任务超时 | 当前用户配置下只读和临时 fixture workspace-write、JSONL、最终 Schema 与确定性写入验证已通过；真实功能任务已启动但在 180 秒上限内超时 | 失败工作区恢复、Codex resume/cancel 和可控的真实功能重跑 |
| [Workflow Resume](workflow-resume.md) | 已通过 | XState 5.32.5 快照跨四个独立进程恢复，SQLite 历史连续 | Phase A 改用 Drizzle/正式驱动并补 lease、幂等和 crash 测试 |
| [Secret Boundary](secret-boundary.md) | 已通过（macOS） | 临时 Keychain、引用存储、Provider 单次注入、Agent allowlist、日志脱敏均实测 | 提取共享库，补 Windows/Linux Adapter |
| [Dual Preview](dual-preview.md) | 已通过 | Vercel API 部署、Cloudflare Pages 部署、跨域通信、API URL 注入均已取得真实云端 Evidence；部署编排已实现为 `packages/deployment-composer`（含 Vercel SSO Protection 关闭、精确 CORS、临时项目清理）；10 个单元测试通过 | 在安装了 Vercel/Wrangler CLI 的机器上用真实云端跑通 Composer 端到端，补充 PR 关闭时自动触发清理的编排 |
| [Supabase Auth](supabase-auth.md) | 已确认降级 | CLI 写入项目边界外状态，已确认采用 Manual 降级路径（路径 C）；RealProviderRegistry 已实现自动降级 | 后续实现 Management API 自动基础设施 + 人工敏感配置审批的分阶段方案 |

## 当前本机前置状态

```text
Codex CLI      installed, read-only and fixture workspace-write verified; real task recovery pending
GitHub CLI     not installed (probe.mjs --online reports installed=false)
Vercel CLI     not installed (probe.mjs --online reports installed=false)
Wrangler       not installed (probe.mjs --online reports installed=false)
Supabase CLI   not installed (probe.mjs --online reports installed=false)
```

> 注：2026-08-09 本机预检显示当前环境未安装任何 Provider CLI。此前 Spike 验证在另一台已安装并认证的机器上完成。端到端 Composer 验证需要在安装了 `vercel` + `wrangler` CLI 的机器上进行。

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
