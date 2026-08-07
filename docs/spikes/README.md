# Phase 0 技术 Spike 状态

> 更新时间：2026-08-07
> 原则：未取得真实平台 Evidence 的项目不能标记通过。

| Spike | 当前状态 | 已取得证据 | 下一动作 |
| --- | --- | --- | --- |
| [Codex Runtime](codex-runtime.md) | Probe 通过/真实任务超时 | 当前用户配置下只读和临时 fixture workspace-write、JSONL、最终 Schema 与确定性写入验证已通过；真实功能任务已启动但在 180 秒上限内超时 | 失败工作区恢复、Codex resume/cancel 和可控的真实功能重跑 |
| [Workflow Resume](workflow-resume.md) | 已通过 | XState 5.32.5 快照跨四个独立进程恢复，SQLite 历史连续 | Phase A 改用 Drizzle/正式驱动并补 lease、幂等和 crash 测试 |
| [Secret Boundary](secret-boundary.md) | 已通过（macOS） | 临时 Keychain、引用存储、Provider 单次注入、Agent allowlist、日志脱敏均实测 | 提取共享库，补 Windows/Linux Adapter |
| [Dual Preview](dual-preview.md) | 真实执行阻塞 | Vercel 项目创建、部署、就绪、失败清理已验证；公网 Preview 超时，Cloudflare 未创建 | 核对 Vercel 团队级 Preview Protection/Firewall；建议降级为稳定 dev API + PR API 人工 Gate，待用户确认 |
| [Supabase Auth](supabase-auth.md) | 前置阻塞 | CLI 已局部安装，但会尝试创建 `~/.supabase`，当前文件边界下不可用 | 用户选择 Management API/OAuth、授权 CLI 状态目录或稳定 dev Redirect |

## 当前本机前置状态

```text
Codex CLI      installed, read-only and fixture workspace-write verified; real task recovery pending
GitHub CLI     installed, authenticated
Vercel CLI     installed, authenticated
Wrangler       locally installed, authenticated
Supabase CLI   locally installed, blocked by out-of-workspace state write
```

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
